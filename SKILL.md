# Skill: Token Usage Dashboard

跨 AI Agent Token 用量统计看板 Skill。

## When to use

当用户想要：
- 查看自己在多个 AI coding agent（Codex / Claude Code / Kimi Code / WorkBuddy）上的 token 用量
- 统计不同模型的用量
- 按天查看 token 使用热力图
- 导出/导入用量数据以跨电脑同步
- 启动/停止本地看板服务

## Installation

```bash
git clone https://github.com/Sukisama/token-usage-dashboard.git ~/.agents/skills/token-usage-dashboard
cd ~/.agents/skills/token-usage-dashboard
npm install
```

## Commands

- `npm start` — 启动本地服务并在浏览器打开看板
- `npm run electron` — 启动桌面版（需先 `npm install electron --save-dev`）

## Project location

用户本地项目默认路径：`~/Documents/kimi/token-usage-dashboard`
数据文件：`~/.token-usage-dashboard/usage.db`

## Notes

- 只读取本地日志文件，不上传任何数据
- Cursor 本地没有 token 用量数据，无法统计
- 旧电脑数据可通过「导出数据」生成 `.db` 文件，在新电脑「导入数据」合并
