const { windowManager } = require('node-window-manager');
const { getConfig } = require('./config');
const { getMons, getSortedMonitors, getMonitorByPoint } = require('./monitors');
const { fancyZonesToPos, addFancyZoneHistory } = require('./fancyzones');
const { getWindows, getMatchedRules, getWindowInfo, getWindow } = require('./windows');
const { virtualDesktop } = require('./virtual-desktop');
const { adjustBoundsForScale } = require('./scale');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

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

function isBoundsMatch(oldPos, newPos) {
  for (let name in newPos) {
    if (newPos[name] === undefined) continue;
    const isExactlyPlaced = oldPos[name] == newPos[name];
    const isPixelPlaced = Math.abs(oldPos[name] - newPos[name]) < 2;
    if (!isExactlyPlaced && !isPixelPlaced) return false;
  }
  return true;
}

async function placeWindow({ w, rule = {}, isBulk = false }) {
  const minWidth = 250;
  const config = getConfig();
  if (!w) return false;
  const baseName = path.basename(w.path);
  const winName = w.title || baseName;
  if (config.debug) console.log(`trying to placeWindow: ${winName}`);
  const pos = rule.pos;
  const oldPos = w.getBounds();
  const changes = [];

  if (oldPos.width < minWidth) {
    console.log(`Window ${winName} is too small, skipping`);
    return false;
  }

  let applyPos = { ...pos };
  if (applyPos.width === undefined && applyPos.height === undefined && applyPos.x !== undefined && applyPos.y !== undefined) {
    applyPos.width = oldPos.width;
    applyPos.height = oldPos.height;
  }

  const widthSpecified = rule.width !== undefined || rule.pos?.width !== undefined;
  const heightSpecified = rule.height !== undefined || rule.pos?.height !== undefined;

  const oldScale = w.getMonitor().getScaleFactor();
  const targetMon = getMonitorByPoint(applyPos) || w.getMonitor();
  const newScaleCheck = targetMon.getScaleFactor();
  const finalBounds = adjustBoundsForScale({ bounds: applyPos, oldScale, newScale: newScaleCheck, widthSpecified, heightSpecified });

  const isPlaced = () => isBoundsMatch(oldPos, finalBounds);
  const placed = isPlaced();
  if (pos && !placed) {
    if (w.getBounds()['x'] >= 0) {
      if (config.debug) console.log(`Place ${getWindowInfo(w)} to ${JSON.stringify(applyPos)}\n`);
      changes.push({ name: 'bounds', oldPos, value: applyPos });
      if (rule.fancyZones) addFancyZoneHistory({ w, rule });
    }
    w.setBounds(finalBounds);
    const newScale = w.getMonitor().getScaleFactor();
    if (oldScale !== newScale) {
      const adjusted = adjustBoundsForScale({ bounds: applyPos, oldScale, newScale, widthSpecified, heightSpecified });
      w.setBounds(adjusted);
    }
    const afterPlaceBounds = w.getBounds();
    if (!isBoundsMatch(finalBounds, afterPlaceBounds))
    {
      console.error(`Window ${winName} not placed correctly, try again: ${JSON.stringify(afterPlaceBounds)} != ${JSON.stringify(finalBounds)}`);
      w.setBounds(finalBounds);
    }
    if (!isBulk) w.bringToTop();
  } else if (config.debug) {
    // if (!pos) console.log('no position');
    if (placed) console.log('window placed before');
  }
  if (rule.pin && !(await virtualDesktop.IsPinnedWindow(w.id))) {
    console.log(`Pin ${winName}`);
    virtualDesktop.PinWindow(w.id);
    changes.push({ name: 'pin', value: true });
  }
  if (rule.desktop) {
    const num = rule.desktop - 1;
    try {
      const winDesktopNum = await virtualDesktop.GetWindowDesktopNumber(w.id);
      if (winDesktopNum != num) {
        console.log(`Move ${winName} to Desktop ${rule.desktop} (id: ${w.id}, process id: ${w.processId})`);
        virtualDesktop.MoveWindowToDesktopNumber(w.id, num);
        changes.push({ name: 'desktop', value: num });
      }
    } catch (e) {
      console.log(`Failed to place ${winName} to Desktop ${rule.desktop}`);
    }
  }
  return changes;
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
  const isBulk = true;
  if (config.debug) {
    console.log('mons:');
    console.log(JSON.stringify(mons));
    const sortedMons = getSortedMonitors();
    console.log('sortedMons:');
    console.log(sortedMons.map(m => `name: ${m.monitor}, size: ${m['monitor-width']}x${m['monitor-height']}, offset: ${m['left-coordinate']}x${m['top-coordinate']}`).join(',\n '));
  }
  const wins = getWindows();
  // Create an array of all window/rule combinations that need processing
  const placementPromises = [];
  
  for (const w of wins) {
    const matchedRules = getMatchedRules(w);
    for (const rule of matchedRules) {
      if (rule.onlyOnOpen) continue;
      rule.pos = parsePos(rule, mons);
      // Push the promise to the array without awaiting it
      placementPromises.push(placeWindow({ w, rule, isBulk })
        .then(changes => ({ w, changes })) // Return window and changes if successful
        .catch(error => {
          console.error('Error placing window:', error);
          return null; // Return null for failed placements
        })
      );
    }
  }
  
  // Wait for all placements to complete in parallel
  const results = await Promise.all(placementPromises);
  // Filter out null results (failed placements) and empty changes
  const placed = results.filter(result => result && result.changes && result.changes.length > 0);
  
  // Clear references to help garbage collection
  placementPromises.length = 0;
  results.length = 0;
  
  console.log(`after placeWindows: ${Date.now() - t}`);
  return placed;
}

let placeNewWindowsIntervalId = null;

function startPlaceNewWindows() {
  // Clear any existing interval first to prevent leaks
  if (placeNewWindowsIntervalId !== null) {
    clearInterval(placeNewWindowsIntervalId);
    placeNewWindowsIntervalId = null;
  }
  
  const updateInterval = 500;
  const delay = 1000;
  let stored;
  placeNewWindowsIntervalId = setInterval(async () => {
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

function stopPlaceNewWindows() {
  if (placeNewWindowsIntervalId !== null) {
    clearInterval(placeNewWindowsIntervalId);
    placeNewWindowsIntervalId = null;
  }
}

async function placeWindowOnOpen() {
  console.log('Start new windows autoplacer');
  startPlaceNewWindows();
}

module.exports = {
  parsePos,
  placeWindow,
  placeWindowByConfig,
  placeWindowsByConfig,
  placeWindows,
  placeWindowOnOpen,
  startPlaceNewWindows,
  stopPlaceNewWindows,
};
