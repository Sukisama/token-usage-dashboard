const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const db = require('./src/db');
const pricing = require('./src/pricing');
const collectors = require('./src/collectors');
const { dirs: collectorDirs } = require('./src/collectors/paths');
const { flushCache, resetCache } = require('./src/collectors/utils');
const { refreshSubscription } = require('./src/collectors/subscriptions');

const PORT = 7373;
const SRC_DIR = path.join(__dirname, 'src');
const DB_PATH = path.join(os.homedir(), '.token-usage-dashboard', 'usage.db');

// Agent log roots to watch for changes (auto-refresh the DB in near real time).
// Flattened from per-agent lists in collectors.json so multi-source agents
// (kimi-code CLI + Kimi desktop app) all get file watchers.
const WATCH_DIRS = [
  ...collectorDirs('codex'),
  ...collectorDirs('claude'),
  ...collectorDirs('kimi'),
  ...collectorDirs('workbuddy'),
  ...collectorDirs('cola')
];
const AUTO_SCAN_DEBOUNCE = 3000;      // coalesce a burst of writes
const AUTO_SCAN_MIN_INTERVAL = 10000; // never scan more often than this

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

async function scanAll() {
  const results = [];
  for (const [name, collector] of Object.entries(collectors)) {
    try {
      const records = await collector.collect();
      const inserted = db.insertUsageRecords(records);
      results.push({ agent: name, found: records.length, inserted });
    } catch (err) {
      results.push({ agent: name, found: 0, inserted: 0, error: err.message });
    }
  }
  // Persist the incremental-scan mtime cache after a full pass.
  flushCache();
  return results;
}

// --- auto-refresh: incremental scan triggered by log-file changes ------------
let scanPromise = null;   // shared in-flight scan
let scanTimer = null;     // pending debounced scan
let lastScanAt = 0;

// Runs a scan, coalescing concurrent callers onto the same in-flight promise.
function runScan() {
  if (scanPromise) return scanPromise;
  scanPromise = (async () => {
    try { return await scanAll(); }
    finally { scanPromise = null; lastScanAt = Date.now(); }
  })();
  return scanPromise;
}

// Schedule an incremental scan after a short debounce, rate-limited so heavy
// agent activity can't trigger back-to-back scans.
function scheduleAutoScan() {
  if (scanTimer || scanPromise) return;
  const since = Date.now() - lastScanAt;
  const wait = Math.max(AUTO_SCAN_DEBOUNCE, AUTO_SCAN_MIN_INTERVAL - since);
  scanTimer = setTimeout(() => {
    scanTimer = null;
    runScan().catch(() => {});
  }, wait);
}

// Event-driven watchers (FSEvents on macOS): zero CPU when idle, fire only on
// actual writes. `persistent:false` so watchers never keep the process alive.
function setupWatchers() {
  for (const dir of WATCH_DIRS) {
    if (!fs.existsSync(dir)) continue;
    try {
      fs.watch(dir, { recursive: true, persistent: false }, () => scheduleAutoScan());
    } catch { /* recursive watch unsupported here; skip */ }
  }
}

// Refresh all enabled subscription rate limits. Iterates each row, calls the
// platform's collector, and writes the snapshot back to the DB.
async function refreshAllSubscriptions(platformFilter = null) {
  const subs = db.listSubscriptions().filter(s =>
    !platformFilter || s.platform === platformFilter
  );
  let success = 0, failed = 0, skipped = 0;
  for (const sub of subs) {
    const result = await refreshSubscription(sub);
    if (result.status === 'unavailable') {
      // Not a failure — just means we don't have a collector for this platform.
      db.updateSubscriptionLimits(sub.id, { fiveHour: {}, weekly: {}, monthly: {} },
        'unavailable', result.message || '暂未实现自动采集', sub.source);
      skipped++;
    } else if (result.status === 'ok') {
      const source = `auto:${sub.platform}`;
      db.updateSubscriptionLimits(sub.id, result, 'ok', result.message || '', source);
      // Update plan info if the collector returned fresher data.
      const updates = {};
      if (result.plan_name) updates.plan_name = result.plan_name;
      if (result.monthly_cost) updates.monthly_cost = result.monthly_cost;
      if (result.cycle_start) updates.cycle_start = result.cycle_start;
      if (result.cycle_end) updates.cycle_end = result.cycle_end;
      if (Object.keys(updates).length) {
        updates.id = sub.id;
        db.upsertSubscription(updates);
      }
      success++;
    } else {
      // auth_expired / rate_limited / error — keep the last good snapshot, just mark status.
      db.updateSubscriptionLimits(sub.id, { fiveHour: {}, weekly: {}, monthly: {} },
        result.status, result.message || '', sub.source);
      failed++;
    }
  }
  return { success, failed, skipped, total: subs.length };
}

// Per-platform "verify login" launcher. For platforms whose local token comes
// from a CLI (opencodex / codex), we write a .command file and `open` it —
// macOS launches Terminal on the file (no AppleScript automation permission
// needed), the device-code OAuth flow prints a URL/code, opens the browser,
// and writes the refreshed token back to the same file our collector reads.
// For platforms with no CLI (MiniMax), we just open the website.
const NPM_BIN = path.join(os.homedir(), '.npm-global', 'bin');
const LOGIN_COMMANDS = {
  'anthropic': () => `"${path.join(NPM_BIN, 'ocx')}" login anthropic`,
  'kimi': () => `"${path.join(NPM_BIN, 'ocx')}" login kimi`,
  'google-antigravity': () => `"${path.join(NPM_BIN, 'ocx')}" login google-antigravity`,
  'openai-codex': () => `"${path.join(NPM_BIN, 'codex')}" login`,
};
const LOGIN_URLS = {
  'minimax': 'https://platform.minimaxi.com',
  'anthropic': 'https://claude.ai/login',
  'kimi': 'https://kimi.moonshot.cn',
};

function launchLogin(platform) {
  const cmd = LOGIN_COMMANDS[platform] && LOGIN_COMMANDS[platform]();
  if (cmd) {
    // A .command file opened via `open` runs in a fresh Terminal window without
    // needing AppleScript automation permission. Keep the window open afterward
    // so the user can read the result / device code.
    const tmp = path.join(os.tmpdir(), `tud-login-${platform}-${Date.now()}.command`);
    const script = `#!/bin/bash\nclear\necho "=== ${platform} 登录 ==="\necho "完成登录后回到用量看板点 ⟳ 刷新"\necho\ncd ~\n${cmd}\necho\necho "（此窗口可关闭）"\n`;
    try {
      fs.writeFileSync(tmp, script);
      fs.chmodSync(tmp, 0o755);
    } catch (e) {
      return Promise.resolve({ ok: false, method: 'terminal', error: '无法创建登录脚本: ' + e.message });
    }
    return new Promise((resolve) => {
      exec(`open "${tmp}"`, (err) => {
        if (err) resolve({ ok: false, method: 'terminal', error: err.message });
        else resolve({ ok: true, method: 'terminal', command: cmd });
      });
    });
  }
  const url = LOGIN_URLS[platform];
  if (url) {
    return new Promise((resolve) => {
      exec(`open "${url}"`, (err) => {
        if (err) resolve({ ok: false, method: 'browser', error: err.message });
        else resolve({ ok: true, method: 'browser', url });
      });
    });
  }
  return Promise.resolve({ ok: false, error: '该平台暂不支持自动登录' });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url === '/' ? '/index.html' : req.url).split('?')[0]);
  let filePath = path.normalize(path.join(SRC_DIR, urlPath));

  // Prevent path traversal (e.g. /../server.js) escaping the static root.
  if (filePath !== SRC_DIR && !filePath.startsWith(SRC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res) {
  try {
    if (req.url === '/api/scan') {
      const results = await runScan();
      sendJson(res, results);
    } else if (req.url === '/api/rebuild' && req.method === 'POST') {
      // Wipe rows + incremental cache, then re-parse everything from scratch.
      // Needed after a collector fix so corrected model/timestamps replace the
      // old rows that INSERT OR IGNORE would otherwise keep.
      if (scanPromise) await scanPromise;   // let any in-flight scan finish
      const backupPath = db.createRebuildBackup();
      db.clearAll();
      resetCache();
      const results = await runScan();
      sendJson(res, { backupPath, results });
    } else if (req.url === '/api/summary') {
      sendJson(res, db.getSummary());
    } else if (req.url.startsWith('/api/period-summary')) {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const period = url.searchParams.get('period') || 'today';
      sendJson(res, db.getPeriodSummary(period));
    } else if (req.url.startsWith('/api/daily-agents')) {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      sendJson(res, db.getDailyByAgent(url.searchParams.get('agent') || 'all'));
    } else if (req.url.startsWith('/api/daily-models')) {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      sendJson(res, db.getDailyByModel(url.searchParams.get('agent') || 'all'));
    } else if (req.url.startsWith('/api/daily-cost-agents')) {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const days = parseInt(url.searchParams.get('days') || '30', 10);
      sendJson(res, db.getDailyCostByAgent(days));
    } else if (req.url.startsWith('/api/daily-cost')) {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const agent = url.searchParams.get('agent') || 'all';
      const days = parseInt(url.searchParams.get('days') || '30', 10);
      sendJson(res, db.getDailyCost(agent, days));
    } else if (req.url.startsWith('/api/daily')) {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const agent = url.searchParams.get('agent') || 'all';
      sendJson(res, db.getDailyUsage(agent));
    } else if (req.url === '/api/agents') {
      sendJson(res, db.getAgents());
    } else if (req.url.startsWith('/api/records')) {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const agent = url.searchParams.get('agent') || 'all';
      const date = url.searchParams.get('date') || null;
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      sendJson(res, db.getRecords({ agent, date, limit, offset }));
    } else if (req.url.startsWith('/api/day-summary')) {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const date = url.searchParams.get('date') || null;
      sendJson(res, db.getDayAgentSummary(date));
    } else if (req.url.startsWith('/api/models')) {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const agent = url.searchParams.get('agent') || 'all';
      sendJson(res, db.getModelUsage(agent));
    } else if (req.url === '/api/export') {
      // Download SQLite DB file
      if (!fs.existsSync(DB_PATH)) {
        sendJson(res, { error: 'No data to export' }, 404);
        return;
      }
      const data = fs.readFileSync(DB_PATH);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="token-usage-dashboard.db"',
        'Content-Length': data.length
      });
      res.end(data);
    } else if (req.url === '/api/import' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.data) {
        sendJson(res, { error: 'Missing data' }, 400);
        return;
      }
      const buffer = Buffer.from(body.data, 'base64');
      const inserted = db.importFromBuffer(buffer);
      sendJson(res, { inserted });
    } else if (req.url.startsWith('/api/hourly')) {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const agent = url.searchParams.get('agent') || 'all';
      const date = url.searchParams.get('date') || null;
      sendJson(res, db.getHourlyUsage(agent, date));
    } else if (req.url === '/api/pricing' && req.method === 'GET') {
      sendJson(res, pricing.PRICES);
    } else if (req.url === '/api/pricing' && req.method === 'PUT') {
      const body = await parseBody(req);
      if (!Array.isArray(body.prices)) {
        sendJson(res, { error: 'prices must be an array' }, 400);
        return;
      }
      pricing.savePrices(body.prices);
      pricing.reload();
      sendJson(res, { ok: true, count: body.prices.length });
    } else if (req.url === '/api/stats') {
      sendJson(res, db.getDbStats());
    } else if (req.url === '/api/subscriptions' && req.method === 'GET') {
      sendJson(res, db.listSubscriptions());
    } else if (req.url === '/api/subscriptions' && req.method === 'POST') {
      const body = await parseBody(req);
      const id = db.upsertSubscription(body);
      sendJson(res, { ok: true, id });
    } else if (req.url === '/api/subscriptions/refresh' && req.method === 'POST') {
      const body = await parseBody(req) || {};
      const result = await refreshAllSubscriptions(body.platform || null);
      sendJson(res, { ok: true, ...result });
    } else if (req.url === '/api/subscriptions/login' && req.method === 'POST') {
      const body = await parseBody(req) || {};
      const result = await launchLogin(body.platform);
      sendJson(res, result);
    } else if (req.url.startsWith('/api/subscriptions/') && req.method === 'DELETE') {
      const id = parseInt(req.url.split('/').pop(), 10);
      db.deleteSubscription(id);
      sendJson(res, { ok: true });
    } else {
      sendJson(res, { error: 'Not found' }, 404);
    }
  } catch (err) {
    sendJson(res, { error: err.message }, 500);
  }
}

const server = http.createServer(async (req, res) => {
  // Only the local machine may read or mutate this dashboard. Binding to
  // loopback already blocks the LAN; this host guard also rejects DNS-rebinding
  // requests that arrive with an unexpected Host header.
  const host = String(req.headers.host || '').toLowerCase();
  if (host !== `localhost:${PORT}` && host !== `127.0.0.1:${PORT}` && host !== `[::1]:${PORT}`) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // This server exposes your local token logs. Only allow the dashboard's own
  // origin so a random web page you visit can't read localhost:7373.
  const origin = req.headers.origin;
  if (origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url.startsWith('/api/')) {
    await handleApi(req, res);
  } else {
    serveStatic(req, res);
  }
});

async function start() {
  await db.init();

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Token 用量看板已启动: http://localhost:${PORT}`);

    // Fresh data on launch, then keep it fresh via file watchers.
    runScan().catch(() => {});
    setupWatchers();

    // Open the browser only for a standalone launch — not when the desktop
    // widget spawns this server as its backend (ELECTRON_RUN_AS_NODE is set).
    if (process.platform === 'darwin' && !process.env.ELECTRON_RUN_AS_NODE) {
      exec(`open http://localhost:${PORT}`);
    }
  });
}

start();
