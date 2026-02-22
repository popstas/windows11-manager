import { windowManager } from 'node-window-manager';
import { getWindows, getAppFromPath } from './windows.js';

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

export { getStats };
