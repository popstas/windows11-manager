const { windowManager } = require('node-window-manager');
const { getConfig } = require('./config');
const { getMons, getSortedMonitors } = require('./monitors');
const { fancyZonesToPos, addFancyZoneHistory } = require('./fancyzones');
const { getWindows, getMatchedRules, getWindowInfo } = require('./windows');
const { virtualDesktop } = require('./virtual-desktop');
const fs = require('fs');
const { exec } = require('child_process');

function parsePos(pos, mons) {
  const config = getConfig();
  if (!pos) return false;
  if (pos.fancyZones) return fancyZonesToPos(pos.fancyZones);
  const newPos = {};
  for (let name of ['width','height','x','y']) {
    if (['x','y'].includes(name) && pos[name] === undefined) return false;
    newPos[name] = pos[name];
    const val = newPos[name];
    if (parseInt(val)) continue;
    if (!val) continue;
    const res = val.match(/^mon(\d+)\.(.*)$/);
    if (!res) continue;
    const monNum = res[1];
    const oper = res[2];
    const mon = mons[monNum];
    if (!mon) { console.log(`Monitor not found for position: ${JSON.stringify(pos)}`); return false; }
    let third = (mon.bounds.width - config.panelWidth) / 3;
    if (monNum == 2) third -= config.panelWidth;
    switch (oper) {
      case 'top': newPos.y = mon.bounds.y; break;
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
        newPos.x = parseInt(newPos.x); break;
      case 'x-3/3':
        newPos.x = mon.bounds.x + third * 2;
        if (monNum == 3) newPos.x += config.panelWidth;
        newPos.x = parseInt(newPos.x); break;
      case 'width': newPos.width = mon.bounds.width; break;
      case 'halfWidth':
        newPos.width = (mon.bounds.width - config.panelWidth) / 2;
        newPos.width = parseInt(newPos.width); break;
      case 'thirdWidth':
        newPos.width = (mon.bounds.width - config.panelWidth) / 3;
        newPos.width = parseInt(newPos.width); break;
      case 'height': newPos.height = mon.bounds.height; break;
    }
  }
  return newPos;
}

async function placeWindow({ w, rule = {} }) {
  const config = getConfig();
  if (!w) return false;
  if (config.debug) console.log(`trying to placeWindow: ${w.title}`);
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
  if (pos && !placed) {
    if (pos.width === undefined && pos.height === undefined && pos.x !== undefined && pos.y !== undefined) {
      pos.width = oldPos.width;
      pos.height = oldPos.height;
    }
    if (w.getBounds()['x'] >= 0) {
      if (config.debug) console.log(`Place ${getWindowInfo(w)} to ${JSON.stringify(pos)}\n`);
      changes.push({ name: 'bounds', value: pos });
      if (rule.fancyZones) addFancyZoneHistory({ w, rule });
    }
    w.setBounds(pos);
    w.bringToTop();
  } else if (config.debug) {
    if (!pos) console.log('no position');
    if (placed) console.log('window placed before');
  }
  if (rule.pin && !(await virtualDesktop.IsPinnedWindow(w.id))) {
    console.log(`Pin ${w.title}`);
    virtualDesktop.PinWindow(w.id);
    changes.push({ name: 'pin', value: true });
  }
  if (rule.desktop) {
    const num = rule.desktop - 1;
    try {
      const winDesktopNum = await virtualDesktop.GetWindowDesktopNumber(w.id);
      if (winDesktopNum != num) {
        console.log(`Move ${w.title} to Desktop ${rule.desktop} (id: ${w.id}, process id: ${w.processId})`);
        virtualDesktop.MoveWindowToDesktopNumber(w.id, num);
        changes.push({ name: 'desktop', value: num });
      }
    } catch (e) {
      console.log(`Failed to place ${w.title} to Desktop ${rule.desktop}`);
    }
  }
  return changes;
}

async function placeWindowsByConfig(wins = [], opts = {}) {
  const config = getConfig();
  opts = { ...{ changeDesktop: true }, ...opts };
  for (let w of wins) {
    const matchedRules = getMatchedRules(w);
    if (matchedRules.length === 0) continue;
    const mons = getMons();
    for (let rule of matchedRules) {
      rule.pos = parsePos(rule, mons);
      const changes = await placeWindow({ w, rule });
      if (opts.changeDesktop && changes.length > 0) {
        const desktopChanged = changes.find(c => c.name == 'desktop');
        if (desktopChanged) {
          console.log(`Change desktop to ${desktopChanged.value + 1}`);
          virtualDesktop.GoToDesktopNumber(desktopChanged.value);
        }
      }
    }
  }
}

async function placeWindows() {
  const t = Date.now();
  const config = getConfig();
  const mons = getMons();
  if (config.debug) {
    console.log('mons:');
    console.log(JSON.stringify(mons));
    const sortedMons = getSortedMonitors();
    console.log('sortedMons:');
    console.log(sortedMons.map(m => `name: ${m.monitor}, size: ${m['monitor-width']}x${m['monitor-height']}, offset: ${m['left-coordinate']}x${m['top-coordinate']}`).join(',\n '));
  }
  const placed = [];
  const wins = getWindows();
  for (let w of wins) {
    const matchedRules = getMatchedRules(w);
    for (let rule of matchedRules) {
      if (rule.onlyOnOpen) continue;
      rule.pos = parsePos(rule, mons);
      const changes = await placeWindow({ w, rule });
      if (changes.length > 0) placed.push(w);
    }
  }
  console.log(`after placeWindows: ${Date.now() - t}`);
  return placed;
}

function startPlaceNewWindows() {
  const updateInterval = 500;
  const delay = 1000;
  let stored;
  setInterval(async () => {
    const wins = getWindows();
    if (stored && stored.length < wins.length) {
      setTimeout(async () => {
        const wins = getWindows();
        const newWins = wins.filter(w => !stored.find(st => st.id === w.id));
        const changeDesktop = newWins.length === 1;
        await placeWindowsByConfig(newWins, { changeDesktop });
        stored = getWindows();
      }, delay);
    } else {
      stored = wins;
    }
  }, updateInterval);
}

async function placeWindowOnOpen() {
  console.log('Start new windows autoplacer');
  startPlaceNewWindows();
}

module.exports = {
  parsePos,
  placeWindow,
  placeWindowsByConfig,
  placeWindows,
  placeWindowOnOpen,
  startPlaceNewWindows,
};
