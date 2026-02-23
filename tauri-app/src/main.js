const { invoke } = window.__TAURI__.core;

const loading = document.getElementById('loading');
const error = document.getElementById('error');
const refreshBtn = document.getElementById('refresh-btn');

async function loadDashboard() {
  loading.hidden = false;
  error.hidden = true;
  document.getElementById('stats-section').hidden = true;
  document.getElementById('store-section').hidden = true;
  document.getElementById('config-section').hidden = true;
  document.getElementById('log-section').hidden = true;

  try {
    const raw = await invoke('get_dashboard_data');
    const data = JSON.parse(raw);
    loading.hidden = true;

    renderStats(data.stats);
    renderStore(data.store);
    renderConfig(data.configPath, data.configContent);
    renderLog(data.logTail);
  } catch (e) {
    loading.hidden = true;
    error.hidden = false;
    error.textContent = 'Error: ' + e;
  }
}

function renderStats(stats) {
  const section = document.getElementById('stats-section');
  const content = document.getElementById('stats-content');
  section.hidden = false;

  if (stats.error) {
    content.textContent = 'Error: ' + stats.error;
    return;
  }

  let html = `<div class="stat-row">Total windows: <strong>${stats.total || 0}</strong></div>`;

  if (stats.active) {
    html += `<div class="stat-row">Active: <strong>${stats.active.app}</strong> — ${escapeHtml(stats.active.title)}</div>`;
  }

  if (stats.byApp) {
    html += '<table class="stats-table"><thead><tr><th>App</th><th>Count</th></tr></thead><tbody>';
    for (const [app, info] of Object.entries(stats.byApp)) {
      html += `<tr><td>${escapeHtml(app)}</td><td>${info.count}</td></tr>`;
    }
    html += '</tbody></table>';
  }

  content.innerHTML = html;
}

function renderStore(store) {
  const section = document.getElementById('store-section');
  const content = document.getElementById('store-content');
  section.hidden = false;
  content.textContent = JSON.stringify(store, null, 2);
}

function renderConfig(configPath, configContent) {
  const section = document.getElementById('config-section');
  section.hidden = false;
  document.getElementById('config-path').textContent = configPath || 'Not found';
  document.getElementById('config-content').textContent = configContent || 'Empty';
}

function renderLog(logTail) {
  const section = document.getElementById('log-section');
  const content = document.getElementById('log-content');
  section.hidden = false;
  content.textContent = (logTail && logTail.length) ? logTail.join('\n') : 'No log entries';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

refreshBtn.addEventListener('click', loadDashboard);
loadDashboard();
