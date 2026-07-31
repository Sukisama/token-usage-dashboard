/**
 * subscriptions/cookie-reader.js — Read browser cookies for session reuse.
 *
 * Helpers for extracting session cookies from Chrome / Safari / Arc / Brave
 * without forcing the user to log in again. Chrome/Edge/Brave store cookies
 * encrypted in SQLite; the AES key lives in macOS Keychain as "Chrome Safe
 * Storage". Safari uses a different binarycookies format.
 *
 * IMPORTANT:
 *   - All operations are read-only against the source browser's profile.
 *   - The Keychain item may require the user to unlock it (typically happens
 *     automatically at login).
 *   - On failure we throw a clear Error; the caller decides whether to mark
 *     the subscription as 'auth_expired' or fall back to manual entry.
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Browser profile roots on macOS
const PROFILES = {
  chrome: path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
  edge: path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge'),
  brave: path.join(os.homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'),
  arc: path.join(os.homedir(), 'Library', 'Application Support', 'Arc', 'User Data')
};

// Domains that often host useful session cookies for each platform.
const PLATFORM_DOMAINS = {
  'anthropic': ['claude.ai', 'anthropic.com'],
  'openai-codex': ['chatgpt.com', 'chat.openai.com', 'openai.com'],
  'kimi': ['kimi.moonshot.cn', 'moonshot.cn'],
  'google-antigravity': ['google.com', 'aistudio.google.com', 'antigravity.google'],
  'minimax': ['minimaxi.com', 'minimax.cn']
};

// Decrypt Chrome's "Safe Storage" key from macOS Keychain. Returns the
// plaintext password used to derive the AES-128-CBC key for cookie values.
//
// Throws if the keychain item is locked or absent.
function readChromeSafeStorageKey(browser = 'chrome') {
  const service = browser === 'edge' ? 'Microsoft Edge Safe Storage'
    : browser === 'brave' ? 'Brave Safe Storage'
    : browser === 'arc' ? 'Arc Safe Storage'
    : 'Chrome Safe Storage';

  try {
    return execSync(`security find-generic-password -s "${service}" -w`, { encoding: 'utf8', timeout: 5000 }).trim();
  } catch (err) {
    throw new Error(`无法读取 Keychain 中的 ${service}，请确认已登录 macOS 且 ${service} 项存在`);
  }
}

// Cookie names we usually need from each platform.
const PLATFORM_COOKIES = {
  'anthropic': ['sessionKey'],
  'openai-codex': ['__Secure-next-auth.session-token'],
  'kimi': ['access_token', 'kimi-auth'],
  'google-antigravity': ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID'],
  'minimax': ['token', 'session']
};

// Read cookies for a platform from a Chromium-based browser.
//
// Returns an object like { sessionKey: '...', __Secure-...: '...' }.
//
// This is a placeholder: a real implementation would decrypt the SQLite
// database using the Keychain key. We keep it stubbed so the rest of the
// dashboard can compile and run; collectors that call into it will get
// a clear "not implemented" error and fall back to manual entry.
function readChromiumCookies(platform, browser = 'chrome') {
  // TODO: implement Chromium cookie decryption
  // 1. Copy the Cookies SQLite file (Chrome locks it while running)
  // 2. Open with sql.js
  // 3. SELECT name, value, host_key FROM cookies WHERE host_key LIKE '%domain%'
  // 4. Decrypt value with AES-128-CBC(key, iv=b'0123456789abcdef')
  throw new Error('Chromium cookie decryption 尚未实现（待 macOS Keychain + AES 解密逻辑）');
}

// Stub: gather whatever the user provided in the subscription row.
// Subscriptions can carry a "credentials" JSON blob with pre-pasted cookies
// from the user's browser DevTools — the simplest, most reliable path.
function readManualCookies(sub) {
  try {
    if (!sub.credentials) return {};
    const creds = typeof sub.credentials === 'string' ? JSON.parse(sub.credentials) : sub.credentials;
    return creds || {};
  } catch { return {}; }
}

module.exports = {
  PROFILES,
  PLATFORM_DOMAINS,
  PLATFORM_COOKIES,
  readChromeSafeStorageKey,
  readChromiumCookies,
  readManualCookies
};