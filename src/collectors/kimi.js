const fs = require('fs');
const path = require('path');
const { readJsonLines, walkDir, formatTimestamp, safeInt, fileUnchanged, markFile } = require('./utils');
const { dirs: kimiDirs, dir: kimiDir } = require('./paths');

// Kimi wire.jsonl events share the same shape across the CLI and the desktop
// app; only the source directory differs. We collect from every configured
// root and tag each row with the source (`kimi-code` for CLI, `kimi-app` for
// the desktop app) so the dashboard can break usage down by surface.
//
// Source: ~/.kimi-code/sessions/**/*.jsonl (CLI) and
//         ~/Library/Application Support/kimi-desktop/.../kimi-code/home/sessions/**/*.jsonl (App).
// Per-turn usage lives on lines like:
//   {"type":"context.append_loop_event","event":{"type":"step.end", ...,
//     "usage":{"inputOther":..., "output":..., "inputCacheRead":..., "inputCacheCreation":...}}}
// The model name is on the sibling event/turn line; we track the most recent
// value so a switch mid-session attributes correctly.
function collectFrom(root, source) {
  const records = [];
  if (!fs.existsSync(root)) return records;

  const files = walkDir(root, /^wire\.jsonl$/);
  for (const file of files) {
    if (fileUnchanged(file)) continue;
    const lines = readJsonLines(file);
    markFile(file);

    // Stable session id that includes the workspace dir + the session dir,
    // so sessions in different workspaces don't collide and the same session
    // re-parsed across CLI/App stays distinct (different source tags cover
    // the second axis).
    const parts = file.split(path.sep);
    const sessionIdx = parts.indexOf('sessions');
    let sessionId;
    if (sessionIdx > 0 && parts[sessionIdx + 1]) {
      // App layout: .../sessions/<workspace>/<sessionId>/agents/.../wire.jsonl
      sessionId = parts.slice(sessionIdx, sessionIdx + 2).join('/');
    } else {
      sessionId = path.basename(path.dirname(file));
    }
    // Prefix so CLI/App sessions (same id) never collide in UNIQUE(agent,..).
    sessionId = source + ':' + sessionId;

    let currentModel = null;
    for (const line of lines) {
      if (!line || typeof line !== 'object') continue;

      // The model lives at `.event.model` on the same step.end event that
      // carries the usage. Snapshot it whenever we see it.
      const event = line.event || line;
      if (typeof event.model === 'string' && event.model) {
        currentModel = event.model;
      }

      const usage = event.usage;
      if (!usage) continue;

      const timestamp = formatTimestamp(line.time || line.timestamp || event.time);
      if (!timestamp) continue;

      const inputOther = safeInt(usage.inputOther);
      const output = safeInt(usage.output);
      const cacheRead = safeInt(usage.inputCacheRead);
      const cacheCreation = safeInt(usage.inputCacheCreation);

      records.push({
        agent: source,
        session_id: sessionId,
        timestamp,
        model: currentModel,
        input_tokens: inputOther,
        output_tokens: output,
        cache_read_tokens: cacheRead,
        cache_creation_tokens: cacheCreation,
        reasoning_tokens: 0,
        total_tokens: inputOther + output + cacheRead + cacheCreation,
        source_file: file
      });
    }
  }
  return records;
}

function collect() {
  // Source roots may come from collectors.json as either a string or an array.
  // Accept both so users can extend the list without editing code.
  const roots = kimiDirs('kimi');
  let records = [];
  // kimi-code CLI is the original behaviour; keep it first and tag it the same
  // way as before so historical rows stay matched.
  records = records.concat(collectFrom(kimiDir('kimi'), 'kimi-code'));
  // Anything else declared under `kimi` becomes the desktop app.
  for (const root of roots.slice(1)) {
    records = records.concat(collectFrom(root, 'kimi-app'));
  }
  return records;
}

module.exports = { collect };