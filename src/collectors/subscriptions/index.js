/**
 * subscriptions/index.js — Subscription platform collectors registry
 *
 * Each collector exports:
 *   {
 *     platform: 'anthropic' | 'openai-codex' | 'kimi' | 'google-antigravity' | 'minimax',
 *     label: 'Anthropic Claude',
 *     // Returns normalized snapshot for the given subscription row.
 *     fetch: async (sub) => ({
 *       limit5h_used, limit5h_total, limit5h_reset,
 *       limit_week_used, limit_week_total, limit_week_reset,
 *       plan_name, cycle_start, cycle_end, monthly_cost,
 *       status: 'ok' | 'auth_expired' | 'rate_limited' | 'error' | 'unavailable',
 *       message: 'human-readable'
 *     })
 *   }
 */
'use strict';

const collectors = [
  // Real collectors (registered here as they become available).
  // require('./anthropic'),
  // require('./openai-codex'),
  // require('./kimi'),
  // require('./google-antigravity'),
  // require('./minimax'),
];

// Refresh a single subscription. Returns the snapshot or throws.
async function refreshSubscription(sub) {
  const collector = collectors.find(c => c.platform === sub.platform);
  if (!collector) {
    return {
      status: 'unavailable',
      message: `${sub.platform} 平台采集器尚未实现，请手动填写限额`
    };
  }
  try {
    const result = await collector.fetch(sub);
    return result;
  } catch (err) {
    return {
      status: 'error',
      message: err && err.message ? err.message : String(err)
    };
  }
}

module.exports = { collectors, refreshSubscription };