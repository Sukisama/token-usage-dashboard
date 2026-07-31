/**
 * cost.js — Cost center page
 *
 * 8 modules:
 * 1. 6 core cost cards (add daily avg + month projection)
 * 2. Budget progress card (localStorage)
 * 3. Daily cost trend (Y-axis FIXED to USD, drillable)
 * 4. Agent cost comparison trend (by agent stacked)
 * 5. Per-model cost ranking (with share bars)
 * 6. Per-agent cost ranking
 * 7. Cost anomaly detection (mean+2σ outliers)
 * 8. Budget setting entry
 */
(function () {
  'use strict';

  const F = window.F;
  const API = window.API;
  let _range = 30;

  const BUDGET_KEY = 'costBudget';

  function getBudget() {
    try {
      return JSON.parse(localStorage.getItem(BUDGET_KEY)) || {};
    } catch { return {}; }
  }

  function setBudget(b) {
    localStorage.setItem(BUDGET_KEY, JSON.stringify(b));
  }

  async function mount(container) {
    container.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title gradient">成本中心</div>
          <div class="page-subtitle">AI 用量花费分析 · 估算（基于定价表）</div>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <div class="tab-group" id="costRangeTabs">
            <button class="tab-btn" data-range="7">近 7 天</button>
            <button class="tab-btn active" data-range="30">近 30 天</button>
            <button class="tab-btn" data-range="90">近 90 天</button>
          </div>
          <button class="btn-secondary" id="budgetBtn">设置预算</button>
        </div>
      </div>

      <div id="costCards" class="summary-grid"></div>

      <div id="budgetCard" class="section">
        <div class="section-header">
          <h2>月预算进度</h2>
          <span class="hint" style="margin:0" id="budgetHint">未设置预算</span>
        </div>
        <div id="budgetProgress"></div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2>每日花费趋势</h2>
          <span class="hint" style="margin:0">Y 轴单位：美元 ($)</span>
        </div>
        <div class="trend-wrapper">
          <div id="costTrend" class="trend-chart"></div>
        </div>
        <div class="trend-legend" id="costTrendLegend"></div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2>Agent 花费趋势</h2>
          <span class="hint" style="margin:0">按 Agent 堆叠</span>
        </div>
        <div class="trend-wrapper">
          <div id="costTrendAgent" class="trend-chart"></div>
        </div>
        <div class="trend-legend" id="costTrendAgentLegend"></div>
      </div>

      <div id="anomalySection" class="section" style="display:none">
        <div class="section-header">
          <h2>花费异常</h2>
          <span class="hint" style="margin:0">超出均值 2σ 的日期</span>
        </div>
        <div id="anomalyList"></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="section">
          <div class="section-header"><h2>按模型花费排行</h2></div>
          <table class="data-table compact">
            <thead>
              <tr><th>模型</th><th>Tokens</th><th>记录</th><th>占比</th><th>花费</th></tr>
            </thead>
            <tbody id="costModelsBody"></tbody>
          </table>
        </div>
        <div class="section">
          <div class="section-header"><h2>按 Agent 花费排行</h2></div>
          <div id="costAgentRank"></div>
        </div>
      </div>

      <p class="hint" style="margin-top:16px">
        花费为估算，按模型价目表计算（缓存读取按 10% 折扣、缓存写入按 1.25 倍计入）。
        未知模型不计。<br>
        可在 <a href="#/settings" style="color:var(--brand-light)">设置</a> 页编辑价目表。
      </p>
    `;

    // Range tabs
    container.querySelectorAll('#costRangeTabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        _range = parseInt(btn.dataset.range, 10);
        container.querySelectorAll('#costRangeTabs .tab-btn').forEach(t =>
          t.classList.toggle('active', t === btn));
        await loadCostTrend();
        await loadAnomaly();
      });
    });

    // Budget button
    container.querySelector('#budgetBtn').addEventListener('click', openBudgetModal);

    await loadData();
  }

  async function loadData() {
    const [summary, periodWeek, periodMonth, dailyCost, dailyCostAgent, models] = await Promise.all([
      API.getSummary(),
      API.getPeriodSummary('week'),
      API.getPeriodSummary('month'),
      API.getDailyCost('all', _range),
      API.getDailyCostByAgent(_range).catch(() => []),
      API.getModelUsage('all')
    ]);

    // Calculate derived metrics
    const validDays = dailyCost.filter(d => d.cost > 0);
    const totalInRange = validDays.reduce((s, d) => s + d.cost, 0);
    const dailyAvg = validDays.length > 0 ? totalInRange / validDays.length : 0;

    // Month projection
    const now = new Date();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthProjection = periodMonth.cost != null
      ? (periodMonth.cost / dayOfMonth) * daysInMonth : null;

    // Render cards (6)
    window.SummaryCards.render(document.getElementById('costCards'), [
      { label: '累计花费 ≈', value: F.formatCost(summary.overall.cost), cost: true,
        sub: `${summary.overall.records} 条记录` },
      { label: '本周花费 ≈', value: F.formatCost(periodWeek.cost), cost: true,
        sub: `${periodWeek.byAgent.length} 个 Agent` },
      { label: '本月花费 ≈', value: F.formatCost(periodMonth.cost), cost: true },
      { label: '今日花费 ≈', value: F.formatCost(summary.todayCost), cost: true },
      { label: `日均花费 (近${_range}天)`, value: F.formatCost(dailyAvg), accent: true,
        sub: `${validDays.length} 个有效天` },
      { label: '本月预计', value: F.formatCost(monthProjection), accent: true,
        sub: `已过 ${dayOfMonth}/${daysInMonth} 天` },
    ]);

    // Budget progress
    renderBudget(periodMonth.cost);

    // Model ranking table
    const tbody = document.getElementById('costModelsBody');
    tbody.innerHTML = '';
    models.sort((a, b) => (b.cost || 0) - (a.cost || 0));
    const modelCostTotal = models.reduce((s, m) => s + (m.cost || 0), 0) || 1;
    F.buildModelColors(models.map(m => ({ model: m.model, total_tokens: m.total_tokens })));
    for (const m of models) {
      const pct = ((m.cost || 0) / modelCostTotal) * 100;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="rank-swatch inline" style="background:${F.modelColor(m.model)}"></span>${F.esc(m.model) || '\u2014'}</td>
        <td>${F.formatNumber(m.total_tokens)}</td>
        <td>${m.records}</td>
        <td>
          <div class="rank-bar inline-bar"><div class="rank-bar-fill" style="width:${pct}%;background:${F.modelColor(m.model)}"></div></div>
          <span style="font-size:11px;color:var(--text-secondary)">${pct.toFixed(1)}%</span>
        </td>
        <td class="cost-cell">${F.formatCost(m.cost)}</td>
      `;
      tbody.appendChild(tr);
    }

    // Agent cost ranking
    const agentRankEl = document.getElementById('costAgentRank');
    const costAgents = summary.byAgent.filter(a => a.cost != null).sort((a, b) => (b.cost || 0) - (a.cost || 0));
    const agentCostTotal = costAgents.reduce((s, a) => s + (a.cost || 0), 0) || 1;
    let agentHtml = '';
    for (const a of costAgents) {
      const pct = ((a.cost || 0) / agentCostTotal) * 100;
      const color = F.agentColor(a.agent);
      agentHtml += `
        <div class="rank-row" data-agent="${F.esc(a.agent)}" style="cursor:pointer">
          <span class="agent-dot" style="background:${color}"></span>
          <span class="rank-name">${F.esc(a.agent)}</span>
          <div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <span class="rank-val">${F.formatCost(a.cost)}</span>
          <span class="rank-pct">${pct.toFixed(1)}%</span>
        </div>
      `;
    }
    agentRankEl.innerHTML = agentHtml || '<div class="empty-state">暂无花费数据</div>';
    agentRankEl.querySelectorAll('.rank-row').forEach(row => {
      row.addEventListener('click', () => window.Router.go(`/agents/${row.dataset.agent}`));
    });

    // Render cost trend (model dimension, FIXED Y-axis)
    const trendEl = document.getElementById('costTrend');
    const trendLegend = document.getElementById('costTrendLegend');
    const trendRows = [];
    for (const day of dailyCost) {
      if (day.byModel) {
        for (const [model, cost] of Object.entries(day.byModel)) {
          trendRows.push({ date: day.date, model, total_tokens: cost || 0 });
        }
      }
    }
    F.buildModelColors(trendRows);
    window.TrendChart.render(trendEl, {
      rows: trendRows, dimension: 'model', range: 0,
      valueFormat: 'cost',
      legend: trendLegend,
      onBarClick: (date) => window.DrillModal.open(date),
    });

    // Render agent cost trend
    const agentTrendEl = document.getElementById('costTrendAgent');
    const agentTrendLegend = document.getElementById('costTrendAgentLegend');
    const agentTrendRows = [];
    for (const day of dailyCostAgent) {
      if (day.byAgent) {
        for (const [agent, cost] of Object.entries(day.byAgent)) {
          agentTrendRows.push({ date: day.date, agent, total_tokens: cost || 0 });
        }
      }
    }
    window.TrendChart.render(agentTrendEl, {
      rows: agentTrendRows, dimension: 'agent', range: 0,
      valueFormat: 'cost',
      legend: agentTrendLegend,
      onBarClick: (date) => window.DrillModal.open(date),
    });

    // Anomaly detection
    renderAnomaly(dailyCost);
  }

  function renderBudget(monthCost) {
    const budget = getBudget();
    const el = document.getElementById('budgetProgress');
    const hint = document.getElementById('budgetHint');

    if (!budget.monthly || budget.monthly <= 0) {
      el.innerHTML = '<div class="empty-state">点击"设置预算"开始追踪月度花费</div>';
      hint.textContent = '未设置预算';
      return;
    }

    const ratio = monthCost != null ? monthCost / budget.monthly : 0;
    const pct = Math.min(ratio * 100, 999);
    const remaining = budget.monthly - (monthCost || 0);

    let barCls = 'budget-bar';
    let statusCls = '';
    let statusText = '';
    if (ratio >= 1) {
      barCls += ' over'; statusCls = 'over'; statusText = '已超支';
    } else if (ratio >= 0.8) {
      barCls += ' warn'; statusCls = 'warn'; statusText = '接近上限';
    } else {
      statusText = '正常';
    }

    hint.textContent = `${statusText} · 预算 ${F.formatCost(budget.monthly)}/月`;

    el.innerHTML = `
      <div class="budget-row">
        <div class="budget-info">
          <span class="budget-label">已用</span>
          <span class="budget-val ${statusCls}">${F.formatCost(monthCost)}</span>
          <span class="budget-sep">/</span>
          <span class="budget-val">${F.formatCost(budget.monthly)}</span>
          <span class="budget-pct ${statusCls}">${(ratio * 100).toFixed(1)}%</span>
        </div>
        <div class="budget-info">
          <span class="budget-label">剩余</span>
          <span class="budget-val ${remaining < 0 ? 'over' : ''}">${F.formatCost(remaining)}</span>
        </div>
      </div>
      <div class="${barCls}"><div class="budget-fill" style="width:${Math.min(pct, 100)}%"></div></div>
    `;
  }

  function openBudgetModal() {
    const budget = getBudget();
    const overlay = document.createElement('div');
    overlay.className = 'drill-overlay show';
    overlay.innerHTML = `
      <div class="drill-modal" style="max-width:420px">
        <div class="drill-header">
          <h2>设置月预算</h2>
          <button class="drill-close" title="关闭">&times;</button>
        </div>
        <div class="drill-body">
          <div style="display:flex;flex-direction:column;gap:16px;padding:8px">
            <div>
              <label class="setting-label">月预算 ($)</label>
              <input type="number" class="setting-input" id="budgetMonthly" value="${budget.monthly || ''}" placeholder="如 50" min="0" step="1">
            </div>
            <div>
              <label class="setting-label">预警阈值 (占比，默认 80%)</label>
              <input type="number" class="setting-input" id="budgetWarn" value="${budget.warnAt || 0.8}" min="0.1" max="1" step="0.1">
            </div>
            <div style="display:flex;gap:10px;margin-top:8px">
              <button class="btn-primary" id="budgetSave">保存</button>
              <button class="btn-secondary" id="budgetClear">清除预算</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.classList.contains('drill-close')) overlay.remove();
    });

    overlay.querySelector('#budgetSave').addEventListener('click', async () => {
      const monthly = parseFloat(overlay.querySelector('#budgetMonthly').value);
      const warnAt = parseFloat(overlay.querySelector('#budgetWarn').value);
      if (!monthly || monthly <= 0) {
        window.setStatus('请输入有效的预算金额', 'error');
        return;
      }
      setBudget({ monthly, warnAt: warnAt || 0.8 });
      overlay.remove();
      window.setStatus('预算已保存', 'success');
      // Refresh budget display
      const monthCost = (await API.getPeriodSummary('month')).cost;
      renderBudget(monthCost);
    });

    overlay.querySelector('#budgetClear').addEventListener('click', () => {
      localStorage.removeItem(BUDGET_KEY);
      overlay.remove();
      window.setStatus('预算已清除', 'success');
      renderBudget(null);
    });
  }

  function renderAnomaly(dailyCost) {
    const costs = dailyCost.filter(d => d.cost > 0).map(d => ({ date: d.date, cost: d.cost }));
    if (costs.length < 5) {
      document.getElementById('anomalySection').style.display = 'none';
      return;
    }

    const mean = costs.reduce((s, d) => s + d.cost, 0) / costs.length;
    const variance = costs.reduce((s, d) => s + Math.pow(d.cost - mean, 2), 0) / costs.length;
    const std = Math.sqrt(variance);
    const threshold = mean + 2 * std;

    const anomalies = costs.filter(d => d.cost > threshold).sort((a, b) => b.cost - a.cost);

    const section = document.getElementById('anomalySection');
    const list = document.getElementById('anomalyList');

    if (anomalies.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    let html = `<div class="anomaly-note">均值 ${F.formatCost(mean)}/天 · 异常阈值 ${F.formatCost(threshold)}</div>`;
    html += '<div class="anomaly-grid">';
    for (const a of anomalies) {
      const ratio = a.cost / mean;
      html += `
        <div class="anomaly-card" data-date="${a.date}" style="cursor:pointer">
          <div class="anomaly-date">${a.date}</div>
          <div class="anomaly-cost">${F.formatCost(a.cost)}</div>
          <div class="anomaly-ratio">${ratio.toFixed(1)}× 均值</div>
        </div>
      `;
    }
    html += '</div>';
    list.innerHTML = html;

    list.querySelectorAll('.anomaly-card').forEach(card => {
      card.addEventListener('click', () => window.DrillModal.open(card.dataset.date));
    });
  }

  async function loadCostTrend() {
    const dailyCost = await API.getDailyCost('all', _range);
    const dailyCostAgent = await API.getDailyCostByAgent(_range).catch(() => []);

    // Model dimension
    const trendRows = [];
    for (const day of dailyCost) {
      if (day.byModel) {
        for (const [model, cost] of Object.entries(day.byModel)) {
          trendRows.push({ date: day.date, model, total_tokens: cost || 0 });
        }
      }
    }
    F.buildModelColors(trendRows);
    window.TrendChart.render(document.getElementById('costTrend'), {
      rows: trendRows, dimension: 'model', range: 0,
      valueFormat: 'cost',
      legend: document.getElementById('costTrendLegend'),
      onBarClick: (date) => window.DrillModal.open(date),
    });

    // Agent dimension
    const agentRows = [];
    for (const day of dailyCostAgent) {
      if (day.byAgent) {
        for (const [agent, cost] of Object.entries(day.byAgent)) {
          agentRows.push({ date: day.date, agent, total_tokens: cost || 0 });
        }
      }
    }
    window.TrendChart.render(document.getElementById('costTrendAgent'), {
      rows: agentRows, dimension: 'agent', range: 0,
      valueFormat: 'cost',
      legend: document.getElementById('costTrendAgentLegend'),
      onBarClick: (date) => window.DrillModal.open(date),
    });
  }

  async function loadAnomaly() {
    const dailyCost = await API.getDailyCost('all', _range);
    renderAnomaly(dailyCost);
  }

  function unmount() {}

  async function refresh() {
    await loadData();
  }

  window.Router.register('cost', { mount, unmount });
  if (!window.Pages) window.Pages = {};
  window.Pages.cost = { refresh };
})();
