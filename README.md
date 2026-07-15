# Token Usage Dashboard

A local dashboard that aggregates LLM token usage across multiple AI coding agents.

跨 Agent Token 用量统计本地看板。

## Features

- 🔌 Auto-collect token usage from local agent logs
- 📊 Daily heatmap (GitHub-style contribution graph)
- 🤖 Per-agent and per-model breakdown
- 🌙 Dark theme with orange accent
- 💻 Desktop floating widget showing today's usage
- ⌨️ Global hotkey support (Electron)

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

## Data Storage

Usage data is stored locally in `~/.token-usage-dashboard/usage.db` (SQLite). No data is sent to any server.

## License

MIT
