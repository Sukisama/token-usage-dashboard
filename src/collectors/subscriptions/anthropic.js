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
  // Collect candidate tokens from every local source. The Keychain may hold a
  // STALE Claude Code token while opencodex holds a FRESH one (or vice versa),
  // so we try each against the usage API and use the first that returns 200.
  const candidates = [];
  const kc = detectClaudeToken();
  if (kc && kc.access) candidates.push({ access: kc.access, refresh: kc.refresh, expires: kc.expires, src: 'keychain' });
  const oc = readOcxToken('anthropic');
  if (oc && oc.access && !candidates.some(c => c.access === oc.access)) {
    candidates.push({ access: oc.access, refresh: oc.refresh, expires: 0, src: 'opencodex' });
  }
  if (candidates.length === 0) {
    return { status: 'auth_expired', message: '未检测到本地 Claude 登录态（Keychain / ~/.claude / opencodex）。请点「验证登录」运行 ocx login anthropic。' };
  }

  let lastErr = '';
  for (const c of candidates) {
    let access = c.access;
    // Proactively refresh if the token looks expired.
    if (c.expires && c.expires < Date.now() + 60_000 && c.refresh) {
      const refreshed = await refreshClaudeToken(c.refresh);
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
      lastErr = '请求 Anthropic 用量接口失败: ' + err.message;
      continue; // try next candidate
    }

    if (resp.status === 401 || resp.status === 403) {
      // Maybe expired — try a refresh once, then move to the next candidate.
      if (c.refresh) {
        const refreshed = await refreshClaudeToken(c.refresh);
        if (refreshed) {
          try {
            resp = await safeFetch('https://api.anthropic.com/api/oauth/usage', {
              headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'User-Agent': 'claude-cli/2.1.63 (external, cli)',
                'anthropic-beta': ANTHROPIC_BETA,
                Authorization: `Bearer ${refreshed}`,
              },
            }, REQUEST_TIMEOUT_MS);
            if (resp.ok) return parseOk(resp, sub);
          } catch (err) {
            lastErr = '请求 Anthropic 用量接口失败: ' + err.message;
            continue;
          }
        }
      }
      lastErr = `Claude 登录态已过期（${c.src}），请点「验证登录」运行 ocx login anthropic。`;
      continue; // try next candidate
    }
    if (!resp.ok) {
      lastErr = `Anthropic 返回 ${resp.status}`;
      continue;
    }

    return parseOk(resp, sub);
  }

  return { status: 'auth_expired', message: lastErr || 'Claude 所有本地登录态均不可用，请点「验证登录」重新登录。' };
}

function parseOk(resp, sub) {
  return resp.json().catch(() => null).then(body => {
    body = asRecord(body);
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
  });
}

module.exports = { platform: 'anthropic', label: 'Anthropic Claude', fetch };
