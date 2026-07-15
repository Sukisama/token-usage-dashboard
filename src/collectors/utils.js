const fs = require('fs');
const path = require('path');

function readJsonLines(filePath) {
  const lines = [];
  if (!fs.existsSync(filePath)) return lines;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      lines.push(JSON.parse(trimmed));
    } catch (e) {
      // skip malformed lines
    }
  }
  return lines;
}

function walkDir(dir, pattern, results = []) {
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, pattern, results);
    } else if (entry.isFile() && pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function formatTimestamp(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseDateFromPath(filePath) {
  const match = filePath.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return null;
}

function safeInt(value) {
  const n = parseInt(value, 10);
  return isNaN(n) ? 0 : n;
}

module.exports = {
  readJsonLines,
  walkDir,
  formatTimestamp,
  parseDateFromPath,
  safeInt
};
