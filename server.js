const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const db = require('./src/db');
const collectors = require('./src/collectors');
const { flushCache, resetCache } = require('./src/collectors/utils');

const PORT = 7373;
const SRC_DIR = path.join(__dirname, 'src');
const DB_PATH = path.join(require('os').homedir(), '.token-usage-dashboard', 'usage.db');

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
      const results = await scanAll();
      sendJson(res, results);
    } else if (req.url === '/api/rebuild' && req.method === 'POST') {
      // Wipe rows + incremental cache, then re-parse everything from scratch.
      // Needed after a collector fix so corrected model/timestamps replace the
      // old rows that INSERT OR IGNORE would otherwise keep.
      db.clearAll();
      resetCache();
      const results = await scanAll();
      sendJson(res, results);
    } else if (req.url === '/api/summary') {
      sendJson(res, db.getSummary());
    } else if (req.url.startsWith('/api/daily-agents')) {
      sendJson(res, db.getDailyByAgent());
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
    } else {
      sendJson(res, { error: 'Not found' }, 404);
    }
  } catch (err) {
    sendJson(res, { error: err.message }, 500);
  }
}

const server = http.createServer(async (req, res) => {
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

  server.listen(PORT, () => {
    console.log(`Token 用量看板已启动: http://localhost:${PORT}`);

    if (process.platform === 'darwin') {
      exec(`open http://localhost:${PORT}`);
    }
  });
}

start();
