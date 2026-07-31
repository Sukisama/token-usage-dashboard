/**
 * anthropic.js — Anthropic Claude rate-limit collector.
 *
 * Token: local Claude Code credential (macOS Keychain or ~/.claude/.credentials.json).
 * Endpoint: GET https://api.anthropic.com/api/oauth/usage
 *   Returns five_hour { utilization, resets_at } and seven_day { utilization, resets_at }
 *   as PERCENTAGES plus a reset timestamp (epoch-ms string/number).
 */
'use strict';

const { detectClaudeToken, refreshClaudeToken, readOcxToken, REQUEST_TIMEOUT_MS } = require('./credentials');
const { asRecord, window, safeFetch } = require('./parse-helpers');

const ANTHROPIC_BETA = 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05';

function bucket(rec) {
  const r = asRecord(rec);
  if (!r) return null;
  return {
    percent: r.utilization,
    resetAt: r.resets_at,
  };
}

async function fetch(sub) {
  const cred = detectClaudeToken() || readOcxToken('anthropic');
  if (!cred || !cred.access) {
    return { status: 'auth_expired', message: '未检测到本地 Claude 登录态（Keychain / ~/.claude/.credentials.json / opencodex）。请先登录 Claude Code 或 opencodex。' };
  }

  let access = cred.access;
  // Proactively refresh if the token looks expired.
  if (cred.expires && cred.expires < Date.now() + 60_000 && cred.refresh) {
    const refreshed = await refreshClaudeToken(cred.refresh);
    if (refreshed) access = refreshed;
  }

  let resp;
  try {
    resp = await safeFetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'User-Agent': 'claude-cli/2.1.63 (external, cli)',
        'anthropic-beta': ANTHROPIC_BETA,
        Authorization: `Bearer ${access}`,
      },
    }, REQUEST_TIMEOUT_MS);
  } catch (err) {
    return { status: 'error', message: '请求 Anthropic 用量接口失败: ' + err.message };
  }

  if (resp.status === 401 || resp.status === 403) {
    return { status: 'auth_expired', message: 'Claude 登录态已过期，请重新登录 Claude Code。' };
  }
  if (!resp.ok) {
    return { status: 'error', message: `Anthropic 返回 ${resp.status}` };
  }

  const body = asRecord(await resp.json().catch(() => null));
  if (!body) return { status: 'error', message: 'Anthropic 返回空响应' };

  const fiveHour = bucket(body.five_hour);
  const sevenDay = bucket(body.seven_day);

  return {
    fiveHour: fiveHour ? window({ percent: fiveHour.percent, resetAt: fiveHour.resetAt }) : window({}),
    weekly: sevenDay ? window({ percent: sevenDay.percent, resetAt: sevenDay.resetAt }) : window({}),
    monthly: window({}),
    plan_name: sub.plan_name || '',
    monthly_cost: sub.monthly_cost || 0,
    status: 'ok',
    message: '',
  };
}

module.exports = { platform: 'anthropic', label: 'Anthropic Claude', fetch };
