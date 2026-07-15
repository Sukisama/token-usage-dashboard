# Token Usage Dashboard

A local dashboard that aggregates LLM token usage across multiple AI coding agents.

跨 Agent Token 用量统计本地看板。

## Features

- 🔌 Auto-collect token usage from local agent logs (incremental — only re-parses changed files)
- 💰 Estimated cost in USD, per agent / per model / per record (editable price table in `src/pricing.js`)
- 📈 Daily usage trend chart (agent-stacked, 7 / 30 / 90 / all-day ranges)
- 📊 Daily heatmap (GitHub-style contribution graph) — click a day to drill into its records
- 🤖 Per-agent and per-model breakdown
- 🌙 Dark theme with orange accent
- 💻 Desktop floating widget showing today's usage
- ⌨️ Global hotkey support (Electron)

### Rebuild

The **Rebuild** button wipes the aggregated stats and re-parses all logs from
scratch. Use it after upgrading (so corrected model names / timestamps replace
old rows) or if numbers look wrong. Your raw agent logs are never modified.

### Cost estimates

Costs are **estimates**. Prices live in `src/pricing.js` (USD per 1M tokens) —
edit them to match what you actually pay. Unknown models show `—` (no cost),
never a fabricated number. Token accounting is normalized so cached input is
priced separately from fresh input across all agents.

## Supported Agents

| Agent | Data Source | Status |
|---|---|---|
| OpenAI Codex | `~/.codex/sessions/*/rollout-*.jsonl` | ✅ |
| Claude Code | `~/.claude/projects/*/*.jsonl` | ✅ |
| Kimi Code | `~/.kimi-code/sessions/*/wire.jsonl` | ✅ |
| WorkBuddy | `~/.workbuddy/traces/` + `projects/` | ✅ |
| Cursor | No local token data available | ❌ |

## Quick Start

```bash
git clone https://github.com/Sukisama/token-usage-dashboard.git
cd token-usage-dashboard
npm install
npm start
```

Then open `http://localhost:7373` and click **Scan Logs**.

## Desktop Mode with Global Hotkey

### Option A: Electron (recommended)

```bash
npm install electron --save-dev
npm run electron
```

Default global hotkey:

- macOS: `Cmd + Shift + T`
- Windows/Linux: `Ctrl + Shift + T`

### Option B: macOS Floating Widget

Double-click `scripts/LizhiTokenWidget.app` to open a small floating widget that shows today's token usage. Click it to open the full dashboard. Right-click to quit.

You can also run it directly:

```bash
python3 scripts/desktop-widget.py
```

### Option C: macOS Quick Launcher

Double-click `scripts/LizhiTokenUsage.app` to start the server and open the dashboard in browser.

To bind a hotkey:

1. Open **System Settings → Keyboard → Keyboard Shortcuts → App Shortcuts**
2. Add `LizhiTokenUsage.app` and assign your preferred shortcut
3. Or use Raycast / Alfred to bind `scripts/launch.sh`

### Option D: Always-Running Background Service (macOS)

Use launchd to keep the server running in the background:

```bash
cp scripts/com.token-usage-dashboard.server.plist ~/Library/LaunchAgents/
# Replace {USER_HOME} with your actual home path, e.g. /Users/doris
sed -i '' "s|{USER_HOME}|$HOME|g" ~/Library/LaunchAgents/com.token-usage-dashboard.server.plist
launchctl load ~/Library/LaunchAgents/com.token-usage-dashboard.server.plist
```

The service will auto-start on login and restart if it crashes. Access the dashboard at `http://localhost:7373`.

## Data Storage

Usage data is stored locally in `~/.token-usage-dashboard/usage.db` (SQLite). No data is sent to any server.

## License

MIT
