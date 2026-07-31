const fs = require('fs');
const os = require('os');
const path = require('path');

// Collector source roots. Defaults match the original hard-coded paths; a
// JSON file at COLLECTORS_CFG can override or extend any of them.
//
// Per-agent values may be either:
//   - a string  (single source dir)
//   - an array of strings (multiple source dirs walked in order)
// Use the array form when an agent exposes the same schema from two surfaces
// (e.g. kimi-code CLI + Kimi desktop app both write `wire.jsonl`).
const COLLECTORS_CFG = path.join(os.homedir(), '.token-usage-dashboard', 'collectors.json');

const DEFAULTS = {
  codex: path.join(os.homedir(), '.codex', 'sessions'),
  claude: path.join(os.homedir(), '.claude', 'projects'),
  // Default for `kimi` is an array: the CLI dir first, then the desktop app
  // session dir. Users editing collectors.json can override the whole list
  // or just append more roots.
  kimi: [
    path.join(os.homedir(), '.kimi-code', 'sessions'),
    path.join(os.homedir(), 'Library', 'Application Support', 'kimi-desktop',
      'daimon-share', 'daimon', 'runtime', 'kimi-code', 'home', 'sessions')
  ],
  workbuddy: path.join(os.homedir(), '.workbuddy'),
  cola: path.join(os.homedir(), '.cola', 'sessions')
};

let _cache = null;
function load() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(COLLECTORS_CFG, 'utf8'));
  } catch {
    _cache = {};
  }
  return _cache;
}

function expand(p) {
  if (!p) return p;
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(2)) : p;
}

// Primary source dir for `name`. Returns the first entry when an array was
// configured; for back-compat with code that only knows about one root.
function dir(name) {
  const all = dirs(name);
  return all.length > 0 ? all[0] : null;
}

// All source dirs for `name` (merged defaults + overrides). Always returns an
// array of absolute paths, preserving order and removing dupes.
function dirs(name) {
  const cfg = load();
  const override = cfg[name];
  const defaults = DEFAULTS[name];
  let raw;
  if (override !== undefined) raw = override;
  else if (defaults !== undefined) raw = defaults;
  else return [];

  const list = Array.isArray(raw) ? raw : [raw];
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (typeof p !== 'string' || !p) continue;
    const abs = expand(p);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

module.exports = { dir, dirs, DEFAULTS };