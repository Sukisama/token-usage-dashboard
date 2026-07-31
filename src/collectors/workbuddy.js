const fs = require('fs');
const path = require('path');
const os = require('os');
const { readJsonLines, walkDir, formatTimestamp, safeInt, fileUnchanged, markFile } = require('./utils');

const WORKBUDDY_DIR = require('./paths').dir('workbuddy');

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

    // Prefer the per-role counts from modelInfo — verified against real trace
    // files, they are accurate and sum exactly to trace.totalTokens. The old
    // "treat the remainder as one input blob" path is only a fallback for
    // traces that don't expose modelInfo at all.
    const miInput = safeInt(modelInfo.totalInputTokens);
    const miOutput = safeInt(modelInfo.totalOutputTokens);
    const miCached = safeInt(modelInfo.totalCachedTokens);

    let inputTokens, outputTokens, cacheReadTokens, totalForRow;
    if (miInput || miOutput || miCached) {
      cacheReadTokens = miCached;
      inputTokens = Math.max(0, miInput - miCached);   // non-cached input
      outputTokens = miOutput;
      totalForRow = miInput + miOutput;                // == trace.totalTokens
    } else {
      const traceCached = safeInt(modelInfo.totalCachedTokens);
      cacheReadTokens = traceCached;
      inputTokens = Math.max(0, totalTokens - traceCached);
      outputTokens = 0;
      totalForRow = inputTokens + traceCached;
    }

    // Prefer the trace's own start time so re-scans stay idempotent (mtime
    // changes on rewrite would create duplicate rows and inflate totals).
    const timestamp = formatTimestamp(trace.startedAt || trace.endedAt) ||
      formatTimestamp(fs.statSync(file).mtime);

    records.push({
      agent: 'workbuddy',
      session_id: path.basename(file, '.json'),
      timestamp,
      model: Array.isArray(modelInfo.models) ? modelInfo.models.join(',') : null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheReadTokens,
      cache_creation_tokens: 0,
      reasoning_tokens: 0,
      // Standard total = the trace's full token count (incl. cache reads).
      total_tokens: totalForRow,
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

      const rawInput = safeInt(usage.input_tokens || usage.inputTokens || usage.prompt_tokens);
      const output = safeInt(usage.output_tokens || usage.outputTokens || usage.completion_tokens);
      const cacheRead = safeInt(
        usage.cache_read_input_tokens ||
        (usage.inputTokensDetails && usage.inputTokensDetails[0]?.cached_tokens) ||
        (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens)
      );
      // prompt_tokens includes cached; keep only the non-cached part.
      const input = Math.max(0, rawInput - cacheRead);

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
        // Standard total = all tokens processed (input incl. cached + output).
        total_tokens: input + cacheRead + output,
        source_file: file
      });
    }
  }

  return records;
}

module.exports = { collect };
