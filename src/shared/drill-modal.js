/**
 * drill-modal.js — Day drill-down modal (global: window.DrillModal)
 *
 * Clicking a trend bar or heatmap cell opens this to show the day's details:
 * hourly distribution + agent breakdown + top records.
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
    document.body.appendChild(_overlay);
    return _overlay;
  }

  async function open(date) {
    const overlay = ensureOverlay();
    const title = overlay.querySelector('#drillTitle');
    const body = overlay.querySelector('#drillBody');

    title.textContent = `${date} 详情`;
    body.innerHTML = '<div class="empty-state">加载中...</div>';
    overlay.classList.add('show');

    try {
      const [hourly, records] = await Promise.all([
        API.getHourly('all', date),
        API.getRecords({ date, limit: 20, offset: 0 })
      ]);

      // Build content
      let html = '';

      // Section 1: hourly chart
      html += `
        <div class="drill-section">
          <h3>每小时分布</h3>
          <div id="drillHourly"></div>
        </div>
      `;

      // Section 2: agent breakdown for this day
      const agentMap = {};
      let dayTotal = 0;
      for (const r of records) {
        agentMap[r.agent] = (agentMap[r.agent] || 0) + (r.total_tokens || 0);
        dayTotal += r.total_tokens || 0;
      }
      const agentList = Object.entries(agentMap).sort((a, b) => b[1] - a[1]);
      html += `
        <div class="drill-section">
          <h3>Agent 占比 <span class="drill-total">${F.formatNumber(dayTotal)} tokens · ${records.length} 条</span></h3>
          <div class="drill-agents">
      `;
      for (const [agent, tokens] of agentList) {
        const pct = dayTotal > 0 ? (tokens / dayTotal) * 100 : 0;
        const color = F.agentColor(agent);
        html += `
          <div class="drill-agent-row">
            <span class="agent-dot" style="background:${color}"></span>
            <span class="drill-agent-name">${F.esc(agent)}</span>
            <div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%;background:${color}"></div></div>
            <span class="drill-agent-val">${F.formatNumber(tokens)}</span>
            <span class="drill-agent-pct">${pct.toFixed(1)}%</span>
          </div>
        `;
      }
      html += `</div></div>`;

      // Section 3: top records
      html += `
        <div class="drill-section">
          <h3>最近记录</h3>
          <table class="data-table compact">
            <thead>
              <tr><th>时间</th><th>Agent</th><th>模型</th><th>次数</th><th>Total</th><th>花费</th></tr>
            </thead>
            <tbody>
      `;
      if (!records.length) {
        html += '<tr><td colspan="6" class="empty-state">暂无记录</td></tr>';
      }
      for (const r of records.slice(0, 15)) {
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
      html += `</tbody></table></div>`;

      body.innerHTML = html;

      // Render hourly chart after DOM is ready
      const hourlyEl = body.querySelector('#drillHourly');
      if (hourlyEl && hourly.length > 0) {
        window.HourlyChart.render(hourlyEl, hourly);
      } else if (hourlyEl) {
        hourlyEl.innerHTML = '<div class="empty-state">当日无用量</div>';
      }
    } catch (err) {
      body.innerHTML = `<div class="empty-state">加载失败: ${F.esc(err.message)}</div>`;
    }
  }

  function close() {
    if (_overlay) _overlay.classList.remove('show');
  }

  window.DrillModal = { open, close };
})();
