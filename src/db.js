const initSqlJs = require('sql.js/dist/sql-wasm.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const pricing = require('./pricing');

const DB_DIR = path.join(os.homedir(), '.token-usage-dashboard');
const DB_PATH = path.join(DB_DIR, 'usage.db');

let SQL;
let db;

// Local (not UTC) YYYY-MM-DD, matching SQLite's date(ts,'localtime') grouping.
function localDateStr(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function init() {
  SQL = await initSqlJs();

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL,
      session_id TEXT,
      timestamp TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_creation_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      source_file TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent, session_id, timestamp, total_tokens)
    );

    CREATE INDEX IF NOT EXISTS idx_agent ON usage_records(agent);
    CREATE INDEX IF NOT EXISTS idx_timestamp ON usage_records(timestamp);
    CREATE INDEX IF NOT EXISTS idx_date ON usage_records(date(timestamp, 'localtime'));
  `);

  save();
}

function save() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function insertUsageRecords(records) {
  if (!records || records.length === 0) return 0;

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO usage_records
    (agent, session_id, timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, reasoning_tokens, total_tokens, source_file)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  try {
    for (const row of records) {
      if (!row.agent || !row.timestamp) continue;
      stmt.run([
        row.agent,
        row.session_id || null,
        row.timestamp,
        row.model || null,
        row.input_tokens || 0,
        row.output_tokens || 0,
        row.cache_read_tokens || 0,
        row.cache_creation_tokens || 0,
        row.reasoning_tokens || 0,
        row.total_tokens || 0,
        row.source_file || null
      ]);
      count++;
    }
  } finally {
    stmt.free();
  }

  save();
  return count;
}

function clearAll() {
  db.exec('DELETE FROM usage_records;');
  save();
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function getSummary() {
  const overall = query(`
    SELECT
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
      COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
      COALESCE(SUM(reasoning_tokens), 0) as reasoning_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COUNT(*) as records,
      COUNT(DISTINCT date(timestamp, 'localtime')) as days
    FROM usage_records
  `)[0];

  const byAgent = query(`
    SELECT
      agent,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COUNT(*) as records,
      COUNT(DISTINCT date(timestamp, 'localtime')) as days,
      MAX(date(timestamp, 'localtime')) as last_used
    FROM usage_records
    GROUP BY agent
    ORDER BY total_tokens DESC
  `);

  const today = localDateStr();
  const todayUsage = query(`
    SELECT agent,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
    FROM usage_records
    WHERE date(timestamp, 'localtime') = ?
    GROUP BY agent
    ORDER BY total_tokens DESC
  `, [today]);

  // Cost is derived per (agent, model) then aggregated, because pricing is
  // model-specific. Unknown models contribute null (skipped, not zeroed).
  const agentModel = query(`
    SELECT agent, model,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
      COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens
    FROM usage_records
    GROUP BY agent, model
  `);
  let totalCost = 0;
  let hasPricedRow = false;
  const costByAgent = {};
  for (const r of agentModel) {
    const c = pricing.costOf(r);
    if (c == null) continue;
    hasPricedRow = true;
    totalCost += c;
    costByAgent[r.agent] = (costByAgent[r.agent] || 0) + c;
  }
  overall.cost = hasPricedRow ? totalCost : null;
  for (const a of byAgent) a.cost = costByAgent[a.agent] != null ? costByAgent[a.agent] : null;

  const todayModel = query(`
    SELECT agent, model,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
      COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens
    FROM usage_records
    WHERE date(timestamp, 'localtime') = ?
    GROUP BY agent, model
  `, [today]);
  let todayCost = 0;
  let todayPriced = false;
  for (const r of todayModel) {
    const c = pricing.costOf(r);
    if (c == null) continue;
    todayPriced = true;
    todayCost += c;
  }

  return {
    overall,
    byAgent,
    today: todayUsage,
    todayCost: todayPriced ? todayCost : null
  };
}

// Start date (local YYYY-MM-DD) for a named period, or null for today/all.
function periodStart(period) {
  const d = new Date();
  if (period === 'week') {
    const monOffset = (d.getDay() + 6) % 7; // days since Monday
    d.setDate(d.getDate() - monOffset);
    return localDateStr(d);
  }
  if (period === 'month') {
    return localDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
  }
  return null;
}

// Summary for a period ('today' | 'week' | 'month' | 'all'): total tokens,
// estimated cost, per-agent breakdown, plus today's heat level (0-4) for the
// desktop orb's colour.
function getPeriodSummary(period) {
  let where = '';
  let params = [];
  if (period === 'today') {
    where = "WHERE date(timestamp, 'localtime') = ?";
    params = [localDateStr()];
  } else if (period === 'week' || period === 'month') {
    where = "WHERE date(timestamp, 'localtime') >= ?";
    params = [periodStart(period)];
  }

  const totals = query(
    `SELECT COALESCE(SUM(total_tokens), 0) t, COALESCE(SUM(cache_read_tokens), 0) cr
     FROM usage_records ${where}`, params)[0];
  const total = totals.t;
  const cacheRead = totals.cr;
  const byAgent = query(
    `SELECT agent, COALESCE(SUM(total_tokens), 0) as total_tokens
     FROM usage_records ${where} GROUP BY agent ORDER BY total_tokens DESC`, params);

  const am = query(
    `SELECT agent, model,
       COALESCE(SUM(input_tokens),0) input_tokens,
       COALESCE(SUM(output_tokens),0) output_tokens,
       COALESCE(SUM(cache_read_tokens),0) cache_read_tokens,
       COALESCE(SUM(cache_creation_tokens),0) cache_creation_tokens
     FROM usage_records ${where} GROUP BY agent, model`, params);
  let cost = 0, priced = false;
  for (const r of am) { const c = pricing.costOf(r); if (c != null) { cost += c; priced = true; } }

  // today's heat level relative to the busiest single day
  const maxDay = query(
    `SELECT COALESCE(MAX(dt), 0) m FROM
       (SELECT SUM(total_tokens) dt FROM usage_records GROUP BY date(timestamp, 'localtime'))`)[0].m;
  const todayTotal = query(
    `SELECT COALESCE(SUM(total_tokens), 0) t FROM usage_records
     WHERE date(timestamp, 'localtime') = ?`, [localDateStr()])[0].t;
  const ratio = maxDay > 0 ? todayTotal / maxDay : 0;
  const heatLevel = todayTotal <= 0 ? 0 : ratio <= 0.2 ? 1 : ratio <= 0.4 ? 2 : ratio <= 0.7 ? 3 : 4;

  return { period, total_tokens: total, cache_read: cacheRead, cost: priced ? cost : null, byAgent, todayHeatLevel: heatLevel };
}

function getDailyUsage(agent) {
  let sql;
  let params = [];

  if (agent && agent !== 'all') {
    sql = `
      SELECT
        date(timestamp, 'localtime') as date,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(reasoning_tokens), 0) as reasoning_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(*) as records
      FROM usage_records
      WHERE agent = ?
      GROUP BY date(timestamp, 'localtime')
      ORDER BY date(timestamp, 'localtime') DESC
    `;
    params = [agent];
  } else {
    sql = `
      SELECT
        date(timestamp, 'localtime') as date,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(reasoning_tokens), 0) as reasoning_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(*) as records
      FROM usage_records
      GROUP BY date(timestamp, 'localtime')
      ORDER BY date(timestamp, 'localtime') DESC
    `;
  }

  return query(sql, params);
}

// Per-day, per-agent totals for the stacked trend chart (optionally scoped
// to one agent via the global filter).
function getDailyByAgent(agent) {
  const scoped = agent && agent !== 'all';
  return query(`
    SELECT
      date(timestamp, 'localtime') as date,
      agent,
      COALESCE(SUM(total_tokens), 0) as total_tokens
    FROM usage_records
    ${scoped ? 'WHERE agent = ?' : ''}
    GROUP BY date(timestamp, 'localtime'), agent
    ORDER BY date(timestamp, 'localtime') ASC
  `, scoped ? [agent] : []);
}

// Per-day, per-model totals for the stacked trend chart (model dimension).
function getDailyByModel(agent) {
  const scoped = agent && agent !== 'all';
  return query(`
    SELECT
      date(timestamp, 'localtime') as date,
      COALESCE(NULLIF(model, ''), 'unknown') as model,
      COALESCE(SUM(total_tokens), 0) as total_tokens
    FROM usage_records
    ${scoped ? 'WHERE agent = ?' : ''}
    GROUP BY date(timestamp, 'localtime'), model
    ORDER BY date(timestamp, 'localtime') ASC
  `, scoped ? [agent] : []);
}

function getAgents() {
  return query(`
    SELECT DISTINCT agent FROM usage_records ORDER BY agent
  `).map(r => r.agent);
}

function getModelUsage(agent) {
  let sql;
  let params = [];

  if (agent && agent !== 'all') {
    sql = `
      SELECT
        agent,
        COALESCE(model, 'unknown') as model,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(reasoning_tokens), 0) as reasoning_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(*) as records
      FROM usage_records
      WHERE agent = ? AND model IS NOT NULL AND model != ''
      GROUP BY agent, model
      ORDER BY total_tokens DESC
    `;
    params = [agent];
  } else {
    sql = `
      SELECT
        COALESCE(model, 'unknown') as model,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(reasoning_tokens), 0) as reasoning_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(*) as records
      FROM usage_records
      WHERE model IS NOT NULL AND model != ''
      GROUP BY model
      ORDER BY total_tokens DESC
    `;
  }

  const rows = query(sql, params);
  for (const r of rows) r.cost = pricing.costOf(r);
  return rows;
}

function importFromBuffer(buffer) {
  const importedDb = new SQL.Database(buffer);

  const stmt = importedDb.prepare(`
    SELECT agent, session_id, timestamp, model, input_tokens, output_tokens,
           cache_read_tokens, cache_creation_tokens, reasoning_tokens, total_tokens, source_file
    FROM usage_records
  `);

  const records = [];
  while (stmt.step()) {
    records.push(stmt.getAsObject());
  }
  stmt.free();
  importedDb.close();

  return insertUsageRecords(records);
}

// Records are collapsed so repeated calls in the same session, same model and
// same hour show as one archived row (with a request count) instead of one row
// per API call.
function getRecords({ agent, date, limit = 100, offset = 0 }) {
  const where = [];
  const params = [];
  if (agent && agent !== 'all') {
    where.push('agent = ?');
    params.push(agent);
  }
  if (date) {
    where.push("date(timestamp, 'localtime') = ?");
    params.push(date);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT
      agent,
      session_id,
      COALESCE(NULLIF(model, ''), 'unknown') as model,
      MAX(timestamp) as timestamp,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      SUM(cache_read_tokens) as cache_read_tokens,
      SUM(cache_creation_tokens) as cache_creation_tokens,
      SUM(total_tokens) as total_tokens,
      COUNT(*) as requests
    FROM usage_records
    ${clause}
    GROUP BY agent, session_id, model, strftime('%Y-%m-%d %H', timestamp, 'localtime')
    ORDER BY MAX(timestamp) DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const rows = query(sql, params);
  for (const r of rows) r.cost = pricing.costOf(r);
  return rows;
}

module.exports = {
  init,
  insertUsageRecords,
  importFromBuffer,
  clearAll,
  getSummary,
  getPeriodSummary,
  getDailyUsage,
  getDailyByAgent,
  getDailyByModel,
  getAgents,
  getModelUsage,
  getRecords
};
