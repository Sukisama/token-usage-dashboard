const fs = require('fs');
const path = require('path');
const os = require('os');
const { readJsonLines, walkDir, formatTimestamp, safeInt, fileUnchanged, markFile } = require('./utils');

const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');

function collect() {
  const records = [];
  if (!fs.existsSync(CLAUDE_DIR)) return records;

  const files = walkDir(CLAUDE_DIR, /^.*\.jsonl$/);

  for (const file of files) {
    if (fileUnchanged(file)) continue;
    const lines = readJsonLines(file);
    markFile(file);
    const sessionId = path.basename(file, '.jsonl');

    for (const line of lines) {
      const usage = line.message?.usage || line.usage;
      if (!usage) continue;

      const timestamp = formatTimestamp(line.timestamp || line.message?.timestamp || line.ts);
      if (!timestamp) continue;

      records.push({
        agent: 'claude',
        session_id: sessionId,
        timestamp,
        model: line.message?.model || line.model || null,
        input_tokens: safeInt(usage.input_tokens),
        output_tokens: safeInt(usage.output_tokens),
        cache_read_tokens: safeInt(usage.cache_read_input_tokens),
        cache_creation_tokens: safeInt(usage.cache_creation_input_tokens),
        reasoning_tokens: 0,
        total_tokens: safeInt(usage.total_tokens) || (
          safeInt(usage.input_tokens) +
          safeInt(usage.output_tokens) +
          safeInt(usage.cache_creation_input_tokens)
        ),
        source_file: file
      });
    }
  }

  return records;
}

module.exports = { collect };
