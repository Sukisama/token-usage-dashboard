const fs = require('fs');
const path = require('path');
const os = require('os');
const { readJsonLines, walkDir, formatTimestamp, parseDateFromPath, safeInt, fileUnchanged, markFile } = require('./utils');

const CODEX_DIR = path.join(os.homedir(), '.codex', 'sessions');

function collect() {
  const records = [];
  if (!fs.existsSync(CODEX_DIR)) return records;

  const files = walkDir(CODEX_DIR, /^rollout-.*\.jsonl$/);

  for (const file of files) {
    if (fileUnchanged(file)) continue;
    const lines = readJsonLines(file);
    markFile(file);
    const sessionId = path.basename(file, '.jsonl');
    const dateFromPath = parseDateFromPath(file);
    // Codex stores the model in `turn_context` lines, NOT in token_count
    // events. Track the latest model seen and attribute it to subsequent usage
    // (the model can be switched mid-session).
    let currentModel = null;

    for (const line of lines) {
      // Both event_msg (token_count) and turn_context lines carry their data in
      // `.payload`; the model lives at payload.model on turn_context lines.
      const payload = line.payload || line;
      if (!payload || typeof payload !== 'object') continue;

      if (typeof payload.model === 'string' && payload.model) {
        currentModel = payload.model;
      }

      if (payload.type !== 'token_count') continue;

      // Only the per-turn increment (`last_token_usage`) may be summed.
      // `total_token_usage` is cumulative and would massively over-count.
      const usage = payload.info?.last_token_usage;
      if (!usage) continue;

      let timestamp = formatTimestamp(line.timestamp);
      if (!timestamp && dateFromPath) {
        timestamp = new Date(`${dateFromPath}T00:00:00Z`).toISOString();
      }

      // Codex `input_tokens` includes the cached portion; store only the
      // non-cached input so cost isn't double-counted (cached is priced
      // separately as cache_read). Total stays untouched.
      const cachedIn = safeInt(usage.cached_input_tokens);
      const nonCachedIn = Math.max(0, safeInt(usage.input_tokens) - cachedIn);

      records.push({
        agent: 'codex',
        session_id: sessionId,
        timestamp,
        model: payload.info?.model || currentModel || null,
        input_tokens: nonCachedIn,
        output_tokens: safeInt(usage.output_tokens),
        cache_read_tokens: cachedIn,
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
