/**
 * subscriptions.js — Subscription plan rate-limit dashboard
 *
 * 4 modules:
 * 1. Total cost summary (sum of monthly_cost across enabled subscriptions)
 * 2. Per-platform rate-limit cards (5h + weekly, with progress bars)
 * 3. Add/edit subscription modal (manual or with pasted cookies)
 * 4. Refresh-all button + per-card last-check status
 */
(function () {
  'use strict';

  const F = window.F;
  const API = window.API;

  let _subscriptions = [];
  let _editing = null;       // currently-edited row (or null for new)

  const PLATFORMS = [
    { id: 'anthropic',         label: 'Anthropic Claude',  color: '#d97757', domains: ['claude.ai'],           loginType: 'cli' },
    { id: 'openai-codex',      label: 'OpenAI Codex',      color: '#10a37f', domains: ['chatgpt.com'],          loginType: 'cli' },
    { id: 'kimi',              label: 'Kimi (月之暗面)',     color: '#1f6feb', domains: ['kimi.moonshot.cn'],     loginType: 'cli' },
    { id: 'google-antigravity',label: 'Google Antigravity',color: '#4285f4', domains: ['aistudio.google.com'],  loginType: 'cli' },
    { id: 'minimax',           label: 'MiniMax',           color: '#f59e0b', domains: ['minimaxi.com'],         loginType: 'web' }
  ];

  const PLATFORM_MAP = PLATFORMS.reduce((m, p) => { m[p.id] = p; return m; }, {});

  function platformColor(platform) {
    return PLATFORM_MAP[platform]?.color || '#888';
  }

  function platformLabel(platform) {
    return PLATFORM_MAP[platform]?.label || platform;
  }

  function mount(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1>订阅套餐</h1>
        <div class="page-actions">
          <button class="btn-secondary" id="refreshSubsBtn">全部刷新</button>
          <button class="btn-primary" id="addSubBtn">添加订阅</button>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2>本月订阅总览</h2>
          <span class="hint" style="margin:0">所有启用订阅的月度成本合计</span>
        </div>
        <div id="subSummary"></div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2>各平台速率限额</h2>
          <span class="hint" style="margin:0">点击卡片右上角编辑 ✏️ | 刷新 ⟳ | 删除 ✕</span>
        </div>
        <div id="subList" class="sub-grid"></div>
      </div>

      <div id="subModalContainer"></div>
    `;

    document.getElementById('refreshSubsBtn').addEventListener('click', refreshAll);
    document.getElementById('addSubBtn').addEventListener('click', () => openEditModal(null));

    refresh();
  }

  async function refresh() {
    const [summaryEl, listEl] = ['subSummary', 'subList'].map(id => document.getElementById(id));
    listEl.innerHTML = '<div class="empty-state">加载中...</div>';

    try {
      _subscriptions = await API.getSubscriptions();
      renderSummary(summaryEl);
      renderList(listEl);
    } catch (err) {
      listEl.innerHTML = `<div class="empty-state">加载失败: ${F.esc(err.message)}</div>`;
    }
  }

  function renderSummary(el) {
    const totalUSD = _subscriptions
      .filter(s => s.currency === 'USD')
      .reduce((sum, s) => sum + (s.monthly_cost || 0), 0);
    const totalCNY = _subscriptions
      .filter(s => s.currency === 'CNY')
      .reduce((sum, s) => sum + (s.monthly_cost || 0), 0);
    const okCount = _subscriptions.filter(s => s.last_check_status === 'ok').length;
    const staleCount = _subscriptions.length - okCount;

    let html = '<div class="compare-grid">';
    html += `
      <div class="compare-item">
        <span class="compare-label">订阅平台数</span>
        <span class="compare-val">${_subscriptions.length}</span>
      </div>`;
    if (totalUSD > 0) {
      html += `
        <div class="compare-item">
          <span class="compare-label">月度成本 (USD)</span>
          <span class="compare-val">$${totalUSD.toFixed(2)}</span>
        </div>`;
    }
    if (totalCNY > 0) {
      html += `
        <div class="compare-item">
          <span class="compare-label">月度成本 (CNY)</span>
          <span class="compare-val">¥${totalCNY.toFixed(2)}</span>
        </div>`;
    }
    if (totalUSD === 0 && totalCNY === 0) {
      html += `
        <div class="compare-item">
          <span class="compare-label">月度成本</span>
          <span class="compare-val" style="color:var(--text-secondary);font-size:13px">未填写</span>
        </div>`;
    }
    html += `
      <div class="compare-item">
        <span class="compare-label">自动同步状态</span>
        <span class="compare-val">
          <span style="color:var(--brand)">${okCount}</span>
          <span style="color:var(--text-secondary);font-size:12px"> / ${_subscriptions.length}</span>
        </span>
      </div>`;
    if (staleCount > 0) {
      html += `
        <div class="compare-item">
          <span class="compare-label">待刷新</span>
          <span class="compare-val" style="color:var(--text-secondary)">${staleCount}</span>
        </div>`;
    }
    html += '</div>';
    el.innerHTML = html;
  }

  function renderList(el) {
    if (_subscriptions.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          还没有订阅。点击右上角"添加订阅"开始。<br>
          <span style="font-size:12px;color:var(--text-secondary)">
            提示：保存后点击卡片上的 ⟳ 即可自动读取本机已登录平台的用量限额
            （Anthropic / Codex 来自本地登录态，Kimi / Antigravity 来自 opencodex）。
          </span>
        </div>`;
      return;
    }

    let html = '';
    for (const s of _subscriptions) {
      html += renderCard(s);
    }
    el.innerHTML = html;

    // Bind actions
    el.querySelectorAll('[data-action]').forEach(btn => {
      const id = parseInt(btn.dataset.id, 10);
      const action = btn.dataset.action;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (action === 'edit') openEditModal(_subscriptions.find(x => x.id === id));
        else if (action === 'delete') deleteSub(id);
        else if (action === 'refresh') refreshOne(id);
        else if (action === 'login') loginPlatform(id);
        else if (action === 'paste-cookie') pasteCookiePrompt(id);
      });
    });
  }

  function renderCard(s) {
    const color = platformColor(s.platform);
    const label = platformLabel(s.platform);
    const costText = s.monthly_cost > 0
      ? (s.currency === 'CNY' ? `¥${s.monthly_cost.toFixed(2)}/月` : `$${s.monthly_cost.toFixed(2)}/月`)
      : '<span style="color:var(--text-secondary)">未设置月费</span>';

    const sourceBadge = renderSourceBadge(s);

    let html = `
      <div class="sub-card" data-id="${s.id}">
        <div class="sub-card-header">
          <div class="sub-platform">
            <span class="sub-platform-dot" style="background:${color}"></span>
            <div>
              <div class="sub-platform-name">${F.esc(label)}</div>
              <div class="sub-account">${F.esc(s.account_label || 'default')} · ${F.esc(s.plan_name || '套餐未设置')}</div>
            </div>
          </div>
          <div class="sub-actions">
            <button class="icon-btn" data-action="refresh" data-id="${s.id}" title="刷新限额">⟳</button>
            <button class="icon-btn" data-action="edit" data-id="${s.id}" title="编辑">✏️</button>
            <button class="icon-btn" data-action="delete" data-id="${s.id}" title="删除">✕</button>
          </div>
        </div>

        <div class="sub-cost">${costText}</div>
        <div class="sub-source">${sourceBadge}</div>

        <div class="sub-limits">
          ${renderLimitBar('5 小时限额', s.limit5h_used, s.limit5h_total, s.limit5h_percent, s.limit5h_reset)}
          ${renderLimitBar('每周限额', s.limit_week_used, s.limit_week_total, s.limit_week_percent, s.limit_week_reset)}
          ${s.limit_month_percent != null ? renderLimitBar('每月限额', s.limit_month_used, s.limit_month_total, s.limit_month_percent, s.limit_month_reset) : ''}
        </div>

        ${s.last_check_status && s.last_check_status !== 'ok' && s.last_check_message ? `
          <div class="sub-warning">${F.esc(s.last_check_message)}</div>
        ` : ''}

        ${renderLoginButton(s)}
      </div>
    `;
    return html;
  }

  function renderLoginButton(s) {
    const p = PLATFORM_MAP[s.platform];
    if (!p) return '';
    const st = s.last_check_status || '';
    // Show the login/verify button when auth failed or the platform is manual-only.
    const needsLogin = st === 'auth_expired' || st === 'error' || st === 'unavailable' || st === '' || st === 'pending';
    if (!needsLogin) return '';
    if (p.loginType === 'cli') {
      return `<button class="btn-secondary sub-login-btn" data-action="login" data-id="${s.id}">🔑 验证登录</button>`;
    }
    return `<button class="btn-secondary sub-login-btn" data-action="login" data-id="${s.id}">🌐 去官网</button>`;
  }

  function renderLimitBar(label, used, total, percent, reset) {
    // Prefer the upstream utilization percentage (what auto-collectors return);
    // fall back to a manual used/total ratio when percent is unavailable.
    const hasPercent = typeof percent === 'number' && !isNaN(percent);
    const hasTotal = total > 0;
    const pct = hasPercent ? percent : (hasTotal ? Math.min(100, (used / total) * 100) : 0);
    let color = '#4ade80';
    if (pct >= 90) color = '#ef4444';
    else if (pct >= 70) color = '#f59e0b';

    let resetText = '';
    if (reset) {
      const resetDate = new Date(reset);
      if (!isNaN(resetDate.getTime())) {
        const now = new Date();
        const diffMs = resetDate - now;
        const diffH = Math.floor(diffMs / 3600000);
        const diffM = Math.floor((diffMs % 3600000) / 60000);
        if (diffMs < 0) {
          resetText = '已重置';
        } else if (diffH > 24) {
          resetText = `${Math.floor(diffH / 24)} 天 ${diffH % 24} 小时后重置`;
        } else if (diffH > 0) {
          resetText = `${diffH} 小时 ${diffM} 分后重置`;
        } else {
          resetText = `${diffM} 分后重置`;
        }
      }
    }

    const detail = hasTotal ? `${used} / ${total}` : '';

    // When there is no data, still render a thin "0%" progress bar so the
    // layout matches the rest of the card instead of collapsing.
    const subStatus = !hasPercent && !hasTotal
      ? '<span style="color:var(--text-secondary);font-size:11px;margin-left:4px">未配置</span>'
      : '';

    return `
      <div class="sub-limit">
        <div class="sub-limit-header">
          <span class="sub-limit-label">${F.esc(label)}</span>
          <span class="sub-limit-val">
            <strong style="color:${color}">${pct.toFixed(1)}%</strong>
            ${subStatus}
            ${detail ? ' · ' + detail + ' ' : ''}
            ${resetText ? '<span style="color:var(--text-secondary);font-size:11px">· ' + F.esc(resetText) + '</span>' : ''}
          </span>
        </div>
        <div class="rank-bar">
          <div class="rank-bar-fill" style="width:${pct}%;background:${color};opacity:${(!hasPercent && !hasTotal) ? 0.3 : 1}"></div>
        </div>
      </div>
    `;
  }

  function renderSourceBadge(s) {
    const src = s.source || 'manual';
    const status = s.last_check_status || 'pending';
    let label, cls;
    if (src === 'manual') {
      label = '手动填写';
      cls = 'sub-source-manual';
    } else if (status === 'ok') {
      label = '自动同步 ✓';
      cls = 'sub-source-ok';
    } else if (status === 'auth_expired') {
      label = '登录已过期';
      cls = 'sub-source-warn';
    } else if (status === 'unavailable') {
      label = '暂不支持自动';
      cls = 'sub-source-manual';
    } else if (status === 'pending') {
      label = '待刷新';
      cls = 'sub-source-manual';
    } else {
      label = '刷新失败';
      cls = 'sub-source-warn';
    }
    const checkedAgo = s.last_check_at ? ` · ${formatAgo(s.last_check_at)}前检查` : '';
    return `<span class="sub-source-badge ${cls}">${label}</span><span class="sub-source-time">${checkedAgo}</span>`;
  }

  function formatAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return `${m} 分钟`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时`;
    return `${Math.floor(h / 24)} 天`;
  }

  function openEditModal(sub) {
    _editing = sub;
    const isNew = !sub;
    const container = document.getElementById('subModalContainer');
    container.innerHTML = `
      <div class="drill-overlay show">
        <div class="drill-modal" style="max-width:560px">
          <div class="drill-header">
            <h2>${isNew ? '添加订阅' : '编辑订阅'}</h2>
            <button class="drill-close">&times;</button>
          </div>
          <div class="drill-body">
            <div class="form-row">
              <label>平台</label>
              <select id="subPlatform">
                ${PLATFORMS.map(p =>
                  `<option value="${p.id}" ${sub?.platform === p.id ? 'selected' : ''}>${p.label}</option>`
                ).join('')}
              </select>
            </div>

            <div class="form-row">
              <label>账号标识</label>
              <input type="text" id="subAccount" placeholder="例如 work / personal / default"
                     value="${F.esc(sub?.account_label || 'default')}">
            </div>

            <div class="form-row">
              <label>套餐名</label>
              <input type="text" id="subPlan" placeholder="例如 Max 5x / Pro / 月卡"
                     value="${F.esc(sub?.plan_name || '')}">
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="form-row">
                <label>月度费用</label>
                <input type="number" id="subCost" min="0" step="0.01"
                       value="${sub?.monthly_cost || ''}">
              </div>
              <div class="form-row">
                <label>货币</label>
                <select id="subCurrency">
                  <option value="USD" ${sub?.currency === 'USD' ? 'selected' : ''}>USD</option>
                  <option value="CNY" ${sub?.currency === 'CNY' ? 'selected' : ''}>CNY</option>
                </select>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="form-row">
                <label>5 小时限额（已用）</label>
                <input type="number" id="sub5hUsed" min="0"
                       value="${sub?.limit5h_used || ''}">
              </div>
              <div class="form-row">
                <label>5 小时限额（总额）</label>
                <input type="number" id="sub5hTotal" min="0"
                       value="${sub?.limit5h_total || ''}">
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="form-row">
                <label>每周限额（已用）</label>
                <input type="number" id="subWeekUsed" min="0"
                       value="${sub?.limit_week_used || ''}">
              </div>
              <div class="form-row">
                <label>每周限额（总额）</label>
                <input type="number" id="subWeekTotal" min="0"
                       value="${sub?.limit_week_total || ''}">
              </div>
            </div>

            <p class="hint" style="margin-top:8px">
              保存后点击卡片上的 ⟳ 即可自动抓取本机已登录平台的用量限额（基于本地登录态，无需手动填 Cookie）。
              仅 MiniMax 暂不支持自动抓取，请手动填写限额。
            </p>

            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
              <button class="btn-secondary drill-close-btn">取消</button>
              <button class="btn-primary" id="subSaveBtn">保存</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const close = () => { container.innerHTML = ''; _editing = null; };
    container.querySelectorAll('.drill-close, .drill-close-btn').forEach(b => b.addEventListener('click', close));
    container.querySelector('.drill-overlay').addEventListener('click', e => {
      if (e.target.classList.contains('drill-overlay')) close();
    });
    document.getElementById('subSaveBtn').addEventListener('click', saveSub);
  }

  async function saveSub() {
    const fields = {
      platform: document.getElementById('subPlatform').value,
      account_label: document.getElementById('subAccount').value || 'default',
      plan_name: document.getElementById('subPlan').value || '',
      monthly_cost: parseFloat(document.getElementById('subCost').value) || 0,
      currency: document.getElementById('subCurrency').value,
      limit5h_used: parseFloat(document.getElementById('sub5hUsed').value) || 0,
      limit5h_total: parseFloat(document.getElementById('sub5hTotal').value) || 0,
      limit_week_used: parseFloat(document.getElementById('subWeekUsed').value) || 0,
      limit_week_total: parseFloat(document.getElementById('subWeekTotal').value) || 0
    };

    if (_editing) fields.id = _editing.id;

    try {
      await API.upsertSubscription(fields);
      document.getElementById('subModalContainer').innerHTML = '';
      _editing = null;
      await refresh();
      window.setStatus && window.setStatus('订阅已保存', 'success');
    } catch (err) {
      window.setStatus && window.setStatus('保存失败: ' + err.message, 'error');
    }
  }

  async function deleteSub(id) {
    if (!confirm('确定删除这个订阅？')) return;
    try {
      await API.deleteSubscription(id);
      await refresh();
      window.setStatus && window.setStatus('已删除', 'success');
    } catch (err) {
      window.setStatus && window.setStatus('删除失败: ' + err.message, 'error');
    }
  }

  async function refreshAll() {
    window.setStatus && window.setStatus('正在刷新订阅限额...');
    try {
      const result = await API.refreshSubscriptions();
      window.setStatus && window.setStatus(
        `刷新完成：成功 ${result.success || 0} / 失败 ${result.failed || 0} / 跳过 ${result.skipped || 0}`,
        'success'
      );
      await refresh();
    } catch (err) {
      window.setStatus && window.setStatus('刷新失败: ' + err.message, 'error');
    }
  }

  async function refreshOne(id) {
    const sub = _subscriptions.find(s => s.id === id);
    if (!sub) return;
    window.setStatus && window.setStatus(`正在刷新 ${platformLabel(sub.platform)}...`);
    try {
      const result = await API.refreshSubscriptions(sub.platform);
      window.setStatus && window.setStatus('刷新完成', 'success');
      await refresh();
    } catch (err) {
      window.setStatus && window.setStatus('刷新失败: ' + err.message, 'error');
    }
  }

  async function loginPlatform(id) {
    const sub = _subscriptions.find(s => s.id === id);
    if (!sub) return;
    const p = PLATFORM_MAP[sub.platform];
    window.setStatus && window.setStatus(`正在打开 ${platformLabel(sub.platform)} 登录...`);
    try {
      const r = await API.loginSubscription(sub.platform);
      if (r.ok) {
        if (r.method === 'terminal') {
          window.setStatus && window.setStatus('已打开终端登录窗口，完成登录后点 ⟳ 刷新', 'success');
        } else {
          window.setStatus && window.setStatus('已打开浏览器，登录完成后点 ⟳ 刷新', 'success');
        }
      } else {
        window.setStatus && window.setStatus('打开登录失败: ' + (r.error || '未知错误'), 'error');
      }
    } catch (err) {
      window.setStatus && window.setStatus('登录请求失败: ' + err.message, 'error');
    }
  }

  async function pasteCookiePrompt(id) {
    const sub = _subscriptions.find(s => s.id === id);
    if (!sub) return;
    openEditModal(sub);
  }

  window.Pages = window.Pages || {};
  window.Pages.subscriptions = { mount, refresh };
  window.Router.register('subscriptions', { mount });
})();