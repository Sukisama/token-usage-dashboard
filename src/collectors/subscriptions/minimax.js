/**
 * minimax.js — MiniMax CN collector.
 *
 * opencodex does not implement an automatic quota endpoint for MiniMax, so
 * this platform remains manual-only: the user fills the plan + limits by hand.
 */
'use strict';

async function fetch() {
  return {
    fiveHour: { used: 0, total: 0, percent: null },
    weekly: { used: 0, total: 0, percent: null },
    monthly: { used: 0, total: 0, percent: null },
    status: 'unavailable',
    message: 'MiniMax 暂不支持自动抓取，请手动填写套餐与限额。',
  };
}

module.exports = { platform: 'minimax', label: 'MiniMax', fetch };
