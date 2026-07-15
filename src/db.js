const initSqlJs = require('sql.js/dist/sql-wasm.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DB_DIR = path.join(os.homedir(), '.token-usage-dashboard');
const DB_PATH = path.join(DB_DIR, 'usage.db');

let SQL;
let db;

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
    CREATE INDEX IF NOT EXISTS idx_date ON usage_records(date(timestamp));
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
      COUNT(DISTINCT date(timestamp)) as days
    FROM usage_records
  `)[0];

  const byAgent = query(`
    SELECT
      agent,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COUNT(*) as records,
      COUNT(DISTINCT date(timestamp)) as days,
      MAX(date(timestamp)) as last_used
    FROM usage_records
    GROUP BY agent
    ORDER BY total_tokens DESC
  `);

  const today = new Date().toISOString().split('T')[0];
  const todayUsage = query(`
    SELECT agent, COALESCE(SUM(total_tokens), 0) as total_tokens
    FROM usage_records
    WHERE date(timestamp) = ?
    GROUP BY agent
    ORDER BY total_tokens DESC
  `, [today]);

  return { overall, byAgent, today: todayUsage };
}

function getDailyUsage(agent) {
  let sql;
  let params = [];

  if (agent && agent !== 'all') {
    sql = `
      SELECT
        date(timestamp) as date,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(reasoning_tokens), 0) as reasoning_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(*) as records
      FROM usage_records
      WHERE agent = ?
      GROUP BY date(timestamp)
      ORDER BY date(timestamp) DESC
    `;
    params = [agent];
  } else {
    sql = `
      SELECT
        date(timestamp) as date,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(reasoning_tokens), 0) as reasoning_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(*) as records
      FROM usage_records
      GROUP BY date(timestamp)
      ORDER BY date(timestamp) DESC
    `;
  }

  return query(sql, params);
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

  return query(sql, params);
}

function getRecords({ agent, limit = 100, offset = 0 }) {
  let sql;
  let params = [];

  if (agent && agent !== 'all') {
    sql = `
      SELECT * FROM usage_records
      WHERE agent = ?
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `;
    params = [agent, limit, offset];
  } else {
    sql = `
      SELECT * FROM usage_records
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `;
    params = [limit, offset];
  }

  return query(sql, params);
}

module.exports = {
  init,
  insertUsageRecords,
  getSummary,
  getDailyUsage,
  getAgents,
  getModelUsage,
  getRecords
};
