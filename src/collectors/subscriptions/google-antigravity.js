/**
 * google-antigravity.js — Google Antigravity (Gemini via cloudcode) collector.
 *
 * Token + project id: opencodex auth store active account for 'google-antigravity'.
 * Endpoint: POST https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels
 *   body: { project: <projectId> }
 * Response: { models: { "<modelId>": { ...quota fields... } } }
 *
 * The exact quota-shape is undocumented and shifts between versions, so we
 * generically scan each model for { used, total } / { usedPercent } pairs and
 * surface the highest observed utilization as a best-effort weekly percent.
 */
'use strict';

const { readOcxToken, REQUEST_TIMEOUT_MS } = require('./credentials');
const { asRecord, toFiniteNumber, normalizePercent, window, safeFetch } = require('./parse-helpers');

const ANTIGRAVITY_URL = 'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels';

// Recursively collect utilization percentages from a model info object.
function collectPercents(node, out) {
  const r = asRecord(node);
  if (!r) return;
  const used = toFiniteNumber(r.used);
  const total = toFiniteNumber(r.total);
  if (used !== undefined && total !== undefined && total > 0) {
    const p = normalizePercent((used / total) * 100);
    if (p !== undefined) out.push(p);
  }
  const direct = normalizePercent(r.usedPercent ?? r.percent ?? r.utilization);
  if (direct !== undefined) out.push(direct);
  for (const v of Object.values(r)) {
    if (v && typeof v === 'object') collectPercents(v, out);
  }
}

async function fetch(sub) {
  const cred = readOcxToken('google-antigravity');
  if (!cred || !cred.access) {
    return { status: 'auth_expired', message: '未检测到本地 Antigravity 登录态（~/.opencodex/auth.json）。请先登录 opencodex。' };
  }
  if (!cred.projectId) {
    return { status: 'auth_expired', message: 'Antigravity 需要 project id，请先在 opencodex 中配置 Google 项目。' };
  }

  let resp;
  try {
    resp = await safeFetch(ANTIGRAVITY_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cred.access}`,
      },
      body: JSON.stringify({ project: cred.projectId }),
    }, REQUEST_TIMEOUT_MS);
  } catch (err) {
    return { status: 'error', message: '请求 Antigravity 接口失败: ' + err.message };
  }

  if (resp.status === 401 || resp.status === 403) {
    return { status: 'auth_expired', message: 'Antigravity 登录态已过期，请重新登录。' };
  }
  if (!resp.ok) return { status: 'error', message: `Antigravity 返回 ${resp.status}` };

  const body = asRecord(await resp.json().catch(() => null));
  if (!body) return { status: 'error', message: 'Antigravity 返回空响应' };

  const models = asRecord(body.models);
  const percents = [];
  if (models) {
    for (const rawModel of Object.values(models)) collectPercents(rawModel, percents);
  }

  if (percents.length === 0) {
    return {
      fiveHour: window({}), weekly: window({}), monthly: window({}),
      status: 'ok',
      message: '未解析到配额字段（接口结构可能已变更），请手动填写。',
    };
  }

  const peak = Math.max(...percents);
  return {
    fiveHour: window({}),
    weekly: window({ percent: peak }),
    monthly: window({}),
    plan_name: sub.plan_name || '',
    monthly_cost: sub.monthly_cost || 0,
    status: 'ok',
    message: `按各模型族最高使用率估算（共解析 ${percents.length} 个配额字段）`,
  };
}

module.exports = { platform: 'google-antigravity', label: 'Google Antigravity', fetch };
