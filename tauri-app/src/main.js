const { invoke } = window.__TAURI__.core;

const loading = document.getElementById('loading');
const error = document.getElementById('error');
const refreshBtn = document.getElementById('refresh-btn');

async function loadDashboard() {
  loading.hidden = false;
  error.hidden = true;
  document.getElementById('apps-section').hidden = true;
  document.getElementById('stats-section').hidden = true;
  document.getElementById('store-section').hidden = true;
  document.getElementById('config-section').hidden = true;
  document.getElementById('log-section').hidden = true;

  try {
    const raw = await Promise.race([
      invoke('get_dashboard_data'),
      new Promise((_, reject) => setTimeout(() => reject('Request timed out'), 15000)),
    ]);
    const data = JSON.parse(raw);
    loading.hidden = true;

    renderApps(data.apps);
    renderStats(data.stats, data.matchList);
    renderStore(data.store);
    renderConfig(data.configPath, data.configContent);
    renderLog(data.logTail);
  } catch (e) {
    loading.hidden = true;
    error.hidden = false;
    error.textContent = 'Error: ' + e;
  }
}

function renderApps(apps) {
  const section = document.getElementById('apps-section');
  const content = document.getElementById('apps-content');
  if (!apps || !apps.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  let html = '<div class="apps-grid">';
  for (const app of apps) {
    const iconHtml = app.icon
      ? `<img class="app-icon" src="${app.icon}" alt="">`
      : '<div class="app-icon app-icon-placeholder"></div>';
    html += `<div class="app-card">${iconHtml}<span class="app-name">${escapeHtml(app.name)}</span><span class="app-count">${app.count}</span></div>`;
  }
  html += '</div>';
  content.innerHTML = html;
}

function renderStats(stats, matchList) {
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

  const matchSet = new Set(matchList || []);
  const runningApps = stats.byApp ? Object.keys(stats.byApp) : [];
  const allApps = [...new Set([...matchSet, ...runningApps])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  if (allApps.length) {
    html += '<table class="stats-table"><thead><tr><th>Autorun</th><th>App</th><th>Count</th></tr></thead><tbody>';
    for (const app of allApps) {
      const isInMatchList = matchSet.has(app);
      const isRunning = stats.byApp && stats.byApp[app];
      const count = isRunning ? stats.byApp[app].count : '';
      const displayName = app.replace(/\.exe$/i, '');
      const nameClass = isRunning ? ' class="app-running"' : '';
      html += `<tr><td><input type="checkbox" class="autorun-checkbox" data-app="${escapeHtml(app)}"${isInMatchList ? ' checked' : ''}></td><td${nameClass}>${escapeHtml(displayName)}</td><td>${count}</td></tr>`;
    }
    html += '</tbody></table>';
  }

  content.innerHTML = html;

  content.querySelectorAll('.autorun-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = [...content.querySelectorAll('.autorun-checkbox:checked')].map(el => el.dataset.app);
      invoke('save_store_match_list', { list: checked });
    });
  });
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
