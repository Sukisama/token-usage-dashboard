/**
 * agents.js — Agent list + detail page
 *
 * #/agents       → grid of agent cards (with sparkline + stats + ranking)
 * #/agents/:name → agent detail (trend, model breakdown, hourly, records)
 */
(function () {
  'use strict';

  const F = window.F;
  const API = window.API;
  let _summaryData = null;
  let _sortBy = 'total_tokens';
  let _selectedForCompare = new Set();
  let _compareMode = false;

  // ---- Agent list ----

  async function mountList(container) {
    container.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title gradient">Agent 分析</div>
          <div class="page-subtitle">各 AI 客户端的用量对比与详情</div>
        </div>
        <div class="toolbar" id="agentToolbar">
          <div class="tab-group">
            <button class="tab-btn active" data-sort="total_tokens">按 Token</button>
            <button class="tab-btn" data-sort="cost">按花费</button>
            <button class="tab-btn" data-sort="records">按记录数</button>
            <button class="tab-btn" data-sort="last_used">按最近活跃</button>
          </div>
          <button class="btn-secondary" id="compareBtn">对比</button>
        </div>
      </div>
      <div id="agentSummary" class="compare-grid"></div>
      <div id="agentGrid" class="agent-grid" style="margin-top:24px"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div class="section">
          <div class="section-header"><h2>Token 占比</h2></div>
          <div id="agentTokenShare"></div>
        </div>
        <div class="section">
          <div class="section-header"><h2>花费占比</h2></div>
          <div id="agentCostShare"></div>
        </div>
      </div>
    `;

    // Sort tabs
    container.querySelectorAll('#agentToolbar .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _sortBy = btn.dataset.sort;
        container.querySelectorAll('#agentToolbar .tab-btn').forEach(t =>
          t.classList.toggle('active', t === btn));
        renderGrid();
      });
    });

    // Compare button: toggles compare mode; when in mode with 2+ selected, opens modal
    container.querySelector('#compareBtn').addEventListener('click', () => {
      if (_compareMode && _selectedForCompare.size >= 2) {
        openCompareModal();
      } else if (_compareMode) {
        exitCompareMode();
      } else {
        enterCompareMode();
      }
    });

    _summaryData = await API.getSummary();
    renderSummary();
    await renderGrid();
    renderShares();
  }

  function renderSummary() {
    const el = document.getElementById('agentSummary');
    if (!el) return;
    const agents = _summaryData.byAgent || [];
    const totalTokens = agents.reduce((s, a) => s + a.total_tokens, 0);
    const totalCost = agents.reduce((s, a) => s + (a.cost || 0), 0);
    el.innerHTML = `
      <div class="compare-item">
        <span class="compare-label">Agent 总数</span>
        <span class="compare-val">${agents.length}</span>
      </div>
      <div class="compare-item">
        <span class="compare-label">总 Token</span>
        <span class="compare-val">${F.formatNumber(totalTokens)}</span>
      </div>
      <div class="compare-item">
        <span class="compare-label">总花费</span>
        <span class="compare-val cost">${F.formatCost(totalCost)}</span>
      </div>
      <div class="compare-item">
        <span class="compare-label">总记录数</span>
        <span class="compare-val">${F.formatNumber(agents.reduce((s, a) => s + a.records, 0))}</span>
      </div>
    `;
  }

  async function renderGrid() {
    const grid = document.getElementById('agentGrid');
    if (!grid) return;
    let agents = [...(_summaryData.byAgent || [])];

    // Sort
    if (_sortBy === 'total_tokens') agents.sort((a, b) => b.total_tokens - a.total_tokens);
    else if (_sortBy === 'cost') agents.sort((a, b) => (b.cost || 0) - (a.cost || 0));
    else if (_sortBy === 'records') agents.sort((a, b) => b.records - a.records);
    else if (_sortBy === 'last_used') agents.sort((a, b) => (b.last_used || '').localeCompare(a.last_used || ''));

    const grandTotal = agents.reduce((s, a) => s + a.total_tokens, 0) || 1;

    // Parallel fetch sparklines + week data
    const sparks = await Promise.all(
      agents.map(a => API.getDailyUsage(a.agent).catch(() => []))
    );

    grid.innerHTML = '';
    const todayStr = new Date().toISOString().split('T')[0];

    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      const daily = sparks[i];

      // Sparkline
      let sparkPath = '';
      if (daily && daily.length > 1) {
        const recent = daily.slice(0, 14).reverse();
        const max = Math.max(1, ...recent.map(d => d.total_tokens));
        const w = 100, h = 28;
        const step = w / (recent.length - 1);
        sparkPath = recent.map((d, idx) => {
          const x = idx * step;
          const y = h - (d.total_tokens / max) * (h - 4) - 2;
          return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
      }

      // Week tokens
      const weekTokens = daily ? daily.slice(0, 7).reduce((s, d) => s + d.total_tokens, 0) : 0;

      // Today active?
      const todayActive = a.last_used === todayStr;
      const pct = (a.total_tokens / grandTotal) * 100;

      const color = F.agentColor(a.agent);
      const card = document.createElement('div');
      card.className = 'agent-card';
      if (_compareMode) card.classList.add('compare-mode');
      if (_selectedForCompare.has(a.agent)) card.classList.add('selected');
      card.innerHTML = `
        <div class="agent-card-header">
          <div style="display:flex;align-items:center;gap:8px">
            ${_compareMode ? `<input type="checkbox" class="compare-check" data-agent="${F.esc(a.agent)}"
              ${_selectedForCompare.has(a.agent) ? 'checked' : ''}>` : ''}
            <div class="agent-dot" style="background:${color}"></div>
            <div class="agent-name">${F.esc(a.agent)}</div>
            ${todayActive ? '<span class="badge-today">今日活跃</span>' : ''}
          </div>
        </div>
        ${sparkPath ? `
          <svg class="agent-spark" viewBox="0 0 100 28" preserveAspectRatio="none">
            <path d="${sparkPath}" fill="none" stroke="${color}" stroke-width="1.5"
                  stroke-linejoin="round" stroke-linecap="round" opacity="0.8"/>
          </svg>
        ` : '<div class="agent-spark"></div>'}
        <div class="agent-stats">
          <div>
            <div class="agent-token">${F.formatNumber(a.total_tokens)}</div>
            <div class="agent-meta">${a.records} 条 · ${a.days} 天 · 本周 ${F.formatNumber(weekTokens)}</div>
          </div>
          <div class="agent-cost">
            <div>${F.formatCost(a.cost)}</div>
            <div class="agent-meta">${F.relativeDays(a.last_used)}</div>
          </div>
        </div>
        <div class="rank-bar" style="margin-top:6px"><div class="rank-bar-fill" style="width:${pct}%;background:${color};opacity:0.6"></div></div>
      `;
      card.addEventListener('click', (e) => {
        const cb = e.target.classList.contains('compare-check') ? e.target : null;
        if (cb) {
          // Checkbox clicked (only visible in compare mode)
          const agent = cb.dataset.agent;
          if (cb.checked) {
            _selectedForCompare.add(agent);
          } else {
            _selectedForCompare.delete(agent);
          }
          updateCompareBtn();
          card.classList.toggle('selected', _selectedForCompare.has(a.agent));
        } else if (_compareMode) {
          // In compare mode: clicking the card toggles selection
          if (_selectedForCompare.has(a.agent)) {
            _selectedForCompare.delete(a.agent);
          } else {
            _selectedForCompare.add(a.agent);
          }
          // Sync checkbox if present
          const checkbox = card.querySelector('.compare-check');
          if (checkbox) checkbox.checked = _selectedForCompare.has(a.agent);
          updateCompareBtn();
          card.classList.toggle('selected', _selectedForCompare.has(a.agent));
        } else {
          // Normal mode: navigate to detail
          window.Router.go(`/agents/${a.agent}`);
        }
      });
      grid.appendChild(card);
    }
  }

  function updateCompareBtn() {
    const btn = document.getElementById('compareBtn');
    if (!btn) return;
    if (_compareMode) {
      if (_selectedForCompare.size >= 2) {
        btn.textContent = `对比 (${_selectedForCompare.size})`;
        btn.disabled = false;
        btn.classList.add('active');
      } else {
        btn.textContent = `取消对比 (${_selectedForCompare.size})`;
        btn.disabled = false;
        btn.classList.add('active');
      }
    } else {
      btn.textContent = '对比';
      btn.disabled = false;
      btn.classList.remove('active');
    }
  }

  function enterCompareMode() {
    _compareMode = true;
    _selectedForCompare.clear();
    updateCompareBtn();
    renderGrid();
  }

  function exitCompareMode() {
    _compareMode = false;
    _selectedForCompare.clear();
    updateCompareBtn();
    renderGrid();
  }

  function renderShares() {
    const agents = [...(_summaryData.byAgent || [])].sort((a, b) => b.total_tokens - a.total_tokens);
    const grandTotal = agents.reduce((s, a) => s + a.total_tokens, 0) || 1;

    // Token share
    const tokenEl = document.getElementById('agentTokenShare');
    if (tokenEl) {
      let html = '';
      for (const a of agents) {
        const pct = (a.total_tokens / grandTotal) * 100;
        const color = F.agentColor(a.agent);
        html += `
          <div class="rank-row" data-agent="${F.esc(a.agent)}" style="cursor:pointer">
            <span class="agent-dot" style="background:${color}"></span>
            <span class="rank-name">${F.esc(a.agent)}</span>
            <div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%;background:${color}"></div></div>
            <span class="rank-val">${F.formatNumber(a.total_tokens)}</span>
            <span class="rank-pct">${pct.toFixed(1)}%</span>
          </div>
        `;
      }
      tokenEl.innerHTML = html || '<div class="empty-state">暂无数据</div>';
      tokenEl.querySelectorAll('.rank-row').forEach(row => {
        row.addEventListener('click', () => window.Router.go(`/agents/${row.dataset.agent}`));
      });
    }

    // Cost share
    const costEl = document.getElementById('agentCostShare');
    if (costEl) {
      const costAgents = agents.filter(a => a.cost != null).sort((a, b) => (b.cost || 0) - (a.cost || 0));
      const totalCost = costAgents.reduce((s, a) => s + (a.cost || 0), 0) || 1;
      let html = '';
      for (const a of costAgents) {
        const pct = ((a.cost || 0) / totalCost) * 100;
        const color = F.agentColor(a.agent);
        html += `
          <div class="rank-row" data-agent="${F.esc(a.agent)}" style="cursor:pointer">
            <span class="agent-dot" style="background:${color}"></span>
            <span class="rank-name">${F.esc(a.agent)}</span>
            <div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%;background:${color}"></div></div>
            <span class="rank-val">${F.formatCost(a.cost)}</span>
            <span class="rank-pct">${pct.toFixed(1)}%</span>
          </div>
        `;
      }
      costEl.innerHTML = html || '<div class="empty-state">暂无花费数据</div>';
      costEl.querySelectorAll('.rank-row').forEach(row => {
        row.addEventListener('click', () => window.Router.go(`/agents/${row.dataset.agent}`));
      });
    }
  }

  async function openCompareModal() {
    const agents = [..._selectedForCompare];
    const overlay = document.createElement('div');
    overlay.className = 'drill-overlay show';
    overlay.innerHTML = `
      <div class="drill-modal">
        <div class="drill-header">
          <h2>Agent 对比</h2>
          <button class="drill-close" title="关闭">&times;</button>
        </div>
        <div class="drill-body" id="compareBody"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.classList.contains('drill-close')) overlay.remove();
    });

    const body = overlay.querySelector('#compareBody');
    body.innerHTML = '<div class="empty-state">加载中...</div>';

    // Fetch daily data for each agent
    const data = await Promise.all(
      agents.map(async agent => {
        const [daily, summary] = await Promise.all([
          API.getDailyUsage(agent),
          API.getSummary()
        ]);
        const info = summary.byAgent.find(a => a.agent === agent);
        return { agent, daily, info };
      })
    );

    let html = `
      <div class="compare-table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>Agent</th><th>累计 Token</th><th>花费</th><th>记录数</th><th>活跃天数</th><th>最近使用</th></tr>
          </thead>
          <tbody>
    `;
    for (const d of data) {
      const color = F.agentColor(d.agent);
      const info = d.info || {};
      html += `
        <tr>
          <td><span class="agent-dot inline" style="background:${color}"></span>${F.esc(d.agent)}</td>
          <td>${F.formatNumber(info.total_tokens || 0)}</td>
          <td class="cost-cell">${F.formatCost(info.cost)}</td>
          <td>${info.records || 0}</td>
          <td>${info.days || 0}</td>
          <td>${F.relativeDays(info.last_used)}</td>
        </tr>
      `;
    }
    html += '</tbody></table></div>';

    // Multi-line sparkline comparison
    const allDates = new Set();
    for (const d of data) for (const row of d.daily) allDates.add(row.date);
    const sortedDates = [...allDates].sort();
    const recentDates = sortedDates.slice(-30);
    const recentSet = new Set(recentDates);

    const w = 700, h = 200, padL = 50, padR = 10, padT = 10, padB = 25;
    const maxVal = Math.max(1, ...data.flatMap(d =>
      d.daily.filter(r => recentSet.has(r.date)).map(r => r.total_tokens)
    ));

    let svg = `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:700px">`;
    // Grid
    [0, 0.5, 1].forEach(f => {
      const y = padT + (h - padT - padB) * (1 - f);
      svg += `<line x1="${padL}" x2="${w - padR}" y1="${y}" y2="${y}" stroke="#3f3f46" stroke-width="1"/>`;
      svg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" fill="#a1a1aa" font-size="10">${F.formatNumber(maxVal * f)}</text>`;
    });
    // Lines
    const step = recentDates.length > 1 ? (w - padL - padR) / (recentDates.length - 1) : 0;
    for (const d of data) {
      const color = F.agentColor(d.agent);
      let path = '';
      for (let i = 0; i < recentDates.length; i++) {
        const row = d.daily.find(r => r.date === recentDates[i]);
        if (!row) continue;
        const x = padL + i * step;
        const y = padT + (h - padT - padB) * (1 - row.total_tokens / maxVal);
        path += `${path ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      }
      svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" opacity="0.85"/>`;
    }
    // X labels
    const labelStep = Math.max(1, Math.ceil(recentDates.length / 8));
    for (let i = 0; i < recentDates.length; i += labelStep) {
      const x = padL + i * step;
      svg += `<text x="${x}" y="${h - 6}" text-anchor="middle" fill="#a1a1aa" font-size="10">${F.formatDate(recentDates[i])}</text>`;
    }
    svg += '</svg>';

    html += `
      <div class="drill-section">
        <h3>近 30 天趋势对比</h3>
        <div class="drill-chart">${svg}</div>
        <div class="comp-legend">
          ${data.map(d => `<div class="comp-item"><span class="comp-swatch" style="background:${F.agentColor(d.agent)}"></span><span class="comp-label">${F.esc(d.agent)}</span></div>`).join('')}
        </div>
      </div>
    `;

    body.innerHTML = html;
  }

  // ---- Agent detail ----

  async function mountDetail(container, agentName) {
    container.innerHTML = `
      <button class="back-link" onclick="location.hash='#/agents'">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        返回 Agent 列表
      </button>
      <div class="page-header">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="agent-dot" style="width:14px;height:14px;background:${F.agentColor(agentName)}"></div>
          <div>
            <div class="page-title gradient" style="text-transform:capitalize">${F.esc(agentName)}</div>
            <div class="page-subtitle">Agent 详情</div>
          </div>
        </div>
      </div>
      <div id="agentDetailCards" class="summary-grid"></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="section">
          <div class="section-header"><h2>Token 构成</h2></div>
          <div id="agentTokenComp"></div>
        </div>
        <div class="section">
          <div class="section-header"><h2>模型分布</h2></div>
          <div id="agentModelDist"></div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2>用量趋势</h2>
          <div class="tab-group" id="agentRangeTabs">
            <button class="tab-btn" data-range="7">近 7 天</button>
            <button class="tab-btn active" data-range="30">近 30 天</button>
            <button class="tab-btn" data-range="0">全部</button>
          </div>
        </div>
        <div class="trend-wrapper">
          <div id="agentTrend" class="trend-chart"></div>
        </div>
        <div class="trend-legend" id="agentTrendLegend"></div>
      </div>

      <div class="section">
        <div class="section-header"><h2>每小时活跃分布</h2><span class="hint" style="margin:0">近 30 天聚合</span></div>
        <div id="agentHourlyDist"></div>
      </div>

      <div class="section">
        <div class="section-header"><h2>模型明细</h2></div>
        <table class="data-table">
          <thead>
            <tr><th>模型</th><th>Input</th><th>Output</th><th>Cache</th><th>Total</th><th>记录</th><th>花费</th></tr>
          </thead>
          <tbody id="agentModelsBody"></tbody>
        </table>
      </div>

      <div class="section">
        <div class="section-header">
          <h2>最近记录</h2>
          <div style="display:flex;gap:10px;align-items:center">
            <input type="text" class="record-search" id="recordSearch" placeholder="搜索模型..." />
            <select class="record-filter" id="recordModelFilter"></select>
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr><th>时间</th><th>模型</th><th>次数</th><th>Input</th><th>Output</th><th>Cache</th><th>Total</th><th>花费</th></tr>
          </thead>
          <tbody id="agentRecordsBody"></tbody>
        </table>
        <div class="load-more-wrap">
          <button class="btn-secondary" id="agentLoadMore">加载更多</button>
        </div>
      </div>

      <div class="section">
        <div class="section-header"><h2>使用节奏</h2></div>
        <div id="agentRhythm"></div>
      </div>
    `;

    let _range = 30;
    let _offset = 0;
    const PAGE = 50;
    let _allRecords = [];

    // Range tabs
    container.querySelectorAll('#agentRangeTabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _range = parseInt(btn.dataset.range, 10);
        container.querySelectorAll('#agentRangeTabs .tab-btn').forEach(t =>
          t.classList.toggle('active', t === btn));
        renderTrend();
      });
    });

    async function renderTrend() {
      const daily = await API.getDailyByAgent(agentName);
      const dailyModel = await API.getDailyByModel(agentName);
      F.buildModelColors(dailyModel);
      const el = document.getElementById('agentTrend');
      const legendEl = document.getElementById('agentTrendLegend');
      window.TrendChart.render(el, {
        rows: dailyModel,
        dimension: 'model',
        range: _range,
        legend: legendEl,
        onBarClick: (date) => window.DrillModal.open(date),
      });
    }

    async function renderModels() {
      const models = await API.getModelUsage(agentName);
      F.buildModelColors(models.map(m => ({ model: m.model, total_tokens: m.total_tokens })));
      const tbody = document.getElementById('agentModelsBody');
      tbody.innerHTML = '';
      if (!models.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">暂无模型数据</td></tr>';
        return;
      }

      // Model distribution visualization
      const distEl = document.getElementById('agentModelDist');
      const modelTotal = models.reduce((s, m) => s + m.total_tokens, 0) || 1;
      let distHtml = '<div class="comp-bar">';
      for (const m of models) {
        const pct = (m.total_tokens / modelTotal) * 100;
        const color = F.modelColor(m.model);
        distHtml += `<div class="comp-seg" style="width:${pct}%;background:${color}" title="${F.esc(m.model)}: ${pct.toFixed(1)}%"></div>`;
      }
      distHtml += '</div><div class="comp-legend">';
      for (const m of models.slice(0, 8)) {
        const pct = (m.total_tokens / modelTotal) * 100;
        const color = F.modelColor(m.model);
        distHtml += `<div class="comp-item"><span class="comp-swatch" style="background:${color}"></span><span class="comp-label">${F.esc(m.model)}</span><span class="comp-val">${F.formatNumber(m.total_tokens)}</span><span class="comp-pct">${pct.toFixed(1)}%</span></div>`;
      }
      distHtml += '</div>';
      distEl.innerHTML = distHtml;

      // Model detail table
      for (const m of models) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><span class="rank-swatch inline" style="background:${F.modelColor(m.model)}"></span>${F.esc(m.model) || '\u2014'}</td>
          <td>${F.formatNumber(m.input_tokens)}</td>
          <td>${F.formatNumber(m.output_tokens)}</td>
          <td>${F.formatNumber(m.cache_read_tokens + m.cache_creation_tokens)}</td>
          <td>${F.formatNumber(m.total_tokens)}</td>
          <td>${m.records}</td>
          <td class="cost-cell">${F.formatCost(m.cost)}</td>
        `;
        tbody.appendChild(tr);
      }

      // Populate model filter dropdown
      const filter = document.getElementById('recordModelFilter');
      if (filter) {
        filter.innerHTML = '<option value="">全部模型</option>' +
          models.map(m => `<option value="${F.esc(m.model)}">${F.esc(m.model)}</option>`).join('');
      }
    }

    async function renderRecords(reset = false) {
      if (reset) {
        _offset = 0;
        _allRecords = [];
      }
      const records = await API.getRecords({ agent: agentName, limit: PAGE, offset: _offset });
      _allRecords = _allRecords.concat(records);
      _offset += records.length;
      applyRecordFilter();

      const loadMore = document.getElementById('agentLoadMore');
      if (loadMore) loadMore.hidden = records.length < PAGE;
    }

    function applyRecordFilter() {
      const tbody = document.getElementById('agentRecordsBody');
      if (!tbody) return;
      const search = (document.getElementById('recordSearch')?.value || '').toLowerCase();
      const modelFilter = document.getElementById('recordModelFilter')?.value || '';
      const filtered = _allRecords.filter(r => {
        if (search && !(r.model || '').toLowerCase().includes(search)) return false;
        if (modelFilter && r.model !== modelFilter) return false;
        return true;
      });

      tbody.innerHTML = '';
      for (const r of filtered) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${F.formatDateTime(r.timestamp)}</td>
          <td>${F.esc(r.model) || '\u2014'}</td>
          <td>${r.requests > 1 ? '\u00d7' + r.requests : '1'}</td>
          <td>${F.formatNumber(r.input_tokens)}</td>
          <td>${F.formatNumber(r.output_tokens)}</td>
          <td>${F.formatNumber(r.cache_read_tokens + r.cache_creation_tokens)}</td>
          <td>${F.formatNumber(r.total_tokens)}</td>
          <td class="cost-cell">${F.formatCost(r.cost)}</td>
        `;
        tbody.appendChild(tr);
      }
      if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">无匹配记录</td></tr>';
      }
    }

    // Wire search and filter
    const searchInput = container.querySelector('#recordSearch');
    if (searchInput) searchInput.addEventListener('input', applyRecordFilter);
    const modelFilter = container.querySelector('#recordModelFilter');
    if (modelFilter) modelFilter.addEventListener('change', applyRecordFilter);

    // Load summary + cards
    const [summary, dailyUsage] = await Promise.all([
      API.getSummary(),
      API.getDailyUsage(agentName)
    ]);

    const agentInfo = summary.byAgent.find(a => a.agent === agentName);
    const weekTokens = dailyUsage.slice(0, 7).reduce((s, d) => s + d.total_tokens, 0);
    const dayAvg = agentInfo && agentInfo.days > 0
      ? Math.round(agentInfo.total_tokens / agentInfo.days) : 0;

    if (agentInfo) {
      window.SummaryCards.render(document.getElementById('agentDetailCards'), [
        { label: '累计 Token', value: F.formatNumber(agentInfo.total_tokens),
          sub: `${agentInfo.records} 条记录` },
        { label: '花费', value: F.formatCost(agentInfo.cost), cost: true },
        { label: '本周 Token', value: F.formatNumber(weekTokens), accent: true },
        { label: '日均 Token', value: F.formatNumber(dayAvg), accent: true },
        { label: '记录数', value: F.formatNumber(agentInfo.records) },
        { label: '活跃天数', value: String(agentInfo.days) },
      ]);
    }

    // Token composition
    if (agentInfo) {
      // Need the per-type breakdown for this agent; getModelUsage has it
      const models = await API.getModelUsage(agentName);
      const totals = {
        input: models.reduce((s, m) => s + (m.input_tokens || 0), 0),
        output: models.reduce((s, m) => s + (m.output_tokens || 0), 0),
        cache_read: models.reduce((s, m) => s + (m.cache_read_tokens || 0), 0),
        cache_creation: models.reduce((s, m) => s + (m.cache_creation_tokens || 0), 0),
        reasoning: models.reduce((s, m) => s + (m.reasoning_tokens || 0), 0),
      };
      const compEl = document.getElementById('agentTokenComp');
      const parts = [
        { label: 'Input', val: totals.input, color: '#f97316' },
        { label: 'Output', val: totals.output, color: '#f472b6' },
        { label: '缓存读取', val: totals.cache_read, color: '#38bdf8' },
        { label: '缓存写入', val: totals.cache_creation, color: '#a78bfa' },
        { label: '推理', val: totals.reasoning, color: '#4ade80' },
      ].filter(p => p.val > 0);
      const compTotal = parts.reduce((s, p) => s + p.val, 0);
      if (compTotal > 0) {
        let barHtml = '<div class="comp-bar">';
        for (const p of parts) {
          const pct = (p.val / compTotal) * 100;
          barHtml += `<div class="comp-seg" style="width:${pct}%;background:${p.color}" title="${p.label}: ${F.formatNumber(p.val)}"></div>`;
        }
        barHtml += '</div><div class="comp-legend">';
        for (const p of parts) {
          const pct = (p.val / compTotal) * 100;
          barHtml += `<div class="comp-item"><span class="comp-swatch" style="background:${p.color}"></span><span class="comp-label">${p.label}</span><span class="comp-val">${F.formatNumber(p.val)}</span><span class="comp-pct">${pct.toFixed(1)}%</span></div>`;
        }
        barHtml += '</div>';
        compEl.innerHTML = barHtml;
      } else {
        compEl.innerHTML = '<div class="empty-state">暂无分类数据</div>';
      }
    }

    // Hourly distribution (aggregate from records)
    try {
      const records = await API.getRecords({ agent: agentName, limit: 500, offset: 0 });
      const hourBuckets = new Array(24).fill(0);
      for (const r of records) {
        const hour = parseInt(String(r.timestamp).substring(11, 13), 10);
        if (!isNaN(hour)) hourBuckets[hour] += r.total_tokens || 0;
      }
      const hourlyEl = document.getElementById('agentHourlyDist');
      const hourlyData = hourBuckets.map((tokens, h) => ({ hour: h, tokens }));
      window.HourlyChart.render(hourlyEl, hourlyData);

      // Rhythm stats
      const rhythmEl = document.getElementById('agentRhythm');
      const peakHour = hourBuckets.indexOf(Math.max(...hourBuckets));
      const dayTokens = dailyUsage.map(d => d.total_tokens);
      const peakDayIdx = dayTokens.indexOf(Math.max(...dayTokens));
      const peakDay = peakDayIdx >= 0 ? dailyUsage[peakDayIdx].date : '\u2014';
      rhythmEl.innerHTML = `
        <div class="compare-grid">
          <div class="compare-item">
            <span class="compare-label">日均 Token</span>
            <span class="compare-val">${F.formatNumber(dayAvg)}</span>
          </div>
          <div class="compare-item">
            <span class="compare-label">最忙时段</span>
            <span class="compare-val">${peakHour >= 0 ? peakHour + ':00' : '\u2014'}</span>
            <span class="compare-delta">${F.formatNumber(hourBuckets[peakHour])} tokens</span>
          </div>
          <div class="compare-item">
            <span class="compare-label">最忙日期</span>
            <span class="compare-val">${peakDay}</span>
            <span class="compare-delta">${F.formatNumber(Math.max(...dayTokens, 0))} tokens</span>
          </div>
          <div class="compare-item">
            <span class="compare-label">总活跃天数</span>
            <span class="compare-val">${agentInfo?.days || 0}</span>
          </div>
        </div>
      `;
    } catch { /* skip */ }

    document.getElementById('agentLoadMore').addEventListener('click', () => renderRecords(false));

    await renderTrend();
    await renderModels();
    await renderRecords(true);
  }

  function mount(container, param) {
    if (param) return mountDetail(container, decodeURIComponent(param));
    return mountList(container);
  }

  function unmount() {}

  async function refresh() {
    // Re-mount current view.
    const route = window.Router.current;
    if (!route) return;
    if (route.param) {
      window.Router.go(`/agents/${route.param}`);
    } else {
      window.Router.go('/agents');
    }
  }

  window.Router.register('agents', { mount, unmount });
  if (!window.Pages) window.Pages = {};
  window.Pages.agents = { refresh };
})();
