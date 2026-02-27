import { windowManager } from 'node-window-manager';
import { getConfig } from './config.js';
import { getMons, getSortedMonitors, getMonitorByPoint } from './monitors.js';
import { fancyZonesToPos, addFancyZoneHistory } from './fancyzones.js';
import { getWindows, getMatchedRules, getWindowInfo, getWindow } from './windows.js';
import { virtualDesktop } from './virtual-desktop.js';
import { adjustBoundsForScale } from './scale.js';
import fs from 'node:fs';
import path from 'node:path';

const LOG_FILE = path.join(process.cwd(), 'data', 'windows11-manager.log');

function verboseLog(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) {
    console.error('Failed to write log file:', e.message);
  }
}

function verboseLogFileOnly(message) {
  const line = `${new Date().toISOString()} ${message}`;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) {
    console.error('Failed to write log file:', e.message);
  }
}

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
    const monNum = Number(res[1]);
    const oper = res[2];
    const mon = mons[monNum];
    if (!mon) { console.log(`Monitor not found for position: ${JSON.stringify(pos)}`); return false; }
    let third = (mon.bounds.width - config.panelWidth) / 3;
    if (monNum === 2) third -= config.panelWidth;
    switch (oper) {
      case 'top': newPos.y = mon.bounds.y; break;
      case 'right':
        newPos.x = mon.bounds.x + mon.bounds.width - newPos.width;
        if (monNum === 1) newPos.x -= config.panelWidth;
        if (monNum === 3) newPos.x += config.panelWidth;
        break;
      case 'bottom':
        newPos.y = mon.bounds.y + mon.bounds.height - newPos.height;
        if (monNum === 2) newPos.y -= config.panelHeight;
        break;
      case 'left':
        newPos.x = mon.bounds.x;
        if (monNum === 3) newPos.x += config.panelWidth;
        break;
      case 'x-2/3':
        newPos.x = mon.bounds.x + third * 1;
        if (monNum === 3) newPos.x += config.panelWidth;
        newPos.x = parseInt(newPos.x); break;
      case 'x-3/3':
        newPos.x = mon.bounds.x + third * 2;
        if (monNum === 3) newPos.x += config.panelWidth;
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
    const isExactlyPlaced = oldPos[name] === newPos[name];
    const isPixelPlaced = Math.abs(oldPos[name] - newPos[name]) < 2;
    if (!isExactlyPlaced && !isPixelPlaced) return false;
  }
  return true;
}

async function placeWindow({ w, rule = {}, isBulk = false, verbose = false }) {
  const minWidth = 250;
  const config = getConfig();
  const debugLog = config.debug || verbose;
  if (!w) return false;
  const baseName = path.basename(w.path);
  const winName = w.title || baseName;
  if (debugLog) verboseLogFileOnly(`trying to placeWindow: ${winName}`);
  const pos = rule.pos;
  const oldPos = w.getBounds();
  const changes = [];
  const skipped = [];

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
    if (w.getBounds()['x'] < 0) {
      verboseLogFileOnly(`Skip offscreen ${winName}: x=${w.getBounds().x}`);
      skipped.push({ name: 'bounds' });
    } else {
      if (debugLog) console.log(`Place ${getWindowInfo(w)} to ${JSON.stringify(applyPos)}\n`);
      const ruleFields = {};
      for (const key of ['titleMatch', 'pathMatch', 'fancyZones', 'desktop', 'pin', 'single', 'exclude']) {
        if (rule[key] !== undefined) ruleFields[key] = rule[key];
      }
      verboseLog(`Place ${getWindowInfo(w)} rule=${JSON.stringify(ruleFields)} from ${JSON.stringify(oldPos)} to ${JSON.stringify(finalBounds)}`);
      changes.push({ name: 'bounds', oldPos, value: applyPos });
      if (rule.fancyZones) addFancyZoneHistory({ w, rule });
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
    }
  } else if (placed) {
    if (debugLog) verboseLogFileOnly(`Skip ${winName}: bounds already match`);
    skipped.push({ name: 'bounds' });
  }
  if (!pos && !rule.pin && !rule.desktop) {
    if (debugLog) verboseLogFileOnly(`Skip ${winName}: no pos/pin/desktop in rule`);
    return { changes, skipped };
  }
  if (!pos && (rule.fancyZones || rule.x !== undefined || rule.y !== undefined)) {
    if (debugLog) verboseLogFileOnly(`parsePos returned false for ${winName}`);
  }
  if (rule.pin && !(await virtualDesktop.IsPinnedWindow(w.id))) {
    console.log(`Pin ${winName}`);
    virtualDesktop.PinWindow(w.id);
    changes.push({ name: 'pin', value: true });
  } else if (rule.pin) {
    if (debugLog) verboseLogFileOnly(`Skip pin for ${winName}: already pinned`);
    skipped.push({ name: 'pin' });
  }
  if (rule.desktop) {
    const num = rule.desktop - 1;
    try {
      const winDesktopNum = await virtualDesktop.GetWindowDesktopNumber(w.id);
      if (Number(winDesktopNum) !== num) {
        console.log(`Move ${winName} to Desktop ${rule.desktop} (id: ${w.id}, process id: ${w.processId})`);
        virtualDesktop.MoveWindowToDesktopNumber(w.id, num);
        changes.push({ name: 'desktop', value: num });
      } else {
        if (debugLog) verboseLogFileOnly(`Skip desktop for ${winName}: already on desktop ${rule.desktop}`);
        skipped.push({ name: 'desktop' });
      }
    } catch (e) {
      console.log(`Failed to place ${winName} to Desktop ${rule.desktop}`);
    }
  }
  return { changes, skipped };
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
  const debugLog = config.debug;
  opts = { ...{ changeDesktop: true }, ...opts };
  let placedCount = 0;
  let skippedCount = 0;
  let processedCount = 0;
  for (let w of wins) {
    const matchedRules = getMatchedRules(w);
    if (matchedRules.length === 0) continue;
    const winName = w.title || path.basename(w.path);
    if (debugLog) verboseLogFileOnly(`placeWindowsByConfig: matched ${winName} with ${matchedRules.length} rule(s)`);
    const mons = getMons();
    for (let rule of matchedRules) {
      rule.pos = parsePos(rule, mons);
      if (!rule.pos && (rule.fancyZones || rule.x !== undefined || rule.y !== undefined)) {
        if (debugLog) verboseLogFileOnly(`placeWindowsByConfig: parsePos returned false for ${winName}`);
      }
      const result = await placeWindow({ w, rule });
      processedCount++;
      const changes = result ? result.changes : [];
      const skipped = result ? result.skipped : [];
      if (changes.length > 0) placedCount++;
      if (skipped.length > 0 && changes.length === 0) skippedCount++;
      if (opts.changeDesktop && changes.length > 0) {
        const desktopChanged = changes.find(c => c.name === 'desktop');
        if (desktopChanged) {
          console.log(`Change desktop to ${desktopChanged.value + 1}`);
          virtualDesktop.GoToDesktopNumber(desktopChanged.value);
        }
      }
    }
  }
  if (debugLog) verboseLogFileOnly(`placeWindowsByConfig: ${placedCount} placed, ${skippedCount} skipped, ${processedCount} processed (${wins.length} windows)`);
}

async function placeWindows(opts = {}) {
  const t = Date.now();
  const config = getConfig();
  const verbose = opts.verbose === true;
  const debugLog = config.debug || verbose;
  const mons = getMons();
  const isBulk = true;
  if (debugLog) {
    console.log('mons:');
    console.log(JSON.stringify(mons));
    const sortedMons = getSortedMonitors();
    console.log('sortedMons:');
    console.log(sortedMons.map(m => `name: ${m.monitor}, size: ${m['monitor-width']}x${m['monitor-height']}, offset: ${m['left-coordinate']}x${m['top-coordinate']}`).join(',\n '));
  }
  const wins = getWindows();
  // Create an array of all window/rule combinations that need processing
  const placementPromises = [];
  let matchedCount = 0;

  for (const w of wins) {
    const matchedRules = getMatchedRules(w);
    if (matchedRules.length > 0) {
      matchedCount++;
      if (debugLog) verboseLogFileOnly(`placeWindows: matched ${w.title || path.basename(w.path)} with ${matchedRules.length} rule(s)`);
    }
    for (const rule of matchedRules) {
      if (rule.onlyOnOpen) continue;
      rule.pos = parsePos(rule, mons);
      if (!rule.pos && (rule.fancyZones || rule.x !== undefined || rule.y !== undefined)) {
        if (debugLog) verboseLogFileOnly(`placeWindows: parsePos returned false for ${w.title || path.basename(w.path)}`);
      }
      // Push the promise to the array without awaiting it
      placementPromises.push(placeWindow({ w, rule, isBulk, verbose })
        .then(result => ({ w, changes: result ? result.changes : [], skipped: result ? result.skipped : [] }))
        .catch(error => {
          console.error('Error placing window:', error);
          return null; // Return null for failed placements
        })
      );
    }
  }

  if (verbose) verboseLog(`Found ${wins.length} windows, ${matchedCount} matched rules`);

  // Wait for all placements to complete in parallel
  const results = await Promise.all(placementPromises);
  const totalAttempts = results.length;
  const failed = results.filter((r) => r === null).length;
  const placed = results.filter(
    (result) => result && result.changes && result.changes.length > 0
  );
  const skippedCount = results.filter(
    (result) => result && result.skipped && result.skipped.length > 0 && (!result.changes || result.changes.length === 0)
  ).length;

  // Clear references to help garbage collection
  placementPromises.length = 0;
  results.length = 0;

  const duration = Date.now() - t;
  verboseLog(
    `placeWindows: ${placed.length} placed, ${skippedCount} skipped, ${totalAttempts} processed, ${failed} failed, ${duration}ms`
  );
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
      const newWins = wins.filter(w => !stored.find(st => st.id === w.id));
      verboseLogFileOnly(`Autoplacer: detected ${newWins.length} new window(s): ${newWins.map(w => w.title || path.basename(w.path)).join(', ')}`);
      stored = wins; // prevent re-trigger on next tick
      setTimeout(async () => {
        const currentWins = getWindows();
        const winsToPlace = currentWins.filter(w => newWins.find(nw => nw.id === w.id));
        verboseLogFileOnly(`Autoplacer: placing ${winsToPlace.length} window(s) after ${delay}ms delay`);
        await placeWindowsByConfig(winsToPlace, { changeDesktop: winsToPlace.length === 1 });
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

export {
  parsePos,
  placeWindow,
  placeWindowByConfig,
  placeWindowsByConfig,
  placeWindows,
  placeWindowOnOpen,
  startPlaceNewWindows,
  stopPlaceNewWindows,
};
