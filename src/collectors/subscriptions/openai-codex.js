/**
 * openai-codex.js — OpenAI Codex / ChatGPT rate-limit collector.
 *
 * Token: ~/.codex/auth.json (tokens.access_token + tokens.account_id).
 * Endpoint: GET https://chatgpt.com/backend-api/wham/usage
 *   Returns rate_limit.{primary,secondary,tertiary}_window each with
 *   { used_percent, reset_at, limit_window_seconds }.
 * Mapping (copied from opencodex codex/quota.ts parseUsageQuota):
 *   - primary window = weekly unless its limit_window_seconds >= 28 days (then monthly)
 *   - secondary/tertiary windows are fallbacks / monthly
 *   - a ~5h rolling window (if present among the three) is surfaced as fiveHour
 */
'use strict';

const { readCodexToken, REQUEST_TIMEOUT_MS } = require('./credentials');
const { asRecord, normalizePercent, normalizeResetMs, window, safeFetch } = require('./parse-helpers');

const WHAM_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const MONTHLY_WINDOW_MIN_SECONDS = 28 * 24 * 60 * 60;

function winPercent(w) {
  const r = asRecord(w);
  if (!r) return { percent: undefined, resetAt: undefined };
  return {
    percent: normalizePercent(r.used_percent),
    resetAt: r.reset_at,
  };
}

function isExplicitMonthlyWindow(w) {
  const r = asRecord(w);
  const seconds = r && r.limit_window_seconds;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= MONTHLY_WINDOW_MIN_SECONDS;
}

// A ~5h rolling window: 4.5h–5.5h.
function isFiveHourWindow(w) {
  const r = asRecord(w);
  const seconds = r && r.limit_window_seconds;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 16200 && seconds <= 19800;
}

async function fetch(sub) {
  const tok = readCodexToken();
  if (!tok || !tok.access) {
    return { status: 'auth_expired', message: '未检测到本地 Codex 登录态（~/.codex/auth.json）。请先登录 Codex。' };
  }

  let resp;
  try {
    resp = await safeFetch(WHAM_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${tok.access}`,
        'ChatGPT-Account-Id': tok.accountId || '',
      },
    }, REQUEST_TIMEOUT_MS);
  } catch (err) {
    return { status: 'error', message: '请求 Codex 用量接口失败: ' + err.message };
  }

  if (resp.status === 401 || resp.status === 403) {
    return { status: 'auth_expired', message: 'Codex 登录态已过期，请重新登录 Codex。' };
  }
  if (!resp.ok) return { status: 'error', message: `Codex 返回 ${resp.status}` };

  const data = asRecord(await resp.json().catch(() => null));
  if (!data) return { status: 'error', message: 'Codex 返回空响应' };

  const rl = asRecord(data.rate_limit);
  if (!rl) return { status: 'ok', message: 'Codex 未返回速率窗口', fiveHour: window({}), weekly: window({}), monthly: window({}) };

  const primary = rl.primary_window;
  const secondary = rl.secondary_window;
  const tertiary = rl.tertiary_window;
  const primaryP = winPercent(primary);
  const secondaryP = winPercent(secondary);
  const tertiaryP = winPercent(tertiary);
  const primaryIsMonthly = isExplicitMonthlyWindow(primary);

  const thirtyDayOnly = ['go', 'free'].includes(String(data.plan_type || '').trim().toLowerCase());

  // Weekly = primary (unless primary is monthly → secondary fallback)
  const weeklyPercent = primaryIsMonthly ? secondaryP.percent : (primaryP.percent ?? secondaryP.percent);
  const weeklyReset = primaryIsMonthly ? secondaryP.resetAt : (primaryP.percent !== undefined ? primaryP.resetAt : secondaryP.resetAt);
  // Monthly
  const monthlyPercent = primaryIsMonthly ? (primaryP.percent ?? tertiaryP.percent) : tertiaryP.percent;
  const monthlyReset = primaryIsMonthly && primaryP.percent !== undefined ? primaryP.resetAt : tertiaryP.resetAt;

  // 5-hour rolling window: scan all three for a ~5h window.
  let fiveHourP = null, fiveHourReset = null;
  for (const w of [primary, secondary, tertiary]) {
    if (isFiveHourWindow(w)) {
      const p = winPercent(w);
      fiveHourP = p.percent; fiveHourReset = p.resetAt; break;
    }
  }

  return {
    fiveHour: fiveHourP !== undefined && fiveHourP !== null
      ? window({ percent: fiveHourP, resetAt: fiveHourReset })
      : window({}),
    weekly: weeklyPercent !== undefined ? window({ percent: weeklyPercent, resetAt: weeklyReset }) : window({}),
    monthly: monthlyPercent !== undefined ? window({ percent: monthlyPercent, resetAt: monthlyReset }) : window({}),
    plan_name: data.plan_type || sub.plan_name || '',
    monthly_cost: sub.monthly_cost || 0,
    status: 'ok',
    message: '',
  };
}

module.exports = { platform: 'openai-codex', label: 'OpenAI Codex', fetch };
