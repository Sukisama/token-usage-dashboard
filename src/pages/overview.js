/**
 * overview.js — Overview page
 *
 * 7 modules:
 * 1. 8 core metric cards
 * 2. Week/month-over-week comparison bar
 * 3. Today's hourly distribution
 * 4. Usage trend (drillable)
 * 5. Heatmap (drillable)
 * 6. Active Agent ranking + Top model ranking
 * 7. Token composition (input/output/cache/reasoning)
 */
(function () {
  'use strict';

  const F = window.F;
  const API = window.API;
  let _summaryData = null;
  let _periodWeek = null;
  let _periodMonth = null;
  let _modelUsage = [];
  let _trendDim = 'agent';
  let _trendRange = 30;
  let _dailyByAgent = [];
  let _dailyByModel = [];
  let _dailyData = [];

  async function mount(container) {
    container.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title gradient">概览</div>
          <div class="page-subtitle">跨 Agent 用量统计 · 自动采集本地日志</div>
        </div>
      </div>

      <div id="overviewCards" class="summary-grid"></div>

      <div class="section" id="compareSection">
        <div class="section-header"><h2>环比对比</h2></div>
        <div id="compareBar"></div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2>今日每小时用量</h2>
          <button class="btn-text" id="ovTodayDrill">查看今日详情</button>
        </div>
        <div id="hourlyChart"></div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2>用量趋势</h2>
          <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
            <div class="tab-group" id="ovDimTabs">
              <button class="tab-btn active" data-dim="agent">按 Agent</button>
              <button class="tab-btn" data-dim="model">按模型</button>
            </div>
            <div class="tab-group" id="ovRangeTabs">
              <button class="tab-btn" data-range="7">近 7 天</button>
              <button class="tab-btn active" data-range="30">近 30 天</button>
              <button class="tab-btn" data-range="90">近 90 天</button>
              <button class="tab-btn" data-range="0">全部</button>
            </div>
          </div>
        </div>
        <div class="trend-wrapper">
          <div id="overviewTrend" class="trend-chart"></div>
        </div>
        <div class="trend-legend" id="overviewLegend"></div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2>每日用量热力图</h2>
          <div class="legend-row">
            <span>少</span>
            <div class="legend-cells">
              <div class="legend-cell level-0"></div>
              <div class="legend-cell level-1"></div>
              <div class="legend-cell level-2"></div>
              <div class="legend-cell level-3"></div>
              <div class="legend-cell level-4"></div>
            </div>
            <span>多</span>
          </div>
        </div>
        <div class="heatmap-wrapper">
          <div id="overviewHeatmap" class="heatmap"></div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="section">
          <div class="section-header"><h2>活跃 Agent 排行</h2></div>
          <div id="agentRanking"></div>
        </div>
        <div class="section">
          <div class="section-header"><h2>Top 模型排行</h2></div>
          <div id="modelRanking"></div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2>Token 构成分析</h2>
          <span class="hint" style="margin:0">按 token 类型占比</span>
        </div>
        <div id="tokenComposition"></div>
      </div>
    `;

    // Wire tabs
    container.querySelectorAll('#ovDimTabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _trendDim = btn.dataset.dim;
        container.querySelectorAll('#ovDimTabs .tab-btn').forEach(t =>
          t.classList.toggle('active', t === btn));
        renderTrend();
      });
    });
    container.querySelectorAll('#ovRangeTabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _trendRange = parseInt(btn.dataset.range, 10);
        container.querySelectorAll('#ovRangeTabs .tab-btn').forEach(t =>
          t.classList.toggle('active', t === btn));
        renderTrend();
      });
    });

    // Today drill-down
    const todayStr = new Date().toISOString().split('T')[0];
    const drillBtn = container.querySelector('#ovTodayDrill');
    if (drillBtn) {
      drillBtn.addEventListener('click', () => window.DrillModal.open(todayStr));
    }

    await loadData();
  }

  function unmount() {}

  async function loadData() {
    // Fetch everything in parallel
    const [summary, weekData, monthData, models, dailyByAgent, dailyByModel, dailyData] = await Promise.all([
      API.getSummary(),
      API.getPeriodSummary('week'),
      API.getPeriodSummary('month'),
      API.getModelUsage('all'),
      API.getDailyByAgent('all'),
      API.getDailyByModel('all'),
      API.getDailyUsage('all')
    ]);

    _summaryData = summary;
    _periodWeek = weekData;
    _periodMonth = monthData;
    _modelUsage = models;
    _dailyByAgent = dailyByAgent;
    _dailyByModel = dailyByModel;
    _dailyData = dailyData;

    F.buildModelColors(dailyByModel);

    renderCards();
    renderCompare();
    renderTrend();
    renderHeatmap();
    renderRankings();
    renderComposition();

    // Hourly chart for today
    const today = new Date().toISOString().split('T')[0];
    try {
      const hourly = await API.getHourly('all', today);
      window.HourlyChart.render(document.getElementById('hourlyChart'), hourly);
    } catch { /* API may not exist yet */ }
  }

  function renderCards() {
    const d = _summaryData;
    const overall = d.overall;
    const todayTokens = d.today.reduce((s, t) => s + t.total_tokens, 0);
    const todayCacheRead = d.today.reduce((s, t) => s + (t.cache_read_tokens || 0), 0);
    const cacheHitRate = overall.total_tokens > 0
      ? overall.cache_read_tokens / overall.total_tokens : 0;
    const dailyAvg = overall.days > 0
      ? Math.round(overall.total_tokens / overall.days) : 0;

    window.SummaryCards.render(document.getElementById('overviewCards'), [
      { label: '累计 Token', value: F.formatNumber(overall.total_tokens),
        sub: `缓存读取 ${F.formatNumber(overall.cache_read_tokens)}` },
      { label: '累计花费 ≈', value: F.formatCost(overall.cost), cost: true },
      { label: '今日 Token', value: F.formatNumber(todayTokens),
        sub: `缓存读取 ${F.formatNumber(todayCacheRead)}` },
      { label: '今日花费 ≈', value: F.formatCost(d.todayCost), cost: true },
      { label: '本周花费 ≈', value: F.formatCost(_periodWeek.cost), cost: true,
        sub: `${_periodWeek.byAgent.length} 个 Agent 活跃` },
      { label: '缓存命中率', value: F.formatPercent(cacheHitRate), accent: true,
        sub: `节省 ${F.formatNumber(overall.cache_read_tokens)} tokens` },
      { label: '活跃天数', value: String(overall.days), accent: true,
        sub: `${overall.records} 条记录` },
      { label: '日均 Token', value: F.formatNumber(dailyAvg), accent: true,
        sub: `≈ ${F.formatCost(dailyAvg > 0 && overall.cost ? overall.cost / overall.days : 0)}/天` },
    ]);
  }

  function renderCompare() {
    const el = document.getElementById('compareBar');
    if (!el) return;
    const daily = _dailyData;
    if (!daily || daily.length < 2) {
      el.innerHTML = '<div class="empty-state">数据不足，无法计算环比</div>';
      return;
    }

    // Sort ascending by date for aggregation
    const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));

    // Helper: sum tokens for a date range [start, end] inclusive
    function sumRange(start, end) {
      let tokens = 0;
      for (const d of sorted) {
        if (d.date >= start && d.date <= end) tokens += d.total_tokens || 0;
      }
      return tokens;
    }

    const now = new Date();
    const p = n => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;

    // This week (Mon-Sun)
    const dayOfWeek = (now.getDay() + 6) % 7; // 0=Mon
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() - dayOfWeek);
    const thisWeekStartStr = `${thisWeekStart.getFullYear()}-${p(thisWeekStart.getMonth() + 1)}-${p(thisWeekStart.getDate())}`;
    const thisWeekEnd = new Date(thisWeekStart);
    thisWeekEnd.setDate(thisWeekStart.getDate() + 6);
    const thisWeekEndStr = `${thisWeekEnd.getFullYear()}-${p(thisWeekEnd.getMonth() + 1)}-${p(thisWeekEnd.getDate())}`;

    // Last week
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(thisWeekStart.getDate() - 7);
    const lastWeekStartStr = `${lastWeekStart.getFullYear()}-${p(lastWeekStart.getMonth() + 1)}-${p(lastWeekStart.getDate())}`;
    const lastWeekEnd = new Date(thisWeekStart);
    lastWeekEnd.setDate(thisWeekStart.getDate() - 1);
    const lastWeekEndStr = `${lastWeekEnd.getFullYear()}-${p(lastWeekEnd.getMonth() + 1)}-${p(lastWeekEnd.getDate())}`;

    // This month / last month
    const thisMonthStartStr = `${now.getFullYear()}-${p(now.getMonth() + 1)}-01`;
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthStartStr = `${prevMonth.getFullYear()}-${p(prevMonth.getMonth() + 1)}-01`;
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const lastMonthEndStr = `${lastMonthEnd.getFullYear()}-${p(lastMonthEnd.getMonth() + 1)}-${p(lastMonthEnd.getDate())}`;

    const thisWeekTokens = sumRange(thisWeekStartStr, todayStr);
    const lastWeekTokens = sumRange(lastWeekStartStr, lastWeekEndStr);
    const thisMonthTokens = sumRange(thisMonthStartStr, todayStr);
    const lastMonthTokens = sumRange(lastMonthStartStr, lastMonthEndStr);

    const weekDelta = F.formatDelta(thisWeekTokens, lastWeekTokens);
    const monthDelta = F.formatDelta(thisMonthTokens, lastMonthTokens);
    const weekCostDelta = F.formatDelta(_periodWeek.cost, lastWeekTokens > 0 ? lastWeekTokens * (_periodWeek.cost / Math.max(1, thisWeekTokens)) : 0);

    el.innerHTML = `
      <div class="compare-grid">
        <div class="compare-item">
          <span class="compare-label">本周 Token</span>
          <span class="compare-val">${F.formatNumber(thisWeekTokens)}</span>
          <span class="compare-delta ${weekDelta.startsWith('\u2191') ? 'up' : weekDelta.startsWith('\u2193') ? 'down' : ''}">${weekDelta || '\u2014'} vs 上周 ${F.formatNumber(lastWeekTokens)}</span>
        </div>
        <div class="compare-item">
          <span class="compare-label">本周花费</span>
          <span class="compare-val cost">${F.formatCost(_periodWeek.cost)}</span>
          <span class="compare-delta ${weekCostDelta.startsWith('\u2191') ? 'up' : weekCostDelta.startsWith('\u2193') ? 'down' : ''}">${weekCostDelta || '\u2014'}</span>
        </div>
        <div class="compare-item">
          <span class="compare-label">本月 Token</span>
          <span class="compare-val">${F.formatNumber(thisMonthTokens)}</span>
          <span class="compare-delta ${monthDelta.startsWith('\u2191') ? 'up' : monthDelta.startsWith('\u2193') ? 'down' : ''}">${monthDelta || '\u2014'} vs 上月 ${F.formatNumber(lastMonthTokens)}</span>
        </div>
        <div class="compare-item">
          <span class="compare-label">本月花费</span>
          <span class="compare-val cost">${F.formatCost(_periodMonth.cost)}</span>
          <span class="compare-delta">\u2014</span>
        </div>
      </div>
    `;
  }

  function renderTrend() {
    const el = document.getElementById('overviewTrend');
    if (!el) return;
    const legendEl = document.getElementById('overviewLegend');
    const rows = _trendDim === 'model' ? _dailyByModel : _dailyByAgent;
    window.TrendChart.render(el, {
      rows,
      dimension: _trendDim,
      range: _trendRange,
      legend: legendEl,
      onBarClick: (date) => window.DrillModal.open(date),
    });
  }

  function renderHeatmap() {
    const el = document.getElementById('overviewHeatmap');
    if (!el) return;
    window.Heatmap.render(el, {
      data: _dailyData,
      onCellClick: (date) => window.DrillModal.open(date),
    });
  }

  function renderRankings() {
    // Agent ranking
    const agentEl = document.getElementById('agentRanking');
    const agents = _summaryData.byAgent || [];
    const totalTokens = agents.reduce((s, a) => s + a.total_tokens, 0) || 1;
    const topAgents = agents.slice(0, 8);
    let agentHtml = '';
    for (const a of topAgents) {
      const pct = (a.total_tokens / totalTokens) * 100;
      const color = F.agentColor(a.agent);
      agentHtml += `
        <div class="rank-row" data-agent="${F.esc(a.agent)}">
          <span class="agent-dot" style="background:${color}"></span>
          <span class="rank-name">${F.esc(a.agent)}</span>
          <div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <span class="rank-val">${F.formatNumber(a.total_tokens)}</span>
          <span class="rank-pct">${pct.toFixed(1)}%</span>
        </div>
      `;
    }
    agentEl.innerHTML = agentHtml || '<div class="empty-state">暂无数据</div>';
    agentEl.querySelectorAll('.rank-row').forEach(row => {
      row.addEventListener('click', () => {
        const agent = row.dataset.agent;
        if (agent) window.Router.go(`/agents/${agent}`);
      });
    });

    // Model ranking
    const modelEl = document.getElementById('modelRanking');
    const models = _modelUsage || [];
    const modelTotal = models.reduce((s, m) => s + m.total_tokens, 0) || 1;
    const topModels = models.slice(0, 8);
    let modelHtml = '';
    for (const m of topModels) {
      const pct = (m.total_tokens / modelTotal) * 100;
      const color = F.modelColor(m.model);
      modelHtml += `
        <div class="rank-row">
          <span class="rank-swatch" style="background:${color}"></span>
          <span class="rank-name" title="${F.esc(m.model)}">${F.esc(m.model) || '\u2014'}</span>
          <div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <span class="rank-val">${F.formatNumber(m.total_tokens)}</span>
          <span class="rank-pct">${pct.toFixed(1)}%</span>
        </div>
      `;
    }
    modelEl.innerHTML = modelHtml || '<div class="empty-state">暂无数据</div>';
  }

  function renderComposition() {
    const el = document.getElementById('tokenComposition');
    if (!el) return;
    const o = _summaryData.overall;
    const parts = [
      { label: 'Input', val: o.input_tokens, color: '#f97316' },
      { label: 'Output', val: o.output_tokens, color: '#f472b6' },
      { label: '缓存读取', val: o.cache_read_tokens, color: '#38bdf8' },
      { label: '缓存写入', val: o.cache_creation_tokens, color: '#a78bfa' },
      { label: '推理', val: o.reasoning_tokens, color: '#4ade80' },
    ].filter(p => p.val > 0);

    const total = parts.reduce((s, p) => s + p.val, 0);
    if (total === 0) {
      el.innerHTML = '<div class="empty-state">暂无数据</div>';
      return;
    }

    // Horizontal stacked bar
    let barHtml = '<div class="comp-bar">';
    for (const p of parts) {
      const pct = (p.val / total) * 100;
      barHtml += `<div class="comp-seg" style="width:${pct}%;background:${p.color}" title="${p.label}: ${F.formatNumber(p.val)} (${pct.toFixed(1)}%)"></div>`;
    }
    barHtml += '</div>';

    // Legend
    let legendHtml = '<div class="comp-legend">';
    for (const p of parts) {
      const pct = (p.val / total) * 100;
      legendHtml += `
        <div class="comp-item">
          <span class="comp-swatch" style="background:${p.color}"></span>
          <span class="comp-label">${p.label}</span>
          <span class="comp-val">${F.formatNumber(p.val)}</span>
          <span class="comp-pct">${pct.toFixed(1)}%</span>
        </div>
      `;
    }
    legendHtml += '</div>';

    el.innerHTML = barHtml + legendHtml;
  }

  async function refresh() {
    await loadData();
  }

  window.Router.register('overview', { mount, unmount });
  // Register for global refresh.
  if (!window.Pages) window.Pages = {};
  window.Pages.overview = { refresh };
})();
