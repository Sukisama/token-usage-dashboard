/**
 * credentials.js — Local OAuth token detection (READ-ONLY).
 *
 * Strategy copied from opencodex (@bitkyc08/opencodex): every platform's
 * usage/limit API is probed with a Bearer token that already lives on disk
 * from the user's own login — we never read browser cookies or decrypt
 * Chrome's cookie store. The dashboard server runs as the user (LaunchAgent),
 * so it has the same filesystem + Keychain access as those tools.
 *
 * Sources per platform:
 *   - Anthropic Claude : macOS Keychain "Claude Code-credentials"  OR
 *                        ~/.claude/.credentials.json  (claudeAiOauth.accessToken)
 *   - OpenAI Codex     : ~/.codex/auth.json  (tokens.access_token + tokens.account_id)
 *   - Kimi / Antigravity / others : ~/.opencodex/auth.json  (active account credential.access)
 *
 * Nothing here is ever written back to those files.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { safeFetch } = require('./parse-helpers');

const REQUEST_TIMEOUT_MS = 8000;
const HOMEDIR = os.homedir();

function readJsonFile(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function envPath(envVar, fallback) {
  const v = process.env[envVar];
  return v ? path.resolve(v.replace(/^~/, HOMEDIR)) : fallback;
}

// ---------------------------------------------------------------------------
// Anthropic Claude
// ---------------------------------------------------------------------------

const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials';

function readClaudeKeychain() {
  if (process.platform !== 'darwin') return null;
  try {
    return execSync(`security find-generic-password -s "${CLAUDE_KEYCHAIN_SERVICE}" -w`, {
      encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function parseClaudeOauthPayload(raw) {
  try {
    const data = raw && typeof raw === 'string' ? JSON.parse(raw) : raw;
    const o = data && data.claudeAiOauth;
    if (!o || !o.accessToken) return null;
    return {
      access: o.accessToken,
      refresh: o.refreshToken || null,
      expires: o.expiresAt ? new Date(o.expiresAt).getTime() : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Detect the active Claude Code OAuth token. Returns
 * { access, refresh?, expires? } or null.
 */
function detectClaudeToken() {
  const configDir = envPath('CLAUDE_CONFIG_DIR', path.join(HOMEDIR, '.claude'));
  // Keychain first on macOS; the credentials file is the cross-platform fallback.
  const raw = !process.env.CLAUDE_CONFIG_DIR
    ? (readClaudeKeychain() || readJsonFile(path.join(configDir, '.credentials.json')))
    : (readJsonFile(path.join(configDir, '.credentials.json')) || readClaudeKeychain());
  return raw ? parseClaudeOauthPayload(raw) : null;
}

/** Refresh an expired Claude token via the OAuth refresh grant. Returns new access token or null. */
async function refreshClaudeToken(refreshToken) {
  if (!refreshToken) return null;
  // Public Claude Code OAuth client id (the same one claude-code-cli uses).
  const clientId = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
  try {
    const resp = await safeFetch('https://api.anthropic.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }),
    }, REQUEST_TIMEOUT_MS);
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    return data && data.access_token ? data.access_token : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// OpenAI Codex / ChatGPT
// ---------------------------------------------------------------------------

/** Read the Codex CLI credential file. Returns { access, accountId } or null. */
function readCodexToken() {
  const codexHome = envPath('CODEX_HOME', path.join(HOMEDIR, '.codex'));
  const j = readJsonFile(path.join(codexHome, 'auth.json'));
  if (!j || !j.tokens || !j.tokens.access_token) return null;
  return { access: j.tokens.access_token, accountId: j.tokens.account_id || '' };
}

// ---------------------------------------------------------------------------
// opencodex auth store (~/.opencodex/auth.json)
// ---------------------------------------------------------------------------

/**
 * Read the active account credential for a provider from the opencodex auth
 * store. Returns the credential object { access, refresh?, projectId?, email? }
 * or null. Trusted: only our own server reads this; never writes to it.
 */
function readOcxToken(provider) {
  const ocxHome = envPath('OPENCODEX_HOME', path.join(HOMEDIR, '.opencodex'));
  const j = readJsonFile(path.join(ocxHome, 'auth.json'));
  if (!j || !j[provider]) return null;
  const set = j[provider];
  const accounts = Array.isArray(set.accounts) ? set.accounts : (Array.isArray(set) ? set : null);
  if (!accounts || accounts.length === 0) return null;
  const activeId = set.activeAccountId || accounts[0].id;
  const account = accounts.find(a => a.id === activeId) || accounts[0];
  const cred = account && account.credential ? account.credential : (account || null);
  if (!cred || !cred.access) return null;
  return {
    access: cred.access,
    refresh: cred.refresh || null,
    projectId: cred.projectId || null,
    email: cred.email || null,
  };
}

module.exports = {
  REQUEST_TIMEOUT_MS,
  detectClaudeToken,
  refreshClaudeToken,
  readCodexToken,
  readOcxToken,
};
