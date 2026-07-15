const fs = require('fs');
const path = require('path');
const os = require('os');
const { readJsonLines, walkDir, formatTimestamp, parseDateFromPath, safeInt } = require('./utils');

const CODEX_DIR = path.join(os.homedir(), '.codex', 'sessions');

function collect() {
  const records = [];
  if (!fs.existsSync(CODEX_DIR)) return records;

  const files = walkDir(CODEX_DIR, /^rollout-.*\.jsonl$/);

  for (const file of files) {
    const lines = readJsonLines(file);
    const sessionId = path.basename(file, '.jsonl');
    const dateFromPath = parseDateFromPath(file);

    for (const line of lines) {
      const payload = line.type === 'event_msg' ? line.payload : line;
      if (payload.type !== 'token_count') continue;

      const usage = payload.info?.last_token_usage || payload.info?.total_token_usage;
      if (!usage) continue;

      let timestamp = formatTimestamp(line.timestamp);
      if (!timestamp && dateFromPath) {
        timestamp = new Date(`${dateFromPath}T00:00:00Z`).toISOString();
      }

      records.push({
        agent: 'codex',
        session_id: sessionId,
        timestamp,
        model: payload.info?.model || null,
        input_tokens: safeInt(usage.input_tokens),
        output_tokens: safeInt(usage.output_tokens),
        cache_read_tokens: safeInt(usage.cached_input_tokens),
        cache_creation_tokens: 0,
        reasoning_tokens: safeInt(usage.reasoning_output_tokens),
        total_tokens: safeInt(usage.total_tokens),
        source_file: file
      });
    }
  }

  return records;
}

module.exports = { collect };
