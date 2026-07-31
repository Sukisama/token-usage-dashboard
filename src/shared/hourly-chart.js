/**
 * hourly-chart.js — Today's hourly token distribution (global: window.HourlyChart)
 *
 * Usage:
 *   HourlyChart.render(container, {
 *     data: [{hour:0, tokens:0},...,{hour:23, tokens:123}],
 *     onBarClick: (hour) => {}
 *   });
 */
(function () {
  'use strict';

  const F = window.F;

  function render(container, data) {
    container.innerHTML = '';
    if (!data || data.length === 0) {
      container.innerHTML = '<div class="empty-state">今日暂无用量</div>';
      return;
    }

    // Build a 24-slot array (fill missing hours with 0)
    const map = new Map();
    for (const row of data) map.set(parseInt(row.hour, 10), row.tokens || 0);
    const hours = [];
    for (let h = 0; h < 24; h++) hours.push(map.get(h) || 0);
    const maxVal = Math.max(1, ...hours);

    const chartEl = document.createElement('div');
    chartEl.className = 'hourly-chart';

    for (let h = 0; h < 24; h++) {
      const bar = document.createElement('div');
      bar.className = 'hourly-bar';
      const pct = (hours[h] / maxVal) * 100;
      bar.style.height = `${Math.max(2, pct)}%`;
      bar.title = `${h}:00 — ${F.formatNumber(hours[h])} tokens`;
      chartEl.appendChild(bar);
    }
    container.appendChild(chartEl);

    // Axis labels: 0, 6, 12, 18, 23
    const labelsEl = document.createElement('div');
    labelsEl.className = 'hourly-labels';
    labelsEl.innerHTML = `<span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>`;
    container.appendChild(labelsEl);
  }

  window.HourlyChart = { render };
})();
