/**
 * drill-modal.js — Day drill-down modal (global: window.DrillModal)
 *
 * Clicking a trend bar or heatmap cell opens this to show the day's details:
 * hourly distribution + agent breakdown (full-day summary) + paginated records.
 *
 * Usage:
 *   DrillModal.open(date);          // shows the modal for a date
 *   DrillModal.close();             // closes
 */
(function () {
  'use strict';

  const F = window.F;
  const API = window.API;

  let _overlay = null;
  const PAGE_SIZE = 20;

  // Pagination state for the current modal
  let _currentDate = null;
  let _currentPage = 0;
  let _totalRecords = 0;

  function ensureOverlay() {
    if (_overlay) return _overlay;
    _overlay = document.createElement('div');
    _overlay.className = 'drill-overlay';
    _overlay.innerHTML = `
      <div class="drill-modal">
        <div class="drill-header">
          <h2 id="drillTitle"></h2>
          <button class="drill-close" title="关闭">&times;</button>
        </div>
        <div class="drill-body" id="drillBody"></div>
      </div>
    `;
    _overlay.addEventListener('click', e => {
      if (e.target === _overlay || e.target.classList.contains('drill-close')) close();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _overlay && _overlay.classList.contains('show')) close();
    });
    document.body.appendChild(_overlay);
    return _overlay;
  }

  async function open(date) {
    const overlay = ensureOverlay();
    const title = overlay.querySelector('#drillTitle');
    const body = overlay.querySelector('#drillBody');

    _currentDate = date;
    _currentPage = 0;
    _totalRecords = 0;

    title.textContent = `${date} 详情`;
    body.innerHTML = '<div class="empty-state">加载中...</div>';
    overlay.classList.add('show');

    try {
      // Fetch hourly chart + full-day agent summary (no pagination needed)
      const [hourly, agentSummary] = await Promise.all([
        API.getHourly('all', date),
        API.getDaySummary(date)
      ]);

      // Build static sections
      let html = '';

      // Section 1: hourly chart
      html += `
        <div class="drill-section">
          <h3>每小时分布</h3>
          <div id="drillHourly"></div>
        </div>
      `;

      // Section 2: agent breakdown (from full-day summary)
      const agentMap = {};
      let dayTotal = 0;
      let dayCost = 0;
      let dayRecords = 0;
      for (const r of agentSummary) {
        if (!agentMap[r.agent]) agentMap[r.agent] = { tokens: 0, cost: 0, records: 0 };
        agentMap[r.agent].tokens += r.total_tokens || 0;
        agentMap[r.agent].records += r.records || 0;
        if (r.cost != null) agentMap[r.agent].cost += r.cost;
        dayTotal += r.total_tokens || 0;
        dayRecords += r.records || 0;
      }
      for (const k of Object.keys(agentMap)) dayCost += agentMap[k].cost;

      const agentList = Object.entries(agentMap).sort((a, b) => b[1].tokens - a[1].tokens);
      html += `
        <div class="drill-section">
          <h3>Agent 占比 <span class="drill-total">${F.formatNumber(dayTotal)} tokens · ${dayRecords} 条 · ${F.formatCost(dayCost)}</span></h3>
          <div class="drill-agents">
      `;
      for (const [agent, info] of agentList) {
        const pct = dayTotal > 0 ? (info.tokens / dayTotal) * 100 : 0;
        const color = F.agentColor(agent);
        html += `
          <div class="drill-agent-row">
            <span class="agent-dot" style="background:${color}"></span>
            <span class="drill-agent-name">${F.esc(agent)}</span>
            <div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%;background:${color}"></div></div>
            <span class="drill-agent-val">${F.formatNumber(info.tokens)}</span>
            <span class="drill-agent-pct">${pct.toFixed(1)}%</span>
          </div>
        `;
      }
      html += `</div></div>`;

      // Section 3: paginated records table
      html += `
        <div class="drill-section">
          <h3>详细记录</h3>
          <div id="drillRecordsContainer">
            <div class="empty-state">加载中...</div>
          </div>
        </div>
      `;

      body.innerHTML = html;

      // Render hourly chart after DOM is ready
      const hourlyEl = body.querySelector('#drillHourly');
      if (hourlyEl && hourly.length > 0) {
        window.HourlyChart.render(hourlyEl, hourly);
      } else if (hourlyEl) {
        hourlyEl.innerHTML = '<div class="empty-state">当日无用量</div>';
      }

      // Load first page of records
      await loadRecordsPage();
    } catch (err) {
      body.innerHTML = `<div class="empty-state">加载失败: ${F.esc(err.message)}</div>`;
    }
  }

  async function loadRecordsPage() {
    const container = document.getElementById('drillRecordsContainer');
    if (!container) return;

    container.innerHTML = '<div class="empty-state">加载中...</div>';

    try {
      const { records, total } = await API.getRecords({
        date: _currentDate,
        limit: PAGE_SIZE,
        offset: _currentPage * PAGE_SIZE
      });
      _totalRecords = total;

      const startIdx = _currentPage * PAGE_SIZE;
      const endIdx = startIdx + records.length;
      const totalPages = Math.ceil(total / PAGE_SIZE);

      let html = `
        <table class="data-table compact">
          <thead>
            <tr><th>时间</th><th>Agent</th><th>模型</th><th>次数</th><th>Total</th><th>花费</th></tr>
          </thead>
          <tbody>
      `;
      if (!records.length) {
        html += '<tr><td colspan="6" class="empty-state">暂无记录</td></tr>';
      }
      for (const r of records) {
        const color = F.agentColor(r.agent);
        html += `
          <tr>
            <td>${F.formatDateTime(r.timestamp)}</td>
            <td><span class="agent-dot inline" style="background:${color}"></span>${F.esc(r.agent)}</td>
            <td>${F.esc(r.model) || '\u2014'}</td>
            <td>${r.requests > 1 ? '\u00d7' + r.requests : '1'}</td>
            <td>${F.formatNumber(r.total_tokens)}</td>
            <td class="cost-cell">${F.formatCost(r.cost)}</td>
          </tr>
        `;
      }
      html += `</tbody></table>`;

      // Pagination controls
      if (total > PAGE_SIZE) {
        html += `
          <div class="pagination">
            <button class="page-btn" id="drillFirstPage" ${_currentPage === 0 ? 'disabled' : ''}>&laquo;</button>
            <button class="page-btn" id="drillPrevPage" ${_currentPage === 0 ? 'disabled' : ''}>&lsaquo; 上一页</button>
            <span class="page-info">第 ${startIdx + 1}-${endIdx} 条 / 共 ${total} 条（${_currentPage + 1}/${totalPages}）</span>
            <button class="page-btn" id="drillNextPage" ${endIdx >= total ? 'disabled' : ''}>下一页 &rsaquo;</button>
            <button class="page-btn" id="drillLastPage" ${endIdx >= total ? 'disabled' : ''}>&raquo;</button>
          </div>
        `;
      } else if (total > 0) {
        html += `<div class="pagination"><span class="page-info">共 ${total} 条</span></div>`;
      }

      container.innerHTML = html;

      // Bind pagination buttons
      const firstBtn = document.getElementById('drillFirstPage');
      const prevBtn = document.getElementById('drillPrevPage');
      const nextBtn = document.getElementById('drillNextPage');
      const lastBtn = document.getElementById('drillLastPage');
      const totalPagesCalc = Math.ceil(total / PAGE_SIZE);

      if (firstBtn) firstBtn.addEventListener('click', () => { _currentPage = 0; loadRecordsPage(); });
      if (prevBtn) prevBtn.addEventListener('click', () => { if (_currentPage > 0) { _currentPage--; loadRecordsPage(); } });
      if (nextBtn) nextBtn.addEventListener('click', () => { if (_currentPage < totalPagesCalc - 1) { _currentPage++; loadRecordsPage(); } });
      if (lastBtn) lastBtn.addEventListener('click', () => { _currentPage = totalPagesCalc - 1; loadRecordsPage(); });
    } catch (err) {
      container.innerHTML = `<div class="empty-state">加载失败: ${F.esc(err.message)}</div>`;
    }
  }

  function close() {
    if (_overlay) _overlay.classList.remove('show');
  }

  window.DrillModal = { open, close };
})();
