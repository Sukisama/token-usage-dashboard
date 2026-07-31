/**
 * format.js — Shared formatting utilities (global: window.F)
 *
 * Extracted from app.js to avoid duplication across pages.
 */
(function () {
  'use strict';

  const AGENT_COLORS = {
    'codex': '#f97316',
    'claude': '#f472b6',
    'kimi-code': '#38bdf8',
    'kimi-app': '#0ea5e9',
    'workbuddy': '#a78bfa',
    'cola': '#facc15',
    'cursor': '#4ade80',
    'unknown': '#a1a1aa'
  };

  const MODEL_PALETTE = [
    '#f97316', '#f472b6', '#38bdf8', '#a78bfa', '#4ade80',
    '#fbbf24', '#2dd4bf', '#fb7185', '#818cf8', '#a3e635',
    '#22d3ee', '#e879f9'
  ];

  function formatNumber(num) {
    if (!num) return '0';
    if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return String(num);
  }

  function formatCost(usd) {
    if (usd == null) return '\u2014';
    if (usd === 0) return '$0';
    if (usd < 0.01) return '<$0.01';
    if (usd < 100) return '$' + usd.toFixed(2);
    return '$' + usd.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }

  function formatDateTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function agentColor(agent) {
    return AGENT_COLORS[agent] || AGENT_COLORS.unknown;
  }

  // Build model-to-color map from rows (biggest-model-first assignment).
  let modelColorMap = new Map();
  function buildModelColors(rows) {
    const totals = new Map();
    for (const r of rows) totals.set(r.model, (totals.get(r.model) || 0) + r.total_tokens);
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    modelColorMap = new Map();
    sorted.forEach(([m], i) => modelColorMap.set(m, MODEL_PALETTE[i % MODEL_PALETTE.length]));
  }
  function modelColor(m) { return modelColorMap.get(m) || AGENT_COLORS.unknown; }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function formatPercent(ratio) {
    if (ratio == null || isNaN(ratio)) return '\u2014';
    return (ratio * 100).toFixed(1) + '%';
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  // Delta arrow for week-over-week / month-over-month comparisons.
  // Returns e.g. "↑ 18.3%" (green), "↓ 3.2%" (red), "— 0%" (neutral).
  function formatDelta(current, previous) {
    if (previous == null || previous === 0 || current == null) return '';
    const pct = ((current - previous) / Math.abs(previous)) * 100;
    if (Math.abs(pct) < 0.1) return '\u2014 0%';
    const arrow = pct > 0 ? '\u2191' : '\u2193';
    return `${arrow} ${Math.abs(pct).toFixed(1)}%`;
  }

  function relativeDays(dateStr) {
    if (!dateStr) return '\u2014';
    const d = new Date(dateStr + 'T00:00:00');
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diff = Math.round((now - d) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    if (diff < 7) return diff + ' 天前';
    if (diff < 30) return Math.floor(diff / 7) + ' 周前';
    if (diff < 365) return Math.floor(diff / 30) + ' 个月前';
    return Math.floor(diff / 365) + ' 年前';
  }

  window.F = {
    AGENT_COLORS,
    MODEL_PALETTE,
    formatNumber,
    formatCost,
    formatDate,
    formatDateTime,
    formatPercent,
    formatBytes,
    formatDelta,
    relativeDays,
    esc,
    agentColor,
    buildModelColors,
    modelColor,
    bytesToBase64
  };
})();
