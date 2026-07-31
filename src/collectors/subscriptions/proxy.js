/**
 * proxy.js — Proxy-aware fetch for subscription collectors.
 *
 * Problem: Node's global `fetch` (undici) ignores HTTP(S)_PROXY env vars,
 * and the dashboard LaunchAgent server doesn't inherit the user's shell proxy
 * env anyway. So overseas endpoints (chatgpt.com, api.anthropic.com,
 * googleapis.com) are unreachable from a China-direct network and the refresh
 * hangs until the hard timeout. This routes overseas requests through the
 * user's local Clash Verge proxy (default 127.0.0.1:7897) while keeping
 * domestic hosts (api.kimi.com, *.cn) on a direct connection.
 *
 * Uses the `undici` package (project dep) for ProxyAgent + fetch, so the
 * dispatcher and fetch come from the same module instance.
 */
'use strict';

const net = require('net');

let undici = null;
try { undici = require('undici'); } catch { /* undici not installed */ }

const DEFAULT_PROXY_HOST = '127.0.0.1';
const DEFAULT_PROXY_PORT = 7897;
const DEFAULT_PROXY = `http://${DEFAULT_PROXY_HOST}:${DEFAULT_PROXY_PORT}`;
const DOMESTIC_SUFFIXES = ['.cn'];
const DOMESTIC_HOSTS = new Set([
  'api.kimi.com', 'kimi.moonshot.cn', 'platform.minimaxi.com', 'minimaxi.com', 'api.minimax.chat',
]);

let _proxyUrl = undefined;   // undefined = not yet detected; string | null = detected
let _detecting = null;       // in-flight detection promise
let _proxyAgent = null;      // cached undici ProxyAgent

function isDomestic(host) {
  const h = host.toLowerCase();
  if (DOMESTIC_HOSTS.has(h)) return true;
  return DOMESTIC_SUFFIXES.some(s => h.endsWith(s));
}

function tcpReachable(host, port, ms = 400) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    sock.setTimeout(ms);
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { sock.destroy(); } catch {} resolve(v); } };
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
    sock.once('timeout', () => finish(false));
  });
}

// Detect a usable proxy URL once. Priority: HTTPS_PROXY env > default Clash port (if reachable).
async function detectProxy() {
  if (_proxyUrl !== undefined) return _proxyUrl;
  if (_detecting) return _detecting;
  _detecting = (async () => {
    const fromEnv = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
    if (fromEnv) { _proxyUrl = fromEnv; return _proxyUrl; }
    const reachable = await tcpReachable(DEFAULT_PROXY_HOST, DEFAULT_PROXY_PORT);
    _proxyUrl = reachable ? DEFAULT_PROXY : null;
    return _proxyUrl;
  })();
  const r = await _detecting;
  _detecting = null;
  return r;
}

async function getProxyUrl() {
  if (_proxyUrl !== undefined) return _proxyUrl;
  return detectProxy();
}

async function getDispatcher(host) {
  if (!undici) return undefined;
  if (isDomestic(host)) return undefined;
  const proxy = await getProxyUrl();
  if (!proxy) return undefined;
  if (!_proxyAgent) {
    _proxyAgent = new undici.ProxyAgent({ uri: proxy, requestTls: { rejectUnauthorized: false } });
  }
  return _proxyAgent;
}

/**
 * fetch() with a HARD timeout (AbortController + setTimeout) and optional
 * proxy dispatching for overseas hosts. Returns a standard Response.
 */
async function proxyFetch(url, opts = {}, ms = 8000) {
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  const dispatcher = await getDispatcher(host);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const fetchFn = undici ? undici.fetch : fetch;
  try {
    return await fetchFn(url, { ...opts, dispatcher, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { proxyFetch, getProxyUrl, isDomestic, detectProxy };
