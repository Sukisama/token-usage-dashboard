const AGENT_COLORS = {
  'codex': '#f97316',
  'claude': '#f472b6',
  'kimi-code': '#38bdf8',
  'workbuddy': '#a78bfa',
  'cursor': '#4ade80',
  'unknown': '#a1a1aa'
};

// Categorical palette for the per-model trend (assigned biggest-model-first).
const MODEL_PALETTE = ['#f97316', '#f472b6', '#38bdf8', '#a78bfa', '#4ade80',
  '#fbbf24', '#2dd4bf', '#fb7185', '#818cf8', '#a3e635', '#22d3ee', '#e879f9'];
let modelColorMap = new Map();
function buildModelColors(rows) {
  const totals = new Map();
  for (const r of rows) totals.set(r.model, (totals.get(r.model) || 0) + r.total_tokens);
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  modelColorMap = new Map();
  sorted.forEach(([m], i) => modelColorMap.set(m, MODEL_PALETTE[i % MODEL_PALETTE.length]));
}
function modelColor(m) { return modelColorMap.get(m) || AGENT_COLORS.unknown; }

const api = {
  async scanAll() {
    const res = await fetch('/api/scan');
    return res.json();
  },
  async rebuild() {
    const res = await fetch('/api/rebuild', { method: 'POST' });
    return res.json();
  },
  async getSummary() {
    const res = await fetch('/api/summary');
    return res.json();
  },
  async getDailyUsage(agent) {
    const res = await fetch(`/api/daily?agent=${encodeURIComponent(agent)}`);
    return res.json();
  },
  async getDailyByAgent(agent = 'all') {
    const res = await fetch(`/api/daily-agents?agent=${encodeURIComponent(agent)}`);
    return res.json();
  },
  async getDailyByModel(agent = 'all') {
    const res = await fetch(`/api/daily-models?agent=${encodeURIComponent(agent)}`);
    return res.json();
  },
  async getAgents() {
    const res = await fetch('/api/agents');
    return res.json();
  },
  async getRecords(options) {
    const params = new URLSearchParams(options);
    const res = await fetch(`/api/records?${params}`);
    return res.json();
  },
  async getModelUsage(agent) {
    const res = await fetch(`/api/models?agent=${encodeURIComponent(agent)}`);
    return res.json();
  },
  async importData(base64) {
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64 })
    });
    return res.json();
  }
};

let currentAgent = 'all';
let dailyData = [];
let dailyByAgent = [];
let dailyByModel = [];
let summaryData = null;
let trendRange = 30;           // days; 0 = all
let trendDim = 'agent';        // 'agent' | 'model'
let recordsDate = null;        // drill-down filter (YYYY-MM-DD) or null
let recordsOffset = 0;
const RECORDS_PAGE = 50;

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// Escape values interpolated into innerHTML — model names like "<synthetic>"
// would otherwise be parsed as HTML tags and vanish.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCost(usd) {
  if (usd == null) return '—';
  if (usd === 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  if (usd < 100) return '$' + usd.toFixed(2);
  return '$' + usd.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function setStatus(text, kind) {
  const status = document.getElementById('scanStatus');
  status.textContent = text;
  status.className = 'scan-status' + (kind ? ' ' + kind : '');
}

async function scanAll() {
  const btn = document.getElementById('scanBtn');
  btn.disabled = true;
  setStatus('正在扫描本地日志...');

  try {
    const results = await api.scanAll();
    reportScan(results);
    await loadDashboard();
  } catch (err) {
    setStatus('扫描失败: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function rebuild() {
  if (!confirm('重建会清空当前统计并从本地日志重新计算（原始日志不受影响）。继续？')) return;
  const btn = document.getElementById('rebuildBtn');
  btn.disabled = true;
  setStatus('正在重建（清空后全量重扫）...');
  try {
    const results = await api.rebuild();
    reportScan(results, '重建完成');
    await loadDashboard();
  } catch (err) {
    setStatus('重建失败: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function reportScan(results, prefix = '扫描完成') {
  const total = results.reduce((sum, r) => sum + (r.inserted || 0), 0);
  const errors = results.filter(r => r.error);
  if (errors.length > 0) {
    setStatus(`${prefix}，新增 ${total} 条记录。${errors.length} 个 agent 出错：${errors.map(e => e.agent).join(', ')}`, 'error');
  } else {
    setStatus(`${prefix}，新增 ${total} 条记录。`, 'success');
  }
}

async function loadDashboard() {
  summaryData = await api.getSummary();
  renderSummary(summaryData);
  renderAgentTabs(summaryData.byAgent);
  renderAgentList(summaryData.byAgent);
  await loadTrend(currentAgent);
  await loadHeatmap(currentAgent);
  resetRecords();
  await loadModels(currentAgent);
}

// Trend data follows the global agent filter (the top tabs).
async function loadTrend(agent) {
  dailyByAgent = await api.getDailyByAgent(agent);
  dailyByModel = await api.getDailyByModel(agent);
  buildModelColors(dailyByModel);
  renderTrend();
}

function renderSummary(data) {
  document.getElementById('totalTokens').textContent = formatNumber(data.overall.total_tokens);
  document.getElementById('totalCost').textContent = formatCost(data.overall.cost);
  document.getElementById('todayTokens').textContent = formatNumber(
    data.today.reduce((sum, t) => sum + t.total_tokens, 0)
  );
  document.getElementById('todayCost').textContent = formatCost(data.todayCost);
  document.getElementById('activeAgents').textContent = data.byAgent.length;
  document.getElementById('trackedDays').textContent = data.overall.days;
}

function renderAgentTabs(agents) {
  const container = document.getElementById('agentTabs');
  container.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = 'tab' + (currentAgent === 'all' ? ' active' : '');
  allBtn.textContent = '全部';
  allBtn.dataset.agent = 'all';
  allBtn.addEventListener('click', () => switchAgent('all'));
  container.appendChild(allBtn);

  for (const agent of agents) {
    const btn = document.createElement('button');
    btn.className = 'tab' + (currentAgent === agent.agent ? ' active' : '');
    btn.textContent = agent.agent;
    btn.dataset.agent = agent.agent;
    btn.addEventListener('click', () => switchAgent(agent.agent));
    container.appendChild(btn);
  }
}

function renderAgentList(agents) {
  const container = document.getElementById('agentList');
  container.innerHTML = '';

  for (const agent of agents) {
    const item = document.createElement('div');
    item.className = 'agent-item';
    item.innerHTML = `
      <div class="agent-info">
        <div class="agent-color" style="background: ${AGENT_COLORS[agent.agent] || AGENT_COLORS.unknown}"></div>
        <div>
          <div class="agent-name">${agent.agent}</div>
          <div class="agent-meta">${agent.records} 条记录 · 最近 ${agent.last_used || '—'}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div class="agent-total">${formatNumber(agent.total_tokens)}</div>
        <div class="agent-meta">${formatCost(agent.cost)}</div>
      </div>
    `;
    container.appendChild(item);
  }
}

async function switchAgent(agent) {
  currentAgent = agent;
  renderAgentTabs(summaryData.byAgent);
  await loadTrend(agent);
  await loadHeatmap(agent);
  resetRecords();
  await loadModels(agent);
}

// ---- Trend chart (dependency-free SVG stacked bars) ------------------------

function renderTrend() {
  const container = document.getElementById('trendChart');
  const legendEl = document.getElementById('trendLegend');
  container.innerHTML = '';
  legendEl.innerHTML = '';

  // Dimension: stack by agent or by model.
  const rows = trendDim === 'model' ? dailyByModel : dailyByAgent;
  const keyName = trendDim === 'model' ? 'model' : 'agent';
  const colorFor = trendDim === 'model'
    ? modelColor
    : (a => AGENT_COLORS[a] || AGENT_COLORS.unknown);

  if (!rows.length) {
    container.innerHTML = '<div style="color: var(--text-secondary); padding: 20px;">暂无数据</div>';
    return;
  }

  // Build date -> {series: tokens} map limited to the selected range.
  const allDates = [...new Set(rows.map(r => r.date))].sort();
  let dates = allDates;
  if (trendRange > 0) {
    dates = allDates.slice(-trendRange);
  }
  const dateSet = new Set(dates);

  const seriesTotals = new Map();
  const byDate = new Map(dates.map(d => [d, {}]));
  for (const row of rows) {
    if (!dateSet.has(row.date)) continue;
    const k = row[keyName];
    byDate.get(row.date)[k] = (byDate.get(row.date)[k] || 0) + row.total_tokens;
    seriesTotals.set(k, (seriesTotals.get(k) || 0) + row.total_tokens);
  }
  // Order series by total desc; fold the long tail into "其他" to keep it legible.
  let series = [...seriesTotals.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const MAX_SERIES = 12;
  if (series.length > MAX_SERIES) {
    const tail = new Set(series.slice(MAX_SERIES - 1));
    for (const d of dates) {
      const obj = byDate.get(d);
      let sum = 0;
      for (const k of Object.keys(obj)) if (tail.has(k)) { sum += obj[k]; delete obj[k]; }
      if (sum > 0) obj['其他'] = (obj['其他'] || 0) + sum;
    }
    series = [...series.slice(0, MAX_SERIES - 1), '其他'];
  }
  const colorOf = k => (k === '其他' ? AGENT_COLORS.unknown : colorFor(k));

  const totals = dates.map(d => series.reduce((s, k) => s + (byDate.get(d)[k] || 0), 0));
  const maxTotal = Math.max(1, ...totals);

  // Geometry — fill the full container width (no dead space on the right).
  const H = 200;
  const padTop = 10, padBottom = 22, padLeft = 48, padRight = 10;
  const availW = Math.max(320, container.clientWidth || 900);
  const slot = (availW - padLeft - padRight) / dates.length;
  const barGap = Math.min(6, Math.max(1, slot * 0.18));
  const barW = Math.max(2, slot - barGap);
  const chartW = availW;
  const chartH = H;
  const plotH = H - padTop - padBottom;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', chartW);
  svg.setAttribute('height', chartH);
  svg.setAttribute('viewBox', `0 0 ${chartW} ${chartH}`);

  // Y gridlines + labels (0, mid, max)
  [0, 0.5, 1].forEach(f => {
    const y = padTop + plotH * (1 - f);
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', padLeft); line.setAttribute('x2', chartW - 10);
    line.setAttribute('y1', y); line.setAttribute('y2', y);
    line.setAttribute('stroke', '#3f3f46'); line.setAttribute('stroke-width', '1');
    svg.appendChild(line);
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', padLeft - 6); label.setAttribute('y', y + 3);
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('fill', '#a1a1aa'); label.setAttribute('font-size', '10');
    label.textContent = formatNumber(Math.round(maxTotal * f));
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
      title.textContent = `${d}\n${k}: ${formatNumber(val)}\n合计: ${formatNumber(dayTotal)}`;
      rect.appendChild(title);
      rect.addEventListener('click', () => filterRecordsByDate(d));
      svg.appendChild(rect);
    }
    // X label every ~Nth bar to avoid clutter
    const step = Math.ceil(dates.length / 12);
    if (i % step === 0) {
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', x + barW / 2);
      label.setAttribute('y', chartH - 6);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', '#a1a1aa');
      label.setAttribute('font-size', '10');
      label.textContent = formatDate(d);
      svg.appendChild(label);
    }
  });

  container.appendChild(svg);

  // Legend
  for (const k of series) {
    const lg = document.createElement('div');
    lg.className = 'lg';
    lg.innerHTML = `<span class="swatch" style="background:${colorOf(k)}"></span>${esc(k)}`;
    legendEl.appendChild(lg);
  }
}

function switchDim(dim) {
  trendDim = dim;
  document.querySelectorAll('#dimTabs .range-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.dim === dim));
  renderTrend();
}

function switchRange(range) {
  trendRange = range;
  document.querySelectorAll('.range-tab').forEach(t => {
    t.classList.toggle('active', Number(t.dataset.range) === range);
  });
  renderTrend();
}

// ---- Heatmap ---------------------------------------------------------------

let _hmTooltip = null;
function showHeatmapTooltip(cell, text) {
  if (!_hmTooltip) {
    _hmTooltip = document.createElement('div');
    _hmTooltip.className = 'hm-tooltip';
    document.body.appendChild(_hmTooltip);
  }
  _hmTooltip.textContent = text;
  const r = cell.getBoundingClientRect();
  // Prefer above the cell; flip below if it would go off the top of the viewport.
  const above = r.top > 40;
  _hmTooltip.style.left = `${r.left + r.width / 2}px`;
  _hmTooltip.style.top = above ? `${r.top - 6}px` : `${r.bottom + 6}px`;
  _hmTooltip.style.transform = above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)';
  _hmTooltip.classList.add('show');
}
function hideHeatmapTooltip() {
  if (_hmTooltip) _hmTooltip.classList.remove('show');
}

async function loadHeatmap(agent) {
  dailyData = await api.getDailyUsage(agent);
  renderHeatmap();
}

function renderHeatmap() {
  const heatmap = document.getElementById('heatmap');
  heatmap.innerHTML = '';

  if (!dailyData || dailyData.length === 0) {
    heatmap.innerHTML = '<div style="color: var(--text-secondary); padding: 20px;">暂无数据</div>';
    return;
  }

  const usageMap = new Map();
  const values = [];
  for (const day of dailyData) {
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

  // Size cells to fill the card width (no dead space on the right).
  const gap = 4;
  const wrapW = (document.querySelector('.heatmap-wrapper')?.clientWidth) || 900;
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
      const tip = `${day.date}: ${formatNumber(day.total)} tokens`;
      cell.addEventListener('mouseenter', () => showHeatmapTooltip(cell, tip));
      cell.addEventListener('mouseleave', hideHeatmapTooltip);
      if (day.total > 0) {
        cell.addEventListener('click', () => filterRecordsByDate(day.date));
      }
      weekEl.appendChild(cell);
    }
    heatmap.appendChild(weekEl);
  }
}

// ---- Records (with drill-down + pagination) --------------------------------

function resetRecords() {
  recordsOffset = 0;
  document.getElementById('recordsBody').innerHTML = '';
  updateRecordsFilterUI();
  loadRecords(true);
}

function filterRecordsByDate(date) {
  recordsDate = date;
  recordsOffset = 0;
  document.getElementById('recordsBody').innerHTML = '';
  updateRecordsFilterUI();
  loadRecords(true);
  document.querySelector('.records-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearRecordsFilter() {
  recordsDate = null;
  resetRecords();
}

function updateRecordsFilterUI() {
  const wrap = document.getElementById('recordsFilter');
  const label = document.getElementById('recordsFilterLabel');
  if (recordsDate) {
    wrap.hidden = false;
    label.textContent = `筛选：${recordsDate}`;
  } else {
    wrap.hidden = true;
  }
}

async function loadRecords(reset = false) {
  const opts = { agent: currentAgent, limit: RECORDS_PAGE, offset: recordsOffset };
  if (recordsDate) opts.date = recordsDate;
  const records = await api.getRecords(opts);
  const tbody = document.getElementById('recordsBody');
  if (reset) tbody.innerHTML = '';

  for (const record of records) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${formatDateTime(record.timestamp)}</td>
      <td>${esc(record.agent)}</td>
      <td>${esc(record.model) || '—'}</td>
      <td>${record.requests > 1 ? '×' + record.requests : '1'}</td>
      <td>${formatNumber(record.input_tokens)}</td>
      <td>${formatNumber(record.output_tokens)}</td>
      <td>${formatNumber(record.cache_read_tokens + record.cache_creation_tokens)}</td>
      <td>${formatNumber(record.total_tokens)}</td>
      <td class="cost-cell">${formatCost(record.cost)}</td>
    `;
    tbody.appendChild(row);
  }

  recordsOffset += records.length;
  const loadMore = document.getElementById('loadMoreBtn');
  loadMore.hidden = records.length < RECORDS_PAGE;

  if (tbody.children.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="color: var(--text-secondary); text-align: center; padding: 20px;">暂无记录</td></tr>';
  }
}

async function loadModels(agent) {
  const models = await api.getModelUsage(agent);
  const tbody = document.getElementById('modelsBody');
  tbody.innerHTML = '';

  if (models.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="color: var(--text-secondary); text-align: center; padding: 20px;">暂无模型数据</td></tr>';
    return;
  }

  for (const item of models) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${esc(item.agent) || '—'}</td>
      <td>${esc(item.model) || '—'}</td>
      <td>${formatNumber(item.input_tokens)}</td>
      <td>${formatNumber(item.output_tokens)}</td>
      <td>${formatNumber(item.cache_read_tokens + item.cache_creation_tokens)}</td>
      <td>${formatNumber(item.total_tokens)}</td>
      <td>${formatNumber(item.records)}</td>
      <td class="cost-cell">${formatCost(item.cost)}</td>
    `;
    tbody.appendChild(row);
  }
}

async function exportData() {
  const res = await fetch('/api/export');
  if (!res.ok) {
    setStatus('导出失败', 'error');
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `token-usage-dashboard-${new Date().toISOString().split('T')[0]}.db`;
  a.click();
  URL.revokeObjectURL(url);
}

// Chunked base64 encode — spreading a large Uint8Array into fromCharCode
// overflows the call stack for multi-MB DB files.
function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  setStatus('正在导入...');

  try {
    const arrayBuffer = await file.arrayBuffer();
    const base64 = bytesToBase64(new Uint8Array(arrayBuffer));
    const result = await api.importData(base64);
    if (result.error) throw new Error(result.error);
    setStatus(`导入完成，合并 ${result.inserted} 条记录。`, 'success');
    await loadDashboard();
  } catch (err) {
    setStatus('导入失败: ' + err.message, 'error');
  }

  event.target.value = '';
}

// Init
document.getElementById('scanBtn').addEventListener('click', scanAll);
document.getElementById('rebuildBtn').addEventListener('click', rebuild);
document.getElementById('exportBtn').addEventListener('click', exportData);
document.getElementById('importInput').addEventListener('change', importData);
document.getElementById('loadMoreBtn').addEventListener('click', () => loadRecords(false));
document.getElementById('clearFilterBtn').addEventListener('click', clearRecordsFilter);
document.querySelectorAll('#rangeTabs .range-tab').forEach(tab => {
  tab.addEventListener('click', () => switchRange(Number(tab.dataset.range)));
});
document.querySelectorAll('#dimTabs .range-tab').forEach(tab => {
  tab.addEventListener('click', () => switchDim(tab.dataset.dim));
});

let _resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => { renderTrend(); renderHeatmap(); }, 150);
});

loadDashboard();
