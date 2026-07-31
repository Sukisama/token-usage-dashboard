/**
 * parse-helpers.js — Small pure helpers shared by the subscription collectors.
 * Logic mirrors opencodex's providers/quota.ts normalizers (percent clamping,
 * epoch-ms vs ISO reset normalization, safe record access).
 */
'use strict';

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

// Percentages from upstream are 0–100. Clamp defensively.
function normalizePercent(value) {
  const n = toFiniteNumber(value);
  return n === undefined ? undefined : Math.max(0, Math.min(100, n));
}

// Reset timestamps arrive as epoch-seconds, epoch-ms, or ISO strings. Normalize to epoch-ms.
function normalizeResetMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n)) return n > 10_000_000_000 ? n : n * 1000;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

// Convert epoch-ms to an ISO string for storage in datetime columns.
function toIso(ms) {
  const n = normalizeResetMs(ms);
  return n ? new Date(n).toISOString() : null;
}

// Build a normalized limit window { used, total, percent, resetAt(ms) } from
// whichever of (used,total) / (percent) / (resetAt) the upstream happened to give.
function window(opts) {
  const out = { used: 0, total: 0, percent: null, resetAt: undefined };
  if (opts.percent !== undefined && opts.percent !== null) out.percent = normalizePercent(opts.percent);
  if (opts.used !== undefined && opts.total !== undefined && opts.total > 0) {
    out.used = opts.used;
    out.total = opts.total;
  }
  const ms = normalizeResetMs(opts.resetAt);
  if (ms) out.resetAt = ms;
  return out;
}

module.exports = {
  asRecord,
  toFiniteNumber,
  normalizePercent,
  normalizeResetMs,
  toIso,
  window,
  safeFetch,
};

/**
 * fetch() wrapper with a HARD timeout. AbortSignal.timeout alone has been
 * observed to not interrupt a hung TCP connect (e.g. when a proxy swallows the
 * SYN), which would freeze the dashboard's refresh. An explicit AbortController
 * + setTimeout guarantees the call rejects by `ms`, so the refresh handler can
 * always proceed. The underlying socket may linger briefly, but the promise
 * resolves and the server stays responsive.
 */
function safeFetch(url, opts = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}
