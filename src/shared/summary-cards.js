/**
 * summary-cards.js — Reusable metric cards (global: window.SummaryCards)
 *
 * Usage:
 *   SummaryCards.render(container, [
 *     { label: '累计 Token', value: '14.2B', sub: '其中缓存读取 3.1B' },
 *     { label: '今日花费', value: '$1.23', cost: true },
 *     { label: '月预算', value: '$14', accent: true, progress: 0.72, progressLabel: '72%' },
 *     { label: '超支预警', value: '$52', warn: true },
 *   ]);
 */
(function () {
  'use strict';

  function render(container, cards) {
    container.innerHTML = '';
    container.className = 'summary-grid';

    for (const c of cards) {
      const el = document.createElement('div');
      let cls = 'summary-card';
      if (c.cost) cls += ' cost';
      if (c.accent) cls += ' accent';
      if (c.warn) cls += ' warn';
      el.className = cls;
      let inner = `
        <div class="summary-label">${c.label}</div>
        <div class="summary-value">${c.value}</div>
      `;
      if (c.progress != null) {
        const pct = Math.min(100, Math.max(0, c.progress * 100));
        let barCls = 'summary-progress-bar';
        if (c.progress >= 1) barCls += ' over';
        else if (c.progress >= 0.8) barCls += ' warn';
        inner += `<div class="${barCls}"><div class="summary-progress-fill" style="width:${pct}%"></div></div>`;
      }
      if (c.sub) {
        inner += `<div class="summary-sub">${c.sub}</div>`;
      }
      el.innerHTML = inner;
      container.appendChild(el);
    }
  }

  window.SummaryCards = { render };
})();
