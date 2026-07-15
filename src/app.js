const AGENT_COLORS = {
  'codex': '#f97316',
  'claude': '#f472b6',
  'kimi-code': '#38bdf8',
  'workbuddy': '#a78bfa',
  'cursor': '#4ade80',
  'unknown': '#a1a1aa'
};

const api = {
  async scanAll() {
    const res = await fetch('/api/scan');
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
  }
};

let currentAgent = 'all';
let dailyData = [];
let summaryData = null;

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
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

async function scanAll() {
  const btn = document.getElementById('scanBtn');
  const status = document.getElementById('scanStatus');
  btn.disabled = true;
  status.textContent = '正在扫描本地日志...';
  status.className = 'scan-status';

  try {
    const results = await api.scanAll();
    const total = results.reduce((sum, r) => sum + r.inserted, 0);
    const errors = results.filter(r => r.error);

    if (errors.length > 0) {
      status.textContent = `扫描完成，新增 ${total} 条记录。${errors.length} 个 agent 出错。`;
      status.classList.add('error');
    } else {
      status.textContent = `扫描完成，新增 ${total} 条记录。`;
      status.classList.add('success');
    }

    await loadDashboard();
  } catch (err) {
    status.textContent = '扫描失败: ' + err.message;
    status.classList.add('error');
  } finally {
    btn.disabled = false;
  }
}

async function loadDashboard() {
  summaryData = await api.getSummary();
  renderSummary(summaryData);
  renderAgentTabs(summaryData.byAgent);
  renderAgentList(summaryData.byAgent);
  await loadHeatmap(currentAgent);
  await loadRecords(currentAgent);
  await loadModels(currentAgent);
}

function renderSummary(data) {
  document.getElementById('totalTokens').textContent = formatNumber(data.overall.total_tokens);
  document.getElementById('todayTokens').textContent = formatNumber(
    data.today.reduce((sum, t) => sum + t.total_tokens, 0)
  );
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
      <div class="agent-total">${formatNumber(agent.total_tokens)}</div>
    `;
    container.appendChild(item);
  }
}

async function switchAgent(agent) {
  currentAgent = agent;
  renderAgentTabs(summaryData.byAgent);
  await loadHeatmap(agent);
  await loadRecords(agent);
  await loadModels(agent);
}

async function loadHeatmap(agent) {
  dailyData = await api.getDailyUsage(agent);
  const heatmap = document.getElementById('heatmap');
  heatmap.innerHTML = '';

  if (dailyData.length === 0) {
    heatmap.innerHTML = '<div style="color: var(--text-secondary); padding: 20px;">暂无数据</div>';
    return;
  }

  // Build date map
  const usageMap = new Map();
  const values = [];
  for (const day of dailyData) {
    usageMap.set(day.date, day.total_tokens);
    values.push(day.total_tokens);
  }

  const maxValue = Math.max(...values);

  // Generate last 52 weeks
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(today);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 364);

  // Align to Sunday
  const dayOfWeek = startDate.getDay();
  startDate.setDate(startDate.getDate() - dayOfWeek);

  const weeks = [];
  let currentWeek = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    const dateStr = current.toISOString().split('T')[0];
    const total = usageMap.get(dateStr) || 0;
    currentWeek.push({ date: dateStr, total });

    if (current.getDay() === 6) {
      weeks.push(currentWeek);
      currentWeek = [];
    }

    current.setDate(current.getDate() + 1);
  }

  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  for (const week of weeks) {
    const weekEl = document.createElement('div');
    weekEl.className = 'week';

    for (const day of week) {
      const cell = document.createElement('div');
      cell.className = 'day-cell';

      let level = 0;
      if (day.total > 0) {
        const ratio = day.total / maxValue;
        if (ratio <= 0.2) level = 1;
        else if (ratio <= 0.4) level = 2;
        else if (ratio <= 0.7) level = 3;
        else level = 4;
      }

      cell.classList.add(`level-${level}`);
      cell.dataset.tooltip = `${day.date}: ${formatNumber(day.total)} tokens`;
      weekEl.appendChild(cell);
    }

    heatmap.appendChild(weekEl);
  }
}

async function loadRecords(agent) {
  const records = await api.getRecords({ agent, limit: 50 });
  const tbody = document.getElementById('recordsBody');
  tbody.innerHTML = '';

  for (const record of records) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${formatDateTime(record.timestamp)}</td>
      <td>${record.agent}</td>
      <td>${record.model || '—'}</td>
      <td>${formatNumber(record.input_tokens)}</td>
      <td>${formatNumber(record.output_tokens)}</td>
      <td>${formatNumber(record.cache_read_tokens + record.cache_creation_tokens)}</td>
      <td>${formatNumber(record.total_tokens)}</td>
    `;
    tbody.appendChild(row);
  }
}

async function loadModels(agent) {
  const models = await api.getModelUsage(agent);
  const tbody = document.getElementById('modelsBody');
  tbody.innerHTML = '';

  if (models.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="color: var(--text-secondary); text-align: center; padding: 20px;">暂无模型数据</td></tr>';
    return;
  }

  for (const item of models) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${item.agent || '—'}</td>
      <td>${item.model || '—'}</td>
      <td>${formatNumber(item.input_tokens)}</td>
      <td>${formatNumber(item.output_tokens)}</td>
      <td>${formatNumber(item.cache_read_tokens + item.cache_creation_tokens)}</td>
      <td>${formatNumber(item.total_tokens)}</td>
      <td>${formatNumber(item.records)}</td>
    `;
    tbody.appendChild(row);
  }
}

// Init
document.getElementById('scanBtn').addEventListener('click', scanAll);

loadDashboard();
