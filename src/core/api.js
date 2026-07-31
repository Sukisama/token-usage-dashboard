/**
 * api.js — API layer (global: window.API)
 *
 * All server calls go through here so pages share the same fetch logic.
 */
(function () {
  'use strict';

  async function _get(path) {
    const res = await fetch(path);
    return res.json();
  }

  async function _post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return res.json();
  }

  async function _put(path, body) {
    const res = await fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return res.json();
  }

  const API = {
    // Data ops
    scanAll: () => _get('/api/scan'),
    rebuild: () => _post('/api/rebuild'),

    // Summary
    getSummary: () => _get('/api/summary'),
    getPeriodSummary: (period) => _get(`/api/period-summary?period=${period}`),

    // Trend
    getDailyUsage: (agent) => _get(`/api/daily?agent=${encodeURIComponent(agent || 'all')}`),
    getDailyByAgent: (agent) => _get(`/api/daily-agents?agent=${encodeURIComponent(agent || 'all')}`),
    getDailyByModel: (agent) => _get(`/api/daily-models?agent=${encodeURIComponent(agent || 'all')}`),
    getDailyCost: (agent, days) => _get(`/api/daily-cost?agent=${encodeURIComponent(agent || 'all')}&days=${days || 30}`),
    getDailyCostByAgent: (days) => _get(`/api/daily-cost-agents?days=${days || 30}`),

    // Agent / model
    getAgents: () => _get('/api/agents'),
    getAgentDetail: (agent) => _get(`/api/agent-detail?agent=${encodeURIComponent(agent)}`),
    getModelUsage: (agent) => _get(`/api/models?agent=${encodeURIComponent(agent || 'all')}`),

    // Records
    getRecords: (options) => {
      const params = new URLSearchParams(options);
      return _get(`/api/records?${params}`);
    },

    // Day agent summary (per-agent per-model token totals for a date)
    getDaySummary: (date) => _get(`/api/day-summary?date=${encodeURIComponent(date)}`),

    // Hourly
    getHourly: (agent, date) => {
      let q = `/api/hourly`;
      const params = new URLSearchParams();
      if (agent && agent !== 'all') params.set('agent', agent);
      if (date) params.set('date', date);
      const s = params.toString();
      return _get(s ? `${q}?${s}` : q);
    },

    // Stats
    getStats: () => _get('/api/stats'),

    // Pricing
    getPricing: () => _get('/api/pricing'),
    updatePricing: (prices) => _put('/api/pricing', { prices }),

    // Subscriptions
    getSubscriptions: () => _get('/api/subscriptions'),
    upsertSubscription: (fields) => _post('/api/subscriptions', fields),
    deleteSubscription: (id) => {
      // _post only handles JSON bodies; DELETE needs a custom fetch
      return fetch(`/api/subscriptions/${id}`, { method: 'DELETE' }).then(r => r.json());
    },
    refreshSubscriptions: (platform) => _post('/api/subscriptions/refresh', { platform }),
    loginSubscription: (platform) => _post('/api/subscriptions/login', { platform }),

    // Export / import
    exportDb: async () => {
      const res = await fetch('/api/export');
      if (!res.ok) return null;
      return res.blob();
    },
    importDb: (base64) => _post('/api/import', { data: base64 }),
  };

  window.API = API;
})();
