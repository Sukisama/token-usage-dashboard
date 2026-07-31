const fs = require('fs');
const path = require('path');
const { readJsonLines, walkDir, formatTimestamp, safeInt, fileUnchanged, markFile } = require('./utils');
const { dir: colaDir } = require('./paths');

// Cola (desktop AI app) stores per-session transcripts in ~/.cola/sessions.
// Each line is a JSON event; assistant messages carry a `message.usage` blob
// with `input / output / cacheRead / cacheWrite / totalTokens / cost` and the
// model id at `message.model`. Source files match `YYYY-MM-DDTHH-MM-SS-...jsonl`.
function collect() {
  const records = [];
  const root = colaDir('cola');
  if (!root || !fs.existsSync(root)) return records;

  const files = walkDir(root, /^.*\.jsonl$/);

  for (const file of files) {
    if (fileUnchanged(file)) continue;
    const lines = readJsonLines(file);
    markFile(file);

    // Session id = parent dir name + filename; this matches what chat-history.db
    // uses as `agent_session.transcript_path` so joins stay stable.
    const sessionId = path.basename(path.dirname(file)) + '/' + path.basename(file, '.jsonl');

    for (const line of lines) {
      if (!line || line.type !== 'message') continue;
      const message = line.message;
      if (!message) continue;

      const usage = message.usage;
      if (!usage) continue;

      const totalTokens = safeInt(usage.totalTokens);
      if (totalTokens <= 0) continue;

      // Cola's `input` is the *non-cached* input by convention; cacheRead /
      // cacheWrite are tracked separately so we can price them at their own
      // rates. If the total doesn't match (older clients may under-report),
      // fall back to summing the parts and record the discrepancy as non-cache
      // input so the dashboard total stays correct.
      const inputOther = safeInt(usage.input);
      const output = safeInt(usage.output);
      const cacheRead = safeInt(usage.cacheRead);
      const cacheWrite = safeInt(usage.cacheWrite);

      // Prefer the transcript's own timestamp; fall back to file mtime when
      // a line is missing one (rare, but keeps re-scans idempotent).
      const timestamp = formatTimestamp(line.timestamp || message.timestamp) ||
        formatTimestamp(fs.statSync(file).mtimeMs);
      if (!timestamp) continue;

      // Sanity: ensure input+output+cacheRead+cacheWrite ≥ totalTokens.
      // When it doesn't (legacy clients), attribute the gap to cacheRead so
      // totals reconcile. Better to over-read cache than to silently inflate
      // non-cached input (which costs ~10x more).
      const accounted = inputOther + output + cacheRead + cacheWrite;
      let adjustedCacheRead = cacheRead;
      let adjustedInput = inputOther;
      if (accounted < totalTokens) {
        adjustedCacheRead += (totalTokens - accounted);
      } else if (inputOther + cacheRead > totalTokens) {
        // inputOther sometimes double-counts cached tokens; trim non-cached
        // input down so the row matches the provider's total.
        const overshoot = (inputOther + cacheRead) - totalTokens;
        adjustedInput = Math.max(0, inputOther - overshoot);
      }

      records.push({
        agent: 'cola',
        session_id: sessionId,
        timestamp,
        model: message.model || null,
        input_tokens: adjustedInput,
        output_tokens: output,
        cache_read_tokens: adjustedCacheRead,
        cache_creation_tokens: cacheWrite,
        reasoning_tokens: 0,
        total_tokens: adjustedInput + output + adjustedCacheRead + cacheWrite,
        source_file: file
      });
    }
  }

  return records;
}

module.exports = { collect };