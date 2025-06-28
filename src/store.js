const fs = require('fs');
const { spawn, exec } = require('child_process');
const { getConfig } = require('./config');
const { getWindows } = require('./windows');

function storeWindows() {
  const config = getConfig();
  const wins = getWindows();
  const matchList = { ...config.store.matchList };
  const matchedWins = wins.filter(w => {
    for (let i in matchList) {
      const matchPath = matchList[i];
      const reg = new RegExp(matchPath.replace('.', '\\.'), 'i');
      if (reg.test(w.path)) {
        delete matchList[i];
        return true;
      }
    }
    return false;
  });
  const explorerWins = wins.filter(win => win.path.includes('explorer.exe'));
  const explorerTitles = explorerWins.map(win => win.title);
  const storedPaths = explorerTitles.filter(title => {
    const isPath = fs.existsSync(title) && fs.statSync(title).isDirectory();
    return isPath;
  });
  const store = { windows: matchedWins, paths: storedPaths };
  fs.writeFileSync(config.store.path, JSON.stringify(store));
}

async function restoreWindows() {
  const config = getConfig();
  let store;
  try {
    store = JSON.parse(fs.readFileSync(config.store.path, 'utf8'));
  } catch (e) {}
  if (!store) return;
  openStore(store);
}

function openWindows(storedWins, wins) {
  const restored = [];
  for (let storedWin of storedWins) {
    if (wins.find(w => w.path === storedWin.path)) continue;
    restored.push(storedWin);
    let args = [];
    const res = storedWin.path.match(/\.exe (.*)$/);
    if (res) {
      storedWin.path = storedWin.path.replace(/\.exe.*/, '.exe');
      args = res[1].split(' ');
    }
    if (!fs.existsSync(storedWin.path)) continue;
    try {
      const subprocess = spawn(storedWin.path, args, { detached: true, stdio: 'ignore' });
      subprocess.on('error', err => {
        console.log(`Error while opening ${storedWin.path}`);
        console.log(err.message);
      });
      subprocess.unref();
    } catch (e) {
      console.log(`Error while opening ${storedWin.path}`);
      console.log(e.message);
    }
  }
  return restored;
}

function openPaths(paths, wins) {
  const restoredPaths = [];
  if (paths && paths.length > 0) {
    for (let path of paths) {
      if (wins.find(w => w.title == path)) continue;
      restoredPaths.push(path);
      exec(`start "" "${path}"`);
    }
  }
  return restoredPaths;
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

module.exports = { storeWindows, restoreWindows, openWindows, openPaths, openStore, clearWindows };
