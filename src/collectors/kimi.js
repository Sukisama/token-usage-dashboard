const fs = require('fs');
const path = require('path');
const os = require('os');
const { readJsonLines, walkDir, formatTimestamp, safeInt, fileUnchanged, markFile } = require('./utils');

const KIMI_DIR = path.join(os.homedir(), '.kimi-code', 'sessions');

function collect() {
  const records = [];
  if (!fs.existsSync(KIMI_DIR)) return records;

  const files = walkDir(KIMI_DIR, /^wire\.jsonl$/);

  for (const file of files) {
    if (fileUnchanged(file)) continue;
    const lines = readJsonLines(file);
    markFile(file);
    const parts = file.split(path.sep);
    const sessionIdx = parts.indexOf('session_');
    const sessionId = sessionIdx > 0 ? parts[sessionIdx] + '_' + parts[sessionIdx + 1] : path.basename(path.dirname(file));

    for (const line of lines) {
      const usage = line.usage;
      if (!usage) continue;

      const timestamp = formatTimestamp(line.time || line.timestamp);
      if (!timestamp) continue;

      const inputOther = safeInt(usage.inputOther);
      const inputCacheRead = safeInt(usage.inputCacheRead);
      const inputCacheCreation = safeInt(usage.inputCacheCreation);
      const output = safeInt(usage.output);

      records.push({
        agent: 'kimi-code',
        session_id: sessionId,
        timestamp,
        model: line.model || null,
        input_tokens: inputOther + inputCacheCreation,
        output_tokens: output,
        cache_read_tokens: inputCacheRead,
        cache_creation_tokens: inputCacheCreation,
        reasoning_tokens: 0,
        total_tokens: inputOther + inputCacheRead + inputCacheCreation + output,
        source_file: file
      });
    }
  }

  return records;
}

module.exports = { collect };
