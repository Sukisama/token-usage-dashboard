/**
 * kimi.js — Kimi (月之暗面) rate-limit collector.
 *
 * Token: opencodex auth store active account for provider 'kimi'.
 * Endpoint: GET https://api.kimi.com/coding/v1/usages
 *   Returns { usage, totalQuota, limits: [ { name, window:{duration,timeUnit}, detail:{limit,used,remaining,utilization,resetTime} } ] }
 *   Windows are matched by duration+unit (5h, 7d) or by label regex.
 */
'use strict';

const { readOcxToken, REQUEST_TIMEOUT_MS } = require('./credentials');
const { asRecord, toFiniteNumber, normalizePercent, window, safeFetch } = require('./parse-helpers');

const KIMI_USAGE_URL = 'https://api.kimi.com/coding/v1/usages';

function kimiLimitLabel(item, detail) {
  return [item.name, item.title, item.scope, detail.name, detail.title]
    .filter((v) => typeof v === 'string')
    .join(' ')
    .toLowerCase();
}

function parseKimiRow(value, resetFallback) {
  const row = asRecord(value);
  if (!row) return null;
  const resetAt = (() => {
    const r = row.resetTime ?? row.resetAt ?? row.reset_time ?? row.reset_at;
    return r;
  })() ?? (resetFallback ? (resetFallback.resetTime ?? resetFallback.resetAt) : undefined);

  const limit = toFiniteNumber(row.limit);
  if (limit !== undefined && limit > 0) {
    let used = toFiniteNumber(row.used);
    if (used === undefined) {
      const remaining = toFiniteNumber(row.remaining);
      if (remaining !== undefined) used = limit - remaining;
    }
    if (used !== undefined) {
      const percent = normalizePercent((used / limit) * 100);
      if (percent !== undefined) return { percent, resetAt };
    }
  }
  const direct = normalizePercent(row.utilization ?? row.percent ?? row.usedPercent ?? row.used_percent);
  return direct === undefined ? null : { percent: direct, resetAt };
}

function isKimiFiveHour(item, detail, win) {
  const duration = toFiniteNumber(win.duration ?? item.duration ?? detail.duration);
  const unit = String(win.timeUnit ?? item.timeUnit ?? detail.timeUnit ?? '').toUpperCase();
  if ((unit.includes('MINUTE') && duration === 300) || (unit.includes('HOUR') && duration === 5)) return true;
  return /(^|\b)5\s*(?:h|hour)/.test(kimiLimitLabel(item, detail));
}

function isKimiWeekly(item, detail, win) {
  const duration = toFiniteNumber(win.duration ?? item.duration ?? detail.duration);
  const unit = String(win.timeUnit ?? item.timeUnit ?? detail.timeUnit ?? '').toUpperCase();
  if ((unit.includes('DAY') && duration === 7) || (unit.includes('HOUR') && duration === 168)) return true;
  return /weekly|7\s*(?:d|day)/.test(kimiLimitLabel(item, detail));
}

async function fetch(sub) {
  const cred = readOcxToken('kimi');
  if (!cred || !cred.access) {
    return { status: 'auth_expired', message: '未检测到本地 Kimi 登录态（~/.opencodex/auth.json）。请先登录 opencodex 或 kimi-code。' };
  }

  let resp;
  try {
    resp = await safeFetch(KIMI_USAGE_URL, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${cred.access}` },
    }, REQUEST_TIMEOUT_MS);
  } catch (err) {
    return { status: 'error', message: '请求 Kimi 用量接口失败: ' + err.message };
  }

  if (resp.status === 401 || resp.status === 403) {
    return { status: 'auth_expired', message: 'Kimi 登录态已过期，请重新登录。' };
  }
  if (!resp.ok) return { status: 'error', message: `Kimi 返回 ${resp.status}` };

  const body = asRecord(await resp.json().catch(() => null));
  if (!body) return { status: 'error', message: 'Kimi 返回空响应' };

  // Unwrap a { data: {...} } envelope when the outer shell lacks usage fields.
  let payload = body;
  const nested = asRecord(body.data);
  if (nested) {
    const outerHas = body.usage !== undefined || body.limits !== undefined || body.totalQuota !== undefined;
    const nestedHas = nested.usage !== undefined || nested.limits !== undefined || nested.totalQuota !== undefined;
    if (!outerHas && nestedHas) payload = nested;
  }

  let fiveHour = null;
  let weekly = null;
  if (Array.isArray(payload.limits)) {
    for (const raw of payload.limits) {
      const item = asRecord(raw);
      if (!item) continue;
      const detail = asRecord(item.detail) ?? item;
      const win = asRecord(item.window) ?? {};
      if (!fiveHour && isKimiFiveHour(item, detail, win)) fiveHour = parseKimiRow(detail, win);
      if (!weekly && isKimiWeekly(item, detail, win)) weekly = parseKimiRow(detail, win);
      if (fiveHour && weekly) break;
    }
  }
  // Fallback: Kimi's top-level `usage` field often holds the subscription-credit total.
  if (!weekly) weekly = parseKimiRow(payload.usage);

  return {
    fiveHour: fiveHour ? window({ percent: fiveHour.percent, resetAt: fiveHour.resetAt }) : window({}),
    weekly: weekly ? window({ percent: weekly.percent, resetAt: weekly.resetAt }) : window({}),
    monthly: window({}),
    plan_name: sub.plan_name || '',
    monthly_cost: sub.monthly_cost || 0,
    status: 'ok',
    message: '',
  };
}

module.exports = { platform: 'kimi', label: 'Kimi (月之暗面)', fetch };
