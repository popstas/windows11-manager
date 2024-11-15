const { windowManager } = require('node-window-manager');
const config = require('../config');
// const { virtualDesktop } = require('./sysapi');
const { exec, spawn, spawnSync } = require('child_process');
const fs = require('fs');

const vd11Path = config.virtualDesktopPath;

function vd11Command(args) {
  const cmd = `${vd11Path} ${args}`;

  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (stdout) {
        // console.log(stdout);
        resolve(stdout);
      }
      if (stderr) {
        console.error(`${cmd} - ${stderr}`);
        resolve(null);
      }
    });
  });
}

/**

Какие должны быть функции:
- Разместить все окна по конфигу
- Разместить массив окон по конфигу
- Найти конфиги для окна
- Найти окна для конфигов


*/

const virtualDesktop = {};

// migrate to windows 11
virtualDesktop.PinWindow = function (id) {
  return vd11Command(`PinWindowHandle:${id}`);
};

// TODO:
virtualDesktop.IsPinnedWindow = async function (id) {
  const res = await vd11Command(`IsWindowHandlePinned:${id}`);
  if (res.match(/is not pinned/)) return false;
  if (res.match(/is pinned/)) return true;
  return null;
};

// TODO:
virtualDesktop.GetWindowDesktopNumber = async function (id) {
  const res = await vd11Command(`GetDesktopFromWindowHandle:${id}`);
  let regRes = res.match(/desktop number (\d+)/);
  if (regRes) {
    return regRes[1];
  }
};

// TODO:
virtualDesktop.MoveWindowToDesktopNumber = function (id, num) {
  // console.log(`MoveWindowToDesktopNumber ${id} - ${num}`);
  return vd11Command(`gd:${num} MoveWindowHandle:${id}`);
};

// TODO:
// VirtualDesktop11.exe /gd:1MI
// VirtualDesktop11.exe /gd:Home
// VirtualDesktop11.exe /gd:Viasite
virtualDesktop.MoveActiveWindowToDesktopNumber = function (num) {
  // console.log(`MoveActiveWindowToDesktopNumber ${num}`);
  return vd11Command(`gd:${num} MoveActiveWindow`);
};

virtualDesktop.GoToDesktopNumber = function (num) {
  console.log(`switch ${num}`);
  return vd11Command(`switch:${num}`);
};

virtualDesktop.setDesktopWallpaper = function (desktop, path) {
  console.log(`setDesktopWallpaper ${num}: ${path}`);
  return vd11Command(`gd:${desktop} wp:${path}`);
};

/* function parseFancyZones() {
  const settings = require(`${config.fancyZones.path}/settings.json`);
  const zones = require(`${config.fancyZones.path}/zones-settings.json`);
  const editor = require(`${config.fancyZones.path}/editor-parameters.json`);
  console.log('settings: ', settings);
  console.log('zones: ', zones);
  console.log('editor: ', editor);
}

if (config.fancyZones.enabled) parseFancyZones(); */

















function log(msg, type = 'info') {
  const tzoffset = new Date().getTimezoneOffset() * 60000; //offset in milliseconds
  const d = new Date(Date.now() - tzoffset)
    .toISOString()
    .replace(/T/, ' ') // replace T with a space
    .replace(/\..+/, ''); // delete the dot and everything after

  console[type](`${d} ${msg}`);
  // if (isWindows && process.env.NODE_ENV == 'production') windowsLogger[type](msg);
}

function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getWindowsMonitors() {
  return windowManager.getMonitors().map((mon) => {
    mon.bounds = mon.getBounds();
    mon.name = mon.getTitle;
    return mon;
  });
}

function getMonitor(num) {
  const ind = config.monitors[num];
  const mons = getWindowsMonitors();
  const sorted = [];
  for (let num in config.monitorsSize) {
    const size = config.monitorsSize[num];
    const found = mons.find(
      (mon) => mon.bounds.width == size.width && mon.bounds.height == size.height
    );
    if (found) {
      sorted.push(found);
    }
  }

  return sorted[ind];
}

function getMons() {
  const mons = [{}];
  for (let i in config.monitorsSize) {
    mons.push(getMonitor(i));
  }
  return mons;
}
// return object key of config.monitorsSize by name
function getMonitorNumByName(name) {
  const config = getConfig();
  for (let key in config.monitorsSize) {
    if (config.monitorsSize[key].name == name) {
      return parseInt(key);
    }
  }
}

function getSortedMonitors() {
  const editor = require(`${config.fancyZones.path}/editor-parameters.json`);
  return editor.monitors.sort((a, b) => {
    // sort by name instead of size
    const aByName = getMonitorNumByName(a.monitor);
    const bByName = getMonitorNumByName(b.monitor);
    if (aByName !== undefined && bByName !== undefined) {
      return aByName - bByName;
    }

    // sort by y offset, when delta > 1000
    const yOffset = b['top-coordinate'] - a['top-coordinate'];
    if (Math.abs(yOffset) > 1000) { // TODO: вычислять или в конфиг
      if (yOffset > 0) return -1;
      if (yOffset < 0) return 1;
      return 0;
    }

    // sort by x offset
    return a['left-coordinate'] - b['left-coordinate'];
  });
}
// fancyZone
function getFancyZoneMonitor(num) {
  const sortedMons = getSortedMonitors();
  monitor = sortedMons[num - 1];
  return monitor;
}
// loads config without cache
function getConfig() {
  const configPath = '../config.js';
  delete require.cache[require.resolve(configPath)];
  const config = require(configPath);
  return config;
}

function getAppFromPath(p) {
  const parts = p.split('\\');
  return parts[parts.length - 1].toLowerCase();
}





















// Windows functions

function getWindowsByConfig(rules, mons) {
  const wins = []
  for (let rule of rules) {
    rule.pos = parsePos(rule, mons);
    const ruleWins = findWindows(rule);
    wins.push(...ruleWins);
  }
  return wins;
}

function getConfigByWindows(wins) {
}

// get config items for window
function getMatchedRules(w) {
  const rules = config.windows.filter((rule) => {
    return isWindowMatchRule(w, rule);
  });

  const single = rules.find(rule => rule.single);
  if (single) return [single];
  
  return rules;
}

function isWindowMatchRule(w, rule) {
  let isMatch = false;

  // helper
  const testField = (winField, regex) => {
    if (!regex) return false;

    const reg = new RegExp(regex, 'i');
    return reg.test(w[winField]);
  };

  // title
  if (rule.titleMatch) {
    isMatch = testField('title', rule.titleMatch);
    if (!isMatch) return false;
  }

  // path
  if (rule.pathMatch) {
    isMatch = testField('path', rule.pathMatch);
  }

  // exclude
  if (isMatch && rule.exclude) {
    if (testField('title', rule.exclude?.titleMatch)) isMatch = false;
    if (isMatch && testField('path', rule.exclude?.pathMatch)) isMatch = false;
    // if (!isMatch) log(`${w.getTitle()} excluded`);
  }

  return isMatch;
}


function getWindowInfo(w) {
  let msg = getAppFromPath(w.path);
  msg += ` (${w.getTitle()})`;
  if (config.debug) {
    msg += `\npath: ${w.path}`
    + `\nbounds: ${JSON.stringify(w.getBounds())}`
    + `\nproc: ${w.processId}\n`
  }
  return msg
}

function findWindows(rule) {
  // compatibility
  if (rule.title) {
    rule.titleMatch = rule.title;
    delete rule.title;
  }
  if (rule.path) {
    rule.pathMatch = rule.path;
    delete rule.path;
  }

  const windows = getWindows();
  if (!windows) return;
  return windows.filter((w) => isWindowMatchRule(w, rule));
}

function findWindow({ title }) {
  return findWindows({ title })[0];
}

// находит окно по параметрам
// TODO: поддержка pathMatch, exclude
function getWindow(rule) {
  if (rule.titleMatch) {
    return findWindow({ title: rule.titleMatch });
  }
  if (rule.window == 'current') {
    return windowManager.getActiveWindow();
  }
  if (parseInt(rule.window)) {
    return getWindows().find((w) => w.id == rule.window);
  }
}

// rule - element of config.windows
async function placeWindowByConfig(rule) {
  const w = getWindow(rule);
  const mons = getMons();
  rule.pos = parsePos(rule, mons);
  const isChanged = placeWindow({ w, rule });
  return w;
}

async function placeWindowsByConfig(wins = [], opts = {}) {
  opts = {
    ...{ changeDesktop: true },
    ...opts
  }
  for (let w of wins) {
    const matchedRules = getMatchedRules(w);
    if (config.debug) console.log('matchedRules: ', matchedRules);
    if (matchedRules.length === 0) continue;

    const mons = getMons();
    for (let rule of matchedRules) {
      rule.pos = parsePos(rule, mons);
      const changes = await placeWindow({ w, rule });

      // change desktop if needed
      if (opts.changeDesktop && changes.length > 0) {
        const desktopChanged = changes.find((c) => c.name == 'desktop');
        if (desktopChanged) {
          log(`Change desktop to ${desktopChanged.value + 1}`)
          virtualDesktop.GoToDesktopNumber(desktopChanged.value);
        }
      }
    }
  }
}

// autoplace
async function placeWindows() {
  const t = Date.now();
  const config = getConfig();
  // console.log('config (TODO: placeWindows): ', config);
  const mons = getMons();

  if (config.debug) {
    log(`mons:`);
    log(JSON.stringify(mons));

    const sortedMons = getSortedMonitors();
    if (config.debug) {
      log(`sortedMons:`);
      log(sortedMons.map(m => `
        name: ${m.monitor},
        size: ${m['monitor-width']}x${m['monitor-height']},
        offset: ${m['left-coordinate']}x${m['top-coordinate']}`
      ).join(',\n '));
    }
  }
  const placed = [];
  const wins = getWindowsByConfig(config.windows, mons);
  if (config.debug) log(`getWindowsByConfig: ${Date.now() - t}`)

  const tasks = [];
  for (let w of wins) {
    const matchedRules = getMatchedRules(w);
    for (let rule of matchedRules) {
      if (rule.onlyOnOpen) continue;
      rule.pos = parsePos(rule, mons);
      const task = placeWindow({ w, rule }).then(changes => {
        if (config.debug) log(`after placeWindow: ${Date.now() - t}`);
        if (changes.length > 0) {
          placed.push(w);
        }
      }).catch(e => {
        log(e, "error");
      })
      tasks.push(task);
    }
  }
  await Promise.all(tasks).catch(e => {
    log(e, "error");
  });
  if (config.debug) log(`after placeWindows: ${Date.now() - t}`)

  return placed;
}

// TODO:
function getFancyZones() {
  return [];
}

// TODO:
function getFancyZoneByPos(pos) {
  const matchedZones = getFancyZones().filter(zone => {
    const isMatch = false;
    if (isMatch) return zone;
  });
  return matchedZones ? matchedZones[0] : false;
}

// TODO:
function buildWindowRule(win) {
  const rule = {
    titleMatch: win.getTitle(),
  };

  const fz = getFancyZoneByPos({x: win.X, y: win.Y, width: win.width, height: win.height});
  if (fz) {
    rule.fancyZones = {

    }
  }
}

// TODO: cache?
// return { monitor, zoneset, zone }
// zone: { X, Y, width, height }
function getFancyZoneInfo(opts) {
  let monitor, layout, zone;

  if (!opts.monitor) {
    log('fancyZones.monitor is required');
    return false;
  }
  if (!opts.position) {
    log('fancyZones.position is required');
    return false;
  }

  monitor = getFancyZoneMonitor(opts.monitor);

  // const zones = require(`${config.fancyZones.path}/zones-settings.json`);
  const appliedLayouts = require(`${config.fancyZones.path}/applied-layouts.json`)['applied-layouts'];
  const customLayouts = require(`${config.fancyZones.path}/custom-layouts.json`)['custom-layouts'];

  // монитора может не быть, если есть, пробуем получить зону
  if (monitor !== undefined) {
    // const zoneDevice = zones.devices.find((dev) => dev['device-id'] == monitor['monitor-id']);
    const appliedLayout = appliedLayouts.find((lay) => lay.device.monitor === monitor.monitor);

    if (!appliedLayout) {
      log (`layout not found: ${opts}`);
      return false;
    }

    // check for custom zoneset
    if (appliedLayout['applied-layout'].type === 'custom') {
      layout = customLayouts.find((lay) => lay.uuid === appliedLayout['applied-layout'].uuid);
    } else {
      // zoneset = zones['templates'].find(zs => zs.type == activeZoneset.type);
      log(`fancyZonesToPos(${opts}): only custom zone sets supported, don't use layout templates!`);
    }

    if (!layout) return false;

    // zoneset + monBounds + opts.position = absolute coordinates

    // get zone
    zone = layout.info.zones[opts.position - 1];
  }

  if (!zone) {
    // try to find backup zone and place here
    const backup = config.positionsMap.find(p => {
      return p.from.monitor === opts.monitor && 
      p.from.position === opts.position;
    });
    if (backup) {
      const res = getFancyZoneInfo(backup.to);
      if (!res || !res.monitor || !res.layout || !res.zone) {
        return false;
      }
      monitor = res.monitor;
      layout = res.layout;
      zone = res.zone;
    }
  }

  return {
    monitor,
    layout,
    zone,
  }
}

function fancyZonesToPos(opts) {
  const { monitor, zone } = getFancyZoneInfo(opts);
  if (!zone) {
    log(`Zone not found: ${JSON.stringify(opts)}`);
    return;
  }

  const monBounds = {
    x: monitor['left-coordinate'],
    y: monitor['top-coordinate'],
    width: monitor.width,
    height: monitor.height,
  };

  const pos = {
    x: monBounds.x + zone.X,
    y: monBounds.y + zone.Y,
    width: zone.width,
    height: zone.height,
  };

  // log(`Parsed FancyZones position: ${JSON.stringify(opts)} -> ${JSON.stringify(pos)}`);
  return pos;
}

// предполагалось, что FancyZones начнёт понимать, что окно размещено в зоне,
// но по факту надо ещё куда-то писать
function addFancyZoneHistory({ w, rule }) {
  return; //TODO:
  const { monitor, zoneset } = getFancyZoneInfo(rule.fancyZones);

  const history = require(`${config.fancyZones.path}/app-zone-history.json`);


  // get app object
  let appHistoryIndex = history['app-zone-history'].findIndex(el => el['app-path'] == w.path)
  if (!appHistoryIndex) {
    appHistoryIndex = history['app-zone-history'].length;
    history['app-zone-history'].push({
      'app-path': w.path,
      history: [],
    });
  }
  let appHistory = history['app-zone-history'][appHistoryIndex];

  // per device last position
  const histObj = {
    "zone-index-set": [
      rule.fancyZones.position - 1
    ],
    "device-id": monitor['monitor-id'],
    "zoneset-uuid": zoneset['uuid']
  }

  // get history item object
  // history stored per device
  let historyItemIndex = appHistory.history.findIndex(el => el['device-id'] == monitor['monitor-id']);
  if (!historyItemIndex) {
    historyItemIndex = appHistory.history.length;
    appHistory.history.push(histObj);
  } else {
    appHistory.history[historyItemIndex] = histObj;
  }

  history['app-zone-history'][appHistoryIndex] = appHistory;

  fs.writeFileSync(`${config.fancyZones.path}/app-zone-history.json`, JSON.stringify(history));
  if (config.debug) log('Save FancyZone history');
}




function parsePos(pos, mons) {
  if (!pos) return false;
  if (pos.fancyZones) return fancyZonesToPos(pos.fancyZones);

  const newPos = {};
  for (let name of ['width', 'height', 'x', 'y']) {
    if (['x', 'y'].includes(name) && pos[name] === undefined) return false;
    newPos[name] = pos[name];
    const val = newPos[name];
    if (parseInt(val)) continue;
    if (!val) continue;
    const res = val.match(/^mon(\d+)\.(.*)$/);
    if (!res) continue;
    const monNum = res[1];
    const oper = res[2];

    // check monitor exists
    const mon = mons[monNum];
    if (!mon) {
      log(`Monitor not found for position: ${JSON.stringify(pos)}`);
      return false;
    }

    // 1 и 3 моники с боковыми панелями, 2-й с нижней
    let third = (mon.bounds.width - config.panelWidth) / 3;
    if (monNum == 2) third -= config.panelWidth;

    switch (oper) {
      case 'top':
        newPos.y = mon.bounds.y;
        break;
      case 'right':
        newPos.x = mon.bounds.x + mon.bounds.width - newPos.width;
        if (monNum == 1) newPos.x -= config.panelWidth;
        if (monNum == 3) newPos.x += config.panelWidth;
        break;
      case 'bottom':
        newPos.y = mon.bounds.y + mon.bounds.height - newPos.height;
        if (monNum == 2) newPos.y -= config.panelHeight;
        break;
      case 'left':
        newPos.x = mon.bounds.x;
        if (monNum == 3) newPos.x += config.panelWidth;
        break;
      case 'x-2/3':
        newPos.x = mon.bounds.x + third * 1;
        if (monNum == 3) newPos.x += config.panelWidth;
        newPos.x = parseInt(newPos.x); // если не округлять, идемпотентность сломается
        break;
      case 'x-3/3':
        newPos.x = mon.bounds.x + third * 2;
        if (monNum == 3) newPos.x += config.panelWidth;
        newPos.x = parseInt(newPos.x);
        break;
      case 'width':
        newPos.width = mon.bounds.width;
        break;
      case 'halfWidth':
        newPos.width = (mon.bounds.width - config.panelWidth) / 2;
        newPos.width = parseInt(newPos.width);
        break;
      case 'thirdWidth':
        newPos.width = (mon.bounds.width - config.panelWidth) / 3;
        newPos.width = parseInt(newPos.width);
        break;
      case 'height':
        newPos.height = mon.bounds.height;
        break;
    }
  }

  return newPos;
}


// TODO: refactor to rule as 2-nd arg
async function placeWindow({ w, rule = {} }) {
  if (!w) return false;
  if (config.debug) {
    log(`trying to placeWindow: ${w.title}`);
  }
  const pos = rule.pos;

  const oldPos = w.getBounds();
  const changes = [];

  const isPlaced = () => {
    for (let name in pos) {
      if (pos[name] === undefined) continue;
      if (oldPos[name] != pos[name]) return false;
    }
    return true;
  };

  const placed = isPlaced();
  // change position
  if (pos && !placed) {
    // save window size, but change position, when no width and height
    if (
      pos.width === undefined &&
      pos.height === undefined &&
      pos.x !== undefined &&
      pos.y !== undefined
    ) {
      pos.width = oldPos.width;
      pos.height = oldPos.height;
    }

    // no log minimized windows, but place it
    if (w.getBounds()['x'] >= 0) {
      if (config.debug) log(`Place ${getWindowInfo(w)} to ${JSON.stringify(pos)}\n`);
      changes.push({ name: 'bounds', value: pos });
      isChanged = true;

      if (rule.fancyZones) {
        addFancyZoneHistory({ w, rule });
      }
    }

    w.setBounds(pos);

    // bring window to front
    w.bringToTop();
  } else if (config.debug) {
    if (!pos) log('no position');
    if (placed) log('window placed before');
  }

  // pin
  // if (pin && !virtualDesktop.IsPinnedWindow(w.id)) {
  if (rule.pin && !(await virtualDesktop.IsPinnedWindow(w.id))) {
    log(`Pin ${w.title}`);
    // virtualDesktop.PinWindow(w.id);
    virtualDesktop.PinWindow(w.id);
    changes.push({ name: 'pin', value: true });
    isChanged = true;
  }

  // move to desktop
  if (rule.desktop) {
    const num = rule.desktop - 1;
    // const winDesktopNum = virtualDesktop.GetWindowDesktopNumber(w.id);
    try {
      const winDesktopNum = await virtualDesktop.GetWindowDesktopNumber(w.id);
      if (winDesktopNum != num) {
        log(`Move ${w.title} to Desktop ${rule.desktop} (id: ${w.id}, process id: ${w.processId})`);
        // virtualDesktop.MoveWindowToDesktopNumber(w.id, num);
  
        // заменяю на процесс, но это не подходит для окон браузера
        virtualDesktop.MoveWindowToDesktopNumber(w.id, num);
        changes.push({ name: 'desktop', value: num });
        isChanged = true;
  
        // перемещать текущее окно - могло бы сработать, но w.show() не срабатывает как надо
        // w.show();
        // w.restore();
        // await timeout(2000);
        // virtualDesktop.MoveActiveWindowToDesktopNumber(num);
      }
  
      /* w.bringToTop();
      // w.restore();
      await timeout(1000);
      exec(`C:/projects/_temp/VirtualDesktop/VirtualDesktop.exe Q gd:${desktop-1} /MOVEACTIVEWINDOW`)
      log(`Move ${w.title} to Desktop ${desktop}`); */
    }
    // doesn't work
    catch (e) {
      log(`Failed to place ${w.title} to Desktop ${rule.desktop}`, 'error');
    }
  }

  return changes;
}

// time to action = (random(0, updateInterval) + delay
function startPlaceNewWindows() {
  const updateInterval = 500; // don't set too fast, it scan all system windows!
  const delay = 1000; // after new windows detect, for show title

  let stored;
  // let timeTotal = 0;
  setInterval(async () => {
    // const start = Date.now();
    const wins = getWindows();
    // timeTotal += Date.now() - start;
    // console.log('timeTotal: ', timeTotal);

    // windows count changed
    if (stored && stored.length < wins.length) {
      setTimeout(async () => {
        // TODO: remove
        const wins = getWindows();
        const newWins = wins.filter((w) => {
          const exists = stored.find((st) => st.id === w.id);
          return !exists;
        });

        if (config.debug) {
          console.log(`New windows: ${newWins.length}\n${newWins.map(w => w.getTitle()).join('\n')}`);
        }
        const changeDesktop = newWins.length === 1;
        await placeWindowsByConfig(newWins, { changeDesktop });
        stored = getWindows();
      }, delay);
    }
    else {
      stored = wins;
    }
  }, updateInterval);
}

async function placeWindowOnOpen() {
  log('Start new windows autoplacer', 'info');

  startPlaceNewWindows();
  // startPlaceNewProcesses();
}

async function startPlaceNewProcesses() {
  const wql = await import('wql-process-monitor');
  const processMonitor = await wql.subscribe({
    сreation: true,
    deletion: false,
  });

  const excludedApps = [
    'dllhost.exe',
    'taskhostw.exe',
    'code.exe'
  ];

  const fastApps = [
    'putty.exe',
  ];

  processMonitor.on('creation', async ([process, pid, filepath]) => {
    // log(`creation: ${process}::${pid} ["${filepath}"]`);
    if (excludedApps.includes(process.toLowerCase())) return;

    const isFast = fastApps.includes(process.toLowerCase());
    const delay = isFast ? 50 : 1000;
    // if (isFast) log('Place fast window: ' + process + ', ' + pid);

    setTimeout(async () => {
      const placed = await placeProcessWindow(pid);
      if (!placed)
        setTimeout(async () => {
          log(`try to place again: ${process}`);
          await placeProcessWindow(pid);
        }, 5000);
    }, delay);
  });

  /* processMonitor.on("deletion",([process,pid]) => {
    log(`deletion: ${process}::${pid}`);
  }); */

  // if (keepalive) setInterval(() => {}, 1000 * 60 * 60);
}

// TODO: remove
async function placeProcessWindow(pid) {
  const wins = getWindows();
  const matched = wins.filter((w) => w.processId == pid);
  if (matched.length == 0) {
    // log('no matched windows');
    return true;
  }
  if (config.debug) log(`open ${JSON.stringify(matched)}`);

  for (let w of matched) {
    const matchedRules = getMatchedRules(w);
    if (matchedRules.length == 0) {
      // log('rules not found for window: ', w.title);
      return false;
    }
    // log('matchedRules: ', matchedRules);

    const mons = getMons();
    for (let rule of matchedRules) {
      rule.pos = parsePos(rule, mons);
      await placeWindow({ w, rule });
    }
    return true;
  }
}

function getWindows() {
  // TODO: to config
  const excludedTitles = [
    'Default IME',
    'Program Manager', // explorer.exe service
    'GlowWindow_', // Toggl Track service windows
    'Переключение задач', // Alt+Tab
  ];
  const excludedPaths = [
    'TextInputHost.exe',
    'LogiOverlay.exe', // logitech options
  ];
  const windows = windowManager.getWindows();
  const list = [];
  for (let window of windows) {
    if (!window.isVisible()) continue;

    // exclude by title
    let isExcluded = false;
    for (let title of excludedTitles) {
      if (window.getTitle().includes(title)) isExcluded = true;
    }
    if (isExcluded) continue;

    // exclude by path
    isExcluded = false;
    for (let path of excludedPaths) {
      if (window.path.includes(path)) isExcluded = true;
    }
    if (isExcluded) continue;

    const title = window.getTitle();
    if (title) {
      window.title = title;
      list.push(window);
    }
  }
  // log('list: ', list);
  return list;
}

// TODO: remove
async function showWindow(title) {
  const rule = config.windows.find((w) => w.titleMatch == title);
  const win = await placeWindowByConfig(rule);
  if (win) {
    // console.log('win: ', win);
    win.restore();
    win.bringToTop();
  }
}

async function focusWindow(rule) {
  const win = await getWindow(rule);
  if (win) {
    console.log('Show window: ', win.getTitle());
    win.restore();
    win.bringToTop();
    win.show();
  }
}

function storeWindows() {
  // log('Store windows:');
  const wins = getWindows();
  const matchList = {...config.store.matchList};

  const matchedWins = wins.filter((w) => {
    for (let i in matchList) {
      const matchPath = matchList[i];
      const reg = new RegExp(matchPath.replace('.', '\\.'), 'i');
      if (reg.test(w.path)) {
        delete matchList[i]; // only one window per process needed
        return true;
      }
    }
    return false;
  });

  if (config.debug) log(`Store windows: ${matchedWins.length}`);
  // console.log('matchedWins: ', matchedWins);

  // explorer windows
  const explorerWins = wins.filter((win) => win.path.includes('explorer.exe'));
  const explorerTitles = explorerWins.map((win) => win.title);
  const storedPaths = explorerTitles.filter((title) => {
    isPath = fs.existsSync(title) && fs.statSync(title).isDirectory();
    return isPath;
  });
  if (storedPaths.length > 0 && config.debug) {
    log(`Store explorer paths: ${storedPaths.length}`);
  }

  const store = {
    windows: matchedWins,
    paths: storedPaths,
  };

  fs.writeFileSync(config.store.path, JSON.stringify(store));
}

async function restoreWindows() {
  let store;
  try {
    store = JSON.parse(fs.readFileSync(config.store.path, 'utf8'));
  } catch (e) {}
  if (!store) return;
  log('Restore windows:');

  openStore(store);
}

// open app by path
function openWindows(storedWins, wins) {
  // restore windows
  const restored = [];
  for (let storedWin of storedWins) {
    if (wins.find((w) => w.path === storedWin.path)) continue; // don't open twice
    log(`Open: ${storedWin.path}`);
    restored.push(storedWin);

    let args = [];
    const res = storedWin.path.match(/\.exe (.*)$/);
    if (res) {
      storedWin.path = storedWin.path.replace(/\.exe.*/, '.exe');
      args = res[1].split(' ');
    }

    if (!fs.existsSync(storedWin.path)) {
      console.log(`${storedWin.path} not exists`);
      continue;
    }

    try {
      const subprocess = spawn(storedWin.path, args, { detached: true, stdio: 'ignore' }); // action
      subprocess.on('error', (err) => {
        log (`Error while opening ${storedWin.path}`);
        log(err.message);
      });
      subprocess.unref();
    } catch(e) {
      log (`Error while opening ${storedWin.path}`);
      log(e.message);
    }
  }
  log(`Restored ${restored.length} windows of ${storedWins.length}`);

  return restored;
}

// open explorer by directory path
function openPaths(paths, wins) {
  restoredPaths = [];
  if (paths && paths.length > 0) {
    for (let path of paths) {
      if (wins.find((w) => w.title == path)) continue;
      log(`Open explorer: ${path}`);
      restoredPaths.push(path);

      exec(`start "" "${path}"`); // action
    }
    log(`Restored ${restoredPaths.length} explorer paths of ${paths.length}`);
  }
  return restoredPaths;
}

// open windows and paths
function openStore(store) {
  const wins = getWindows();
  const restored = [];

  // restore apps
  const opened = openWindows(store.windows, wins);
  restored.push(...opened);

  // restore explorer dirs
  const paths = openPaths(store.paths, wins);
  restored.push(...paths);

  // TODO: может нужно
  /* if (restored.length > 0) {
    setTimeout(placeWindows, 10000);
  } */
}

function clearWindows() {
  fs.unlinkSync(config.store.path);
}

function getStats() {
  const wins = getWindows();
  const stats = {};

  stats.total = wins.length;

  const byApp = {};
  for (let win of wins) {
    const app = getAppFromPath(win.path);

    if (!byApp[app]) {
      byApp[app] = { count: 0, wins: [] };
    }

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


function setWallpapers() {
  console.log('config.wallpapers: ', config.wallpapers);
  if (!config.wallpapers) return;
  for (let desktop in config.wallpapers) {
    const wpPath = wpMap[desktop];
   virtualManager.setDesktopWallpaper(desktop, wpPath);
  }
}

module.exports = {
  placeWindows,
  // placeWindow,
  findWindow,
  // placeProcessWindow,
  placeWindowByConfig,
  placeWindowOnOpen,
  showWindow,
  storeWindows,
  restoreWindows,
  clearWindows,
  openStore,
  focusWindow,
  getStats,
  setWallpapers,
};
