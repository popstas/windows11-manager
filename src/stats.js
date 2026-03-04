import { windowManager } from 'node-window-manager';
import { getWindows, getAppFromPath } from './windows.js';
import { getUniqueApps, filterUserApps } from './stats-helpers.js';

function getStats() {
  const wins = getWindows();
  const stats = { total: wins.length };
  const byApp = {};
  for (let win of wins) {
    const app = getAppFromPath(win.path);
    if (!byApp[app]) byApp[app] = { count: 0, wins: [] };
    byApp[app].count++;
    byApp[app].wins.push(win);
  }
  stats.byApp = byApp;
  const active = windowManager.getActiveWindow();
  if (active) {
    stats.active = {
      app: getAppFromPath(active.path),
      title: active.getTitle(),
    };
  }
  return stats;
}

function getAppsWithIcons() {
  const wins = getWindows();
  const unique = getUniqueApps(wins);
  const userApps = filterUserApps(unique);

  // Build a lookup: basename -> first window object (for icon extraction)
  const firstWindow = {};
  for (const win of wins) {
    const name = (win.path || '').split(/[/\\]/).pop().toLowerCase();
    if (name && !firstWindow[name]) firstWindow[name] = win;
  }

  return userApps.map(app => {
    let icon = '';
    try {
      const win = firstWindow[app.name];
      if (win && typeof win.getIcon === 'function') {
        const buf = win.getIcon(32);
        if (buf && buf.length) {
          icon = 'data:image/png;base64,' + buf.toString('base64');
        }
      }
    } catch (e) {
      // icon extraction can fail for some windows
    }
    return { name: app.name, icon, count: app.count };
  });
}

export { getStats, getAppsWithIcons };
