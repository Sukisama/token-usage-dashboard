/**
 * subscriptions/index.js — Subscription platform collectors registry.
 *
 * Each collector exports:
 *   { platform, label, fetch }
 * where fetch(sub) returns a normalized snapshot:
 *   {
 *     fiveHour: { used, total, percent, resetAt },   // resetAt = epoch-ms or undefined
 *     weekly:   { used, total, percent, resetAt },
 *     monthly:  { used, total, percent, resetAt },
 *     plan_name, monthly_cost, cycle_start, cycle_end,
 *     status: 'ok' | 'auth_expired' | 'rate_limited' | 'error' | 'unavailable',
 *     message
 *   }
 * Upstream APIs only return utilization percentages + reset timestamps, so
 * `percent` is the primary signal; `used`/`total` are 0 unless the endpoint
 * exposes absolute numbers (it generally does not).
 */
'use strict';

const anthropic = require('./anthropic');
const openaiCodex = require('./openai-codex');
const kimi = require('./kimi');
const googleAntigravity = require('./google-antigravity');
const minimax = require('./minimax');

const collectors = [anthropic, openaiCodex, kimi, googleAntigravity, minimax];

const byPlatform = collectors.reduce((m, c) => { m[c.platform] = c; return m; }, {});

// Refresh a single subscription. Returns the snapshot or a normalized error snapshot.
async function refreshSubscription(sub) {
  const collector = byPlatform[sub.platform];
  if (!collector) {
    return {
      fiveHour: { used: 0, total: 0, percent: null },
      weekly: { used: 0, total: 0, percent: null },
      monthly: { used: 0, total: 0, percent: null },
      status: 'unavailable',
      message: `${sub.platform} 平台采集器尚未实现`,
    };
  }
  try {
    const result = await collector.fetch(sub);
    return result;
  } catch (err) {
    return {
      fiveHour: { used: 0, total: 0, percent: null },
      weekly: { used: 0, total: 0, percent: null },
      monthly: { used: 0, total: 0, percent: null },
      status: 'error',
      message: err && err.message ? err.message : String(err),
    };
  }
}

module.exports = { collectors, refreshSubscription };
