/**
 * settings.js — Settings page
 *
 * 7 modules:
 * 1. Data management (sync/export/import/rebuild)
 * 2. Data stats (record count, DB size, time span)
 * 3. Collector health check (last record per agent)
 * 4. Pricing editor (add/delete rows)
 * 5. Budget settings (localStorage)
 * 6. About
 * 7. Preferences (localStorage)
 */
(function () {
  'use strict';

  const F = window.F;
  const API = window.API;

  const BUDGET_KEY = 'costBudget';
  const PREFS_KEY = 'dashboardPrefs';

  function getPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
    catch { return {}; }
  }
  function setPrefs(p) { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); }

  async function mount(container) {
    container.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title gradient">设置</div>
          <div class="page-subtitle">数据管理 · 价目表 · 系统信息</div>
        </div>
      </div>

      <!-- Data Management -->
      <div class="section">
        <div class="section-header"><h2>数据管理</h2></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn-primary" id="settingsScan">立即同步</button>
          <button class="btn-secondary" id="settingsExport">导出数据库</button>
          <label class="btn-secondary" style="cursor:pointer">
            导入数据库
            <input type="file" id="settingsImport" accept=".db" hidden>
          </label>
          <button class="btn-secondary" id="settingsRebuild" style="color:#fca5a5;border-color:#fca5a5">
            备份后重建
          </button>
        </div>
        <p class="hint">
          <strong>立即同步</strong>：增量扫描本地日志，补充新记录。<br>
          <strong>导出/导入</strong>：数据库备份与迁移。<br>
          <strong>备份后重建</strong>：先自动备份当前数据，再从日志重新计算（采集口径修正后使用）。
        </p>
      </div>

      <!-- Data Stats -->
      <div class="section">
        <div class="section-header"><h2>数据统计</h2></div>
        <div id="dataStats" class="summary-grid"></div>
      </div>

      <!-- Collector Health -->
      <div class="section">
        <div class="section-header">
          <h2>采集器状态</h2>
          <span class="hint" style="margin:0">各 Agent 最近活跃情况</span>
        </div>
        <div id="collectorHealth"></div>
      </div>

      <!-- Pricing Editor -->
      <div class="section">
        <div class="section-header">
          <h2>模型价目表</h2>
          <div style="display:flex;gap:8px">
            <button class="btn-secondary" id="pricingAddRow">+ 添加行</button>
            <button class="btn-primary" id="pricingSave">保存并重算</button>
          </div>
        </div>
        <table class="pricing-table" id="pricingTable">
          <thead>
            <tr>
              <th>匹配关键词</th>
              <th>Input ($/M)</th>
              <th>Output ($/M)</th>
              <th>Cache Read</th>
              <th>Cache Write</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="pricingBody"></tbody>
        </table>
        <p class="hint">
          匹配规则：按模型名称做大小写不敏感的子串匹配，从上到下首个命中生效。<br>
          Cache Read/Write 留空则默认为 Input 的 0.1 倍和 1.25 倍。
        </p>
      </div>

      <!-- Budget Settings -->
      <div class="section">
        <div class="section-header"><h2>预算与预警</h2></div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:end">
          <div>
            <label class="setting-label">月预算 ($)</label>
            <input type="number" class="setting-input" id="budgetMonthly" placeholder="如 50" min="0" step="1">
          </div>
          <div>
            <label class="setting-label">预警阈值 (0-1)</label>
            <input type="number" class="setting-input" id="budgetWarn" placeholder="0.8" min="0.1" max="1" step="0.1">
          </div>
          <button class="btn-primary" id="budgetSave">保存预算</button>
          <button class="btn-secondary" id="budgetClear">清除</button>
        </div>
        <p class="hint">设置后，成本中心页将显示月预算进度条和预警。</p>
      </div>

      <!-- Preferences -->
      <div class="section">
        <div class="section-header"><h2>偏好设置</h2></div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:end">
          <div>
            <label class="setting-label">默认时间范围</label>
            <select class="setting-input" id="prefRange">
              <option value="7">近 7 天</option>
              <option value="30">近 30 天</option>
              <option value="90">近 90 天</option>
              <option value="0">全部</option>
            </select>
          </div>
          <button class="btn-primary" id="prefSave">保存偏好</button>
        </div>
        <p class="hint">控制图表的默认展示范围（下次刷新后生效）。</p>
      </div>

      <!-- About -->
      <div class="section">
        <div class="section-header"><h2>关于</h2></div>
        <div id="aboutInfo"></div>
      </div>
    `;

    wireDataManagement(container);
    await loadPricing(container);
    await loadDataStats();
    await loadCollectorHealth();
    loadBudgetSettings();
    loadPrefsSettings();
    await loadAbout();
  }

  function wireDataManagement(container) {
    // Scan
    container.querySelector('#settingsScan').addEventListener('click', async () => {
      window.setStatus('正在扫描...');
      try {
        const results = await API.scanAll();
        const total = results.reduce((s, r) => s + (r.inserted || 0), 0);
        window.setStatus(`扫描完成，新增 ${total} 条记录。`, 'success');
      } catch (err) {
        window.setStatus('扫描失败: ' + err.message, 'error');
      }
    });

    // Export
    container.querySelector('#settingsExport').addEventListener('click', async () => {
      const blob = await API.exportDb();
      if (!blob) { window.setStatus('导出失败', 'error'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `token-usage-dashboard-${new Date().toISOString().split('T')[0]}.db`;
      a.click();
      URL.revokeObjectURL(url);
      window.setStatus('导出完成。', 'success');
    });

    // Import
    container.querySelector('#settingsImport').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      window.setStatus('正在导入...');
      try {
        const arrayBuffer = await file.arrayBuffer();
        const base64 = F.bytesToBase64(new Uint8Array(arrayBuffer));
        const result = await API.importDb(base64);
        if (result.error) throw new Error(result.error);
        window.setStatus(`导入完成，合并 ${result.inserted} 条记录。`, 'success');
      } catch (err) {
        window.setStatus('导入失败: ' + err.message, 'error');
      }
      e.target.value = '';
    });

    // Rebuild
    container.querySelector('#settingsRebuild').addEventListener('click', async () => {
      if (!confirm('系统会先自动备份当前数据库，再从本地日志重新计算。原始日志不受影响。继续？')) return;
      window.setStatus('正在备份并重建...');
      try {
        const payload = await API.rebuild();
        const results = Array.isArray(payload) ? payload : payload.results;
        const total = results.reduce((s, r) => s + (r.inserted || 0), 0);
        if (payload.backupPath) {
          window.setStatus(`重建完成，新增 ${total} 条。备份: ${payload.backupPath}`, 'success');
        } else {
          window.setStatus(`重建完成，新增 ${total} 条记录。`, 'success');
        }
      } catch (err) {
        window.setStatus('重建失败: ' + err.message, 'error');
      }
    });
  }

  async function loadDataStats() {
    const el = document.getElementById('dataStats');
    try {
      const stats = await API.getStats();
      const days = stats.earliest && stats.latest
        ? Math.round((new Date(stats.latest) - new Date(stats.earliest)) / 86400000) + 1 : 0;
      const dailyAvgRecords = days > 0 ? Math.round(stats.records / days) : 0;
      window.SummaryCards.render(el, [
        { label: '总记录数', value: F.formatNumber(stats.records), accent: true },
        { label: '数据库大小', value: F.formatBytes(stats.dbSizeBytes) },
        { label: '时间跨度', value: days + ' 天', sub: stats.earliest ? `从 ${stats.earliest.substring(0, 10)}` : '' },
        { label: '日均记录', value: F.formatNumber(dailyAvgRecords) },
      ]);
    } catch {
      el.innerHTML = '<div class="empty-state">统计信息不可用</div>';
    }
  }

  async function loadCollectorHealth() {
    const el = document.getElementById('collectorHealth');
    try {
      const summary = await API.getSummary();
      const agents = summary.byAgent || [];
      const todayStr = new Date().toISOString().split('T')[0];

      if (!agents.length) {
        el.innerHTML = '<div class="empty-state">暂无 Agent 数据</div>';
        return;
      }

      let html = '<div class="health-grid">';
      for (const a of agents) {
        const lastDate = a.last_used || '';
        const isStale = !lastDate || lastDate < todayStr;
        const daysSince = lastDate
          ? Math.round((new Date(todayStr) - new Date(lastDate)) / 86400000) : -1;
        const status = !lastDate ? 'unknown' : daysSince === 0 ? 'active' : daysSince <= 2 ? 'recent' : 'stale';
        const color = F.agentColor(a.agent);
        html += `
          <div class="health-card ${status}">
            <div class="health-header">
              <span class="agent-dot" style="background:${color}"></span>
              <span class="health-name">${F.esc(a.agent)}</span>
              <span class="health-status ${status}">${status === 'active' ? '今日活跃' : status === 'recent' ? '近期' : status === 'stale' ? '休眠' : '未知'}</span>
            </div>
            <div class="health-stats">
              <span>${F.formatNumber(a.total_tokens)} tokens</span>
              <span>${a.records} 条</span>
              <span>${F.relativeDays(lastDate)}</span>
            </div>
          </div>
        `;
      }
      html += '</div>';
      el.innerHTML = html;
    } catch {
      el.innerHTML = '<div class="empty-state">无法加载采集器状态</div>';
    }
  }

  async function loadPricing(container) {
    const tbody = document.getElementById('pricingBody');
    let prices = [];
    try {
      prices = await API.getPricing();
    } catch {
      prices = [
        { match: 'opus', input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
        { match: 'sonnet', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        { match: 'haiku', input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
        { match: 'gpt-5', input: 1.25, output: 10, cacheRead: 0.125 },
        { match: 'gpt-4', input: 2.5, output: 10, cacheRead: 0.25 },
        { match: 'o3', input: 2, output: 8 },
        { match: 'o4', input: 2, output: 8 },
        { match: 'minimax', input: 0.2, output: 1.1 },
        { match: 'kimi', input: 0.15, output: 2.5, cacheRead: 0.015 },
        { match: 'glm', input: 0.6, output: 2.2 },
        { match: 'deepseek', input: 0.28, output: 1.1 },
        { match: 'gemini', input: 1.25, output: 10 },
        { match: 'qwen', input: 0.3, output: 1.2 },
      ];
    }

    renderPricingRows(tbody, prices);

    // Add row button
    container.querySelector('#pricingAddRow').addEventListener('click', () => {
      addPricingRow(tbody, { match: '', input: '', output: '', cacheRead: '', cacheWrite: '' });
    });

    // Save button
    container.querySelector('#pricingSave').addEventListener('click', savePricing);

    // Delegate delete buttons
    tbody.addEventListener('click', (e) => {
      if (e.target.classList.contains('pricing-delete')) {
        e.target.closest('tr').remove();
      }
    });
  }

  function renderPricingRows(tbody, prices) {
    tbody.innerHTML = '';
    for (const p of prices) {
      addPricingRow(tbody, p);
    }
  }

  function addPricingRow(tbody, p) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="pricing-input pricing-match" data-field="match" value="${F.esc(p.match) || ''}" placeholder="如 opus"></td>
      <td><input class="pricing-input" data-field="input" type="number" step="0.01" value="${p.input ?? ''}"></td>
      <td><input class="pricing-input" data-field="output" type="number" step="0.01" value="${p.output ?? ''}"></td>
      <td><input class="pricing-input" data-field="cacheRead" type="number" step="0.01" value="${p.cacheRead ?? ''}"></td>
      <td><input class="pricing-input" data-field="cacheWrite" type="number" step="0.01" value="${p.cacheWrite ?? ''}"></td>
      <td><button class="pricing-delete" title="删除">&times;</button></td>
    `;
    tbody.appendChild(tr);
  }

  async function savePricing() {
    const rows = document.querySelectorAll('#pricingBody tr');
    const prices = [];
    for (const tr of rows) {
      const matchInput = tr.querySelector('.pricing-match');
      const match = matchInput ? matchInput.value.trim() : '';
      if (!match) continue;
      const inputs = tr.querySelectorAll('.pricing-input[data-field]:not(.pricing-match)');
      const entry = { match };
      for (const inp of inputs) {
        const field = inp.dataset.field;
        const val = inp.value.trim();
        if (val !== '') entry[field] = parseFloat(val);
      }
      prices.push(entry);
    }

    if (!prices.length) {
      window.setStatus('价目表不能为空', 'error');
      return;
    }

    try {
      await API.updatePricing(prices);
      window.setStatus('价目表已保存，所有花费已用新单价重新计算。', 'success');
    } catch (err) {
      window.setStatus('保存失败: ' + err.message, 'error');
    }
  }

  function loadBudgetSettings() {
    const budget = JSON.parse(localStorage.getItem(BUDGET_KEY) || '{}');
    const monthlyInput = document.getElementById('budgetMonthly');
    const warnInput = document.getElementById('budgetWarn');
    if (budget.monthly) monthlyInput.value = budget.monthly;
    if (budget.warnAt) warnInput.value = budget.warnAt;

    document.getElementById('budgetSave').addEventListener('click', () => {
      const monthly = parseFloat(monthlyInput.value);
      const warnAt = parseFloat(warnInput.value) || 0.8;
      if (!monthly || monthly <= 0) {
        window.setStatus('请输入有效的预算金额', 'error');
        return;
      }
      localStorage.setItem(BUDGET_KEY, JSON.stringify({ monthly, warnAt }));
      window.setStatus('预算已保存，可在成本中心页查看进度', 'success');
    });

    document.getElementById('budgetClear').addEventListener('click', () => {
      localStorage.removeItem(BUDGET_KEY);
      monthlyInput.value = '';
      window.setStatus('预算已清除', 'success');
    });
  }

  function loadPrefsSettings() {
    const prefs = getPrefs();
    const rangeSelect = document.getElementById('prefRange');
    if (prefs.defaultRange) rangeSelect.value = prefs.defaultRange;

    document.getElementById('prefSave').addEventListener('click', () => {
      const newPrefs = { ...prefs, defaultRange: rangeSelect.value };
      setPrefs(newPrefs);
      window.setStatus('偏好已保存', 'success');
    });
  }

  async function loadAbout() {
    const el = document.getElementById('aboutInfo');
    const agents = await API.getAgents();
    el.innerHTML = `
      <table class="data-table" style="font-size:13px">
        <tr><td style="color:var(--text-secondary)">版本</td><td>2.1.0</td></tr>
        <tr><td style="color:var(--text-secondary)">Agent 列表</td><td>${agents.map(F.esc).join(', ')}</td></tr>
        <tr><td style="color:var(--text-secondary)">数据路径</td><td style="font-family:monospace;font-size:11px">~/.token-usage-dashboard/usage.db</td></tr>
        <tr><td style="color:var(--text-secondary)">定价表路径</td><td style="font-family:monospace;font-size:11px">~/.token-usage-dashboard/pricing.json</td></tr>
      </table>
    `;
  }

  function unmount() {}

  async function refresh() {}

  window.Router.register('settings', { mount, unmount });
  if (!window.Pages) window.Pages = {};
  window.Pages.settings = { refresh };
})();
