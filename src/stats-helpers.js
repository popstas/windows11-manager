const SYSTEM_PATH_PREFIXES = [
  'C:\\Windows\\',
  'C:\\Windows\\System32\\',
  'C:\\Windows\\SystemApps\\',
];

const SYSTEM_EXES = new Set([
  'shellexperiencehost.exe',
  'searchhost.exe',
  'startmenuexperiencehost.exe',
  'applicationframehost.exe',
  'systemsettings.exe',
  'lockapp.exe',
  'runtimebroker.exe',
  'dllhost.exe',
  'svchost.exe',
  'csrss.exe',
  'dwm.exe',
  'explorer.exe',
  'ctfmon.exe',
  'taskhostw.exe',
  'sihost.exe',
  'fontdrvhost.exe',
  'securityhealthsystray.exe',
  'phoneexperiencehost.exe',
  'widgetservice.exe',
  'widgets.exe',
]);

function winBasename(p) {
  return (p || '').split(/[/\\]/).pop();
}

function isSystemApp(appPath) {
  if (!appPath) return false;
  const normalized = appPath.replace(/\//g, '\\');
  const upper = normalized.toUpperCase();
  for (const prefix of SYSTEM_PATH_PREFIXES) {
    if (upper.startsWith(prefix.toUpperCase())) return true;
  }
  const basename = winBasename(normalized).toLowerCase();
  return SYSTEM_EXES.has(basename);
}

function getUniqueApps(windows) {
  const map = {};
  for (const win of windows) {
    const name = winBasename(win.path || '').toLowerCase();
    if (!name) continue;
    if (!map[name]) {
      map[name] = { name, path: win.path, count: 0 };
    }
    map[name].count++;
  }
  return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
}

function filterUserApps(apps) {
  return apps.filter(app => !isSystemApp(app.path));
}

export { isSystemApp, getUniqueApps, filterUserApps };
