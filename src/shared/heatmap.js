/**
 * heatmap.js — Reusable GitHub-style heatmap (global: window.Heatmap)
 *
 * Usage:
 *   Heatmap.render(container, {
 *     data: [{date, total_tokens}],
 *     onCellClick: (date) => {}
 *   });
 */
(function () {
  'use strict';

  const F = window.F;
  let _tooltip = null;

  function showTip(cell, text) {
    if (!_tooltip) {
      _tooltip = document.createElement('div');
      _tooltip.className = 'hm-tooltip';
      document.body.appendChild(_tooltip);
    }
    _tooltip.textContent = text;
    const r = cell.getBoundingClientRect();
    const above = r.top > 40;
    _tooltip.style.left = `${r.left + r.width / 2}px`;
    _tooltip.style.top = above ? `${r.top - 6}px` : `${r.bottom + 6}px`;
    _tooltip.style.transform = above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)';
    _tooltip.classList.add('show');
  }

  function hideTip() {
    if (_tooltip) _tooltip.classList.remove('show');
  }

  function render(container, opts) {
    const { data = [], onCellClick } = opts;
    container.innerHTML = '';

    if (!data.length) {
      container.innerHTML = '<div class="empty-state">暂无数据</div>';
      return;
    }

    const usageMap = new Map();
    const values = [];
    for (const day of data) {
      usageMap.set(day.date, day.total_tokens);
      values.push(day.total_tokens);
    }
    const maxValue = Math.max(...values);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + (6 - today.getDay()));
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - (52 * 7 - 1));
    startDate.setDate(startDate.getDate() - startDate.getDay());

    const weeks = [];
    let currentWeek = [];
    const current = new Date(startDate);
    const localStr = d => {
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };

    while (current <= endDate) {
      const dateStr = localStr(current);
      const total = usageMap.get(dateStr) || 0;
      currentWeek.push({ date: dateStr, total });
      if (current.getDay() === 6) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
      current.setDate(current.getDate() + 1);
    }

    const gap = 4;
    const wrapW = container.parentElement?.clientWidth || 900;
    const cellSize = Math.max(11, Math.min(22,
      Math.floor((wrapW - (weeks.length - 1) * gap) / weeks.length)));

    for (const week of weeks) {
      const weekEl = document.createElement('div');
      weekEl.className = 'week';
      for (const day of week) {
        const cell = document.createElement('div');
        cell.className = 'day-cell';
        cell.style.width = cell.style.height = `${cellSize}px`;
        let level = 0;
        if (day.total > 0) {
          const ratio = day.total / maxValue;
          if (ratio <= 0.2) level = 1;
          else if (ratio <= 0.4) level = 2;
          else if (ratio <= 0.7) level = 3;
          else level = 4;
        }
        cell.classList.add(`level-${level}`);
        const tip = `${day.date}: ${F.formatNumber(day.total)} tokens`;
        cell.addEventListener('mouseenter', () => showTip(cell, tip));
        cell.addEventListener('mouseleave', hideTip);
        if (day.total > 0 && onCellClick) {
          cell.addEventListener('click', () => onCellClick(day.date));
        }
        weekEl.appendChild(cell);
      }
      container.appendChild(weekEl);
    }
  }

  window.Heatmap = { render };
})();
