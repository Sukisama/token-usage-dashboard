const fs = require('fs');
const path = require('path');
const os = require('os');
const { readJsonLines, walkDir, formatTimestamp, safeInt, fileUnchanged, markFile } = require('./utils');

const WORKBUDDY_DIR = path.join(os.homedir(), '.workbuddy');

function collect() {
  const records = [];
  if (!fs.existsSync(WORKBUDDY_DIR)) return records;

  // Trace-level summaries
  const traceFiles = walkDir(path.join(WORKBUDDY_DIR, 'traces'), /^trace_.*\.json$/);
  for (const file of traceFiles) {
    if (fileUnchanged(file)) continue;
    markFile(file);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      continue;
    }

    const trace = data.trace || data;
    const modelInfo = trace.modelInfo || {};
    const totalTokens = safeInt(trace.totalTokens || modelInfo.totalTokens);
    if (totalTokens === 0) continue;

    // Prefer the trace's own start time so re-scans stay idempotent (mtime
    // changes on rewrite would create duplicate rows and inflate totals).
    const timestamp = formatTimestamp(trace.startedAt || trace.endedAt) ||
      formatTimestamp(fs.statSync(file).mtime);

    records.push({
      agent: 'workbuddy',
      session_id: path.basename(file, '.json'),
      timestamp,
      model: Array.isArray(modelInfo.models) ? modelInfo.models.join(',') : null,
      input_tokens: safeInt(modelInfo.totalInputTokens),
      output_tokens: safeInt(modelInfo.totalOutputTokens),
      cache_read_tokens: safeInt(modelInfo.totalCachedTokens),
      cache_creation_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: totalTokens,
      source_file: file
    });
  }

  // Project session details
  const projectFiles = walkDir(path.join(WORKBUDDY_DIR, 'projects'), /^.*\.jsonl$/);
  for (const file of projectFiles) {
    if (fileUnchanged(file)) continue;
    const lines = readJsonLines(file);
    markFile(file);
    const sessionId = path.basename(file, '.jsonl');

    for (const line of lines) {
      const usage = line.message?.usage || line.providerData?.usage || line.providerData?.rawUsage;
      if (!usage) continue;

      const timestamp = formatTimestamp(line.timestamp || line.message?.timestamp);
      if (!timestamp) continue;

      const input = safeInt(usage.input_tokens || usage.inputTokens || usage.prompt_tokens);
      const output = safeInt(usage.output_tokens || usage.outputTokens || usage.completion_tokens);
      const total = safeInt(usage.total_tokens || usage.totalTokens) || (input + output);
      const cacheRead = safeInt(
        usage.cache_read_input_tokens ||
        (usage.inputTokensDetails && usage.inputTokensDetails[0]?.cached_tokens) ||
        (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens)
      );

      records.push({
        agent: 'workbuddy',
        session_id: sessionId,
        timestamp,
        model: line.model || line.message?.model || null,
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cacheRead,
        cache_creation_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: total,
        source_file: file
      });
    }
  }

  return records;
}

module.exports = { collect };
