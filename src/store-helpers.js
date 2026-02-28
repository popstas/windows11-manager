/** Pure helper functions for store logic. No external I/O. */

function filterWindowsToRestore(storedWins, currentWins) {
  const toOpen = [];
  const currentPaths = new Set(currentWins.map(w => w.path?.replace(/\.exe.*$/, '.exe')));
  for (const storedWin of storedWins) {
    const fullPath = storedWin.path ?? '';
    const basePath = fullPath.replace(/\.exe.*$/, '.exe') || fullPath;
    if (currentPaths.has(basePath)) continue;
    const res = fullPath.match(/\.exe (.*)$/);
    const path = fullPath.replace(/\.exe.*/, '.exe') || fullPath;
    const args = res ? res[1].trim().split(/\s+/) : [];
    toOpen.push({ ...storedWin, path, args });
  }
  return toOpen;
}

function filterPathsToRestore(storedPaths, currentWins) {
  if (!storedPaths?.length) return [];
  const currentTitles = new Set(currentWins.map(w => w.title));
  return storedPaths.filter(p => !currentTitles.has(p));
}

function matchStoredWindows(wins, matchList) {
  const list = { ...matchList };
  return wins.filter(w => {
    for (const i in list) {
      const matchPath = list[i];
      const reg = new RegExp(matchPath.replace('.', '\\.'), 'i');
      if (reg.test(w.path)) {
        delete list[i];
        return true;
      }
    }
    return false;
  });
}

export { filterWindowsToRestore, filterPathsToRestore, matchStoredWindows };
