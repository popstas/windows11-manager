import fs from 'node:fs';
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { getConfig } from './config.js';
import { getWindows } from './windows.js';
import { filterWindowsToRestore, filterPathsToRestore, matchStoredWindows, resolveMatchListPure } from './store-helpers.js';

function resolveMatchList(config) {
  try {
    const jsonPath = path.join(process.cwd(), 'data', 'store-match-list.json');
    const overrideList = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return resolveMatchListPure(overrideList, config.store.matchList);
  } catch {
    return config.store.matchList;
  }
}

export { resolveMatchList };

function storeWindows() {
  const config = getConfig();
  const wins = getWindows();
  console.error('[store] saving positions: %d windows total', wins.length);
  console.error('[store] store path: %s', config.store.path);
  const matchList = resolveMatchList(config);
  const matchedWins = matchStoredWindows(wins, matchList);
  const explorerWins = wins.filter(win => win.path.includes('explorer.exe'));
  const explorerTitles = explorerWins.map(win => win.title);
  const storedPaths = explorerTitles.filter(title => {
    const isPath = fs.existsSync(title) && fs.statSync(title).isDirectory();
    return isPath;
  });
  console.error('[store] matched windows: %d', matchedWins.length);
  console.error('[store] stored paths (explorer): %d', storedPaths.length);
  if (matchedWins.length) {
    matchedWins.forEach((w, i) => console.error('[store]   window[%d]: %s', i, w.path));
  }
  if (storedPaths.length) {
    storedPaths.forEach((p, i) => console.error('[store]   path[%d]: %s', i, p));
  }
  const store = { windows: matchedWins, paths: storedPaths };
  fs.writeFileSync(config.store.path, JSON.stringify(store));
  console.error('[store] wrote %s', config.store.path);
}

async function restoreWindows() {
  const config = getConfig();
  let store;
  try {
    store = JSON.parse(fs.readFileSync(config.store.path, 'utf8'));
  } catch { /* file may not exist */ }
  if (!store) return;
  openStore(store);
}

function openWindows(storedWins, wins) {
  const toOpen = filterWindowsToRestore(storedWins, wins);
  const restored = [];
  for (const item of toOpen) {
    if (!fs.existsSync(item.path)) continue;
    try {
      const subprocess = spawn(item.path, item.args, { detached: true, stdio: 'ignore' });
      subprocess.on('error', err => {
        console.log(`Error while opening ${item.path}`);
        console.log(err.message);
      });
      subprocess.unref();
      restored.push(item);
    } catch (e) {
      console.log(`Error while opening ${item.path}`);
      console.log(e.message);
    }
  }
  return restored;
}

function openPaths(paths, wins) {
  const toOpen = filterPathsToRestore(paths ?? [], wins);
  for (const p of toOpen) {
    exec(`start "" "${p}"`);
  }
  return toOpen;
}

function openStore(store) {
  const wins = getWindows();
  const restored = [];
  const opened = openWindows(store.windows, wins);
  restored.push(...opened);
  const paths = openPaths(store.paths, wins);
  restored.push(...paths);
}

function clearWindows() {
  const config = getConfig();
  fs.unlinkSync(config.store.path);
}

export { filterWindowsToRestore, filterPathsToRestore, matchStoredWindows, resolveMatchListPure } from './store-helpers.js';
export { storeWindows, restoreWindows, openWindows, openPaths, openStore, clearWindows };
