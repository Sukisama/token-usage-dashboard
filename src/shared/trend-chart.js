/**
 * trend-chart.js — Reusable stacked bar chart (global: window.TrendChart)
 *
 * Usage:
 *   TrendChart.render(container, {
 *     rows: [{date, agent|model, total_tokens}],
 *     dimension: 'agent' | 'model',
 *     range: 30,        // days, 0 = all
 *     valueFormat: 'token' | 'cost',  // Y-axis label formatter
 *     valueField: 'total_tokens',     // which field to read from rows
 *     onBarClick: (date) => {},
 *     legend: legendEl
 *   });
 */
(function () {
  'use strict';

  const F = window.F;

  function render(container, opts) {
    const {
      rows = [], dimension = 'agent', range = 30,
      onBarClick, legend: legendEl,
      valueFormat = 'token', valueField = 'total_tokens'
    } = opts;
    container.innerHTML = '';
    if (legendEl) legendEl.innerHTML = '';

    const keyName = dimension === 'model' ? 'model' : 'agent';
    const colorFor = dimension === 'model'
      ? F.modelColor
      : (a => F.AGENT_COLORS[a] || F.AGENT_COLORS.unknown);

    // Pick the correct formatter based on value dimension.
    const fmt = valueFormat === 'cost' ? F.formatCost : F.formatNumber;

    if (!rows.length) {
      container.innerHTML = '<div class="empty-state">暂无数据</div>';
      return;
    }

    const allDates = [...new Set(rows.map(r => r.date))].sort();
    let dates = allDates;
    if (range > 0) dates = allDates.slice(-range);
    const dateSet = new Set(dates);

    const seriesTotals = new Map();
    const byDate = new Map(dates.map(d => [d, {}]));
    for (const row of rows) {
      if (!dateSet.has(row.date)) continue;
      const k = row[keyName];
      const v = row[valueField] || 0;
      byDate.get(row.date)[k] = (byDate.get(row.date)[k] || 0) + v;
      seriesTotals.set(k, (seriesTotals.get(k) || 0) + v);
    }

    let series = [...seriesTotals.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    const MAX_SERIES = 12;
    if (series.length > MAX_SERIES) {
      const tail = new Set(series.slice(MAX_SERIES - 1));
      for (const d of dates) {
        const obj = byDate.get(d);
        let sum = 0;
        for (const k of Object.keys(obj)) if (tail.has(k)) { sum += obj[k]; delete obj[k]; }
        if (sum > 0) obj['\u5176\u4ed6'] = (obj['\u5176\u4ed6'] || 0) + sum;
      }
      series = [...series.slice(0, MAX_SERIES - 1), '\u5176\u4ed6'];
    }
    const colorOf = k => (k === '\u5176\u4ed6' ? F.AGENT_COLORS.unknown : colorFor(k));

    const totals = dates.map(d => series.reduce((s, k) => s + (byDate.get(d)[k] || 0), 0));
    const maxTotal = Math.max(1, ...totals);

    const H = 200, padTop = 10, padBottom = 22, padLeft = 48, padRight = 10;
    const availW = Math.max(320, container.clientWidth || 900);
    const slot = (availW - padLeft - padRight) / dates.length;
    const barGap = Math.min(6, Math.max(1, slot * 0.18));
    const barW = Math.max(2, slot - barGap);
    const plotH = H - padTop - padBottom;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', availW);
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', `0 0 ${availW} ${H}`);

    // Y gridlines
    [0, 0.5, 1].forEach(f => {
      const y = padTop + plotH * (1 - f);
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', padLeft); line.setAttribute('x2', availW - padRight);
      line.setAttribute('y1', y); line.setAttribute('y2', y);
      line.setAttribute('stroke', '#3f3f46'); line.setAttribute('stroke-width', '1');
      svg.appendChild(line);
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', padLeft - 6); label.setAttribute('y', y + 3);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('fill', '#a1a1aa'); label.setAttribute('font-size', '10');
      label.textContent = fmt(maxTotal * f);
      svg.appendChild(label);
    });

    dates.forEach((d, i) => {
      const x = padLeft + i * slot + (slot - barW) / 2;
      let yCursor = padTop + plotH;
      const dayTotal = totals[i];
      for (const k of series) {
        const val = byDate.get(d)[k] || 0;
        if (val <= 0) continue;
        const h = (val / maxTotal) * plotH;
        yCursor -= h;
        const rect = document.createElementNS(svgNS, 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', yCursor);
        rect.setAttribute('width', barW);
        rect.setAttribute('height', Math.max(0.5, h));
        rect.setAttribute('fill', colorOf(k));
        rect.setAttribute('class', 'trend-bar');
        const title = document.createElementNS(svgNS, 'title');
        title.textContent = `${d}\n${k}: ${fmt(val)}\n\u5408\u8ba1: ${fmt(dayTotal)}`;
        rect.appendChild(title);
        if (onBarClick) rect.addEventListener('click', () => onBarClick(d));
        svg.appendChild(rect);
      }
      const step = Math.ceil(dates.length / 12);
      if (i % step === 0) {
        const label = document.createElementNS(svgNS, 'text');
        label.setAttribute('x', x + barW / 2);
        label.setAttribute('y', H - 6);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('fill', '#a1a1aa');
        label.setAttribute('font-size', '10');
        label.textContent = F.formatDate(d);
        svg.appendChild(label);
      }
    });

    container.appendChild(svg);

    // Legend
    if (legendEl) {
      for (const k of series) {
        const lg = document.createElement('div');
        lg.className = 'lg';
        lg.innerHTML = `<span class="swatch" style="background:${colorOf(k)}"></span>${F.esc(k)}`;
        legendEl.appendChild(lg);
      }
    }
  }

  window.TrendChart = { render };
})();
