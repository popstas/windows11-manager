import { getConfig } from './config.js';
import { getMons, getSortedMonitors, getMonitorByPoint } from './monitors.js';
import { fancyZonesToPos, addFancyZoneHistory } from './fancyzones.js';
import { getWindows, getVisibleWindowIds, getMatchedRules, getWindowInfo, getWindow } from './windows.js';
import { isMinimized } from './windows-helpers.js';
import { virtualDesktop } from './virtual-desktop.js';
import { adjustBoundsForScale } from './scale.js';
import { isBoundsMatch } from './geometry.js';
import { parsePosFromRule, desktopPolicy } from './placement-helpers.js';
import { noAutoplaceIds } from './no-autoplace.js';
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
  const result = parsePosFromRule({
    rule: pos,
    mons,
    panelWidth: config.panelWidth,
    panelHeight: config.panelHeight,
  });
  if (result && result.fancyZones) return fancyZonesToPos(result.fancyZones);
  return result;
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
    if (isMinimized(w.getBounds())) {
      verboseLogFileOnly(`Skip minimized ${winName}: x=${w.getBounds().x}`);
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
  if (rule.desktop && !desktopPolicy(process.env).move) {
    if (debugLog) verboseLogFileOnly(`Skip desktop for ${winName}: перенос между столами выключен настройкой`);
    skipped.push({ name: 'desktop' });
  } else if (rule.desktop) {
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
  await placeWindow({ w, rule });
  return w;
}

async function placeWindowsByConfig(wins = [], opts = {}) {
  const config = getConfig();
  const debugLog = config.debug;
  opts = { ...{ changeDesktop: true }, ...opts };
  let placedCount = 0;
  let skippedCount = 0;
  let processedCount = 0;
  let failedCount = 0;
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
      // Та же сетка, что и в placeWindows(): у окна, чей процесс умер между
      // перечислением и расстановкой, getMonitor().getScaleFactor() бросает — и
      // одно такое окно не должно ни обрывать остальную пачку, ни ронять
      // процесс через необработанное отклонение.
      const result = await placeWindow({ w, rule }).catch(error => {
        console.error('Error placing window:', error);
        failedCount++;
        return null;
      });
      processedCount++;
      const changes = result ? result.changes : [];
      const skipped = result ? result.skipped : [];
      if (changes.length > 0) placedCount++;
      if (skipped.length > 0 && changes.length === 0) skippedCount++;
      if (opts.changeDesktop && desktopPolicy(process.env).follow && changes.length > 0) {
        const desktopChanged = changes.find(c => c.name === 'desktop');
        if (desktopChanged) {
          console.log(`Change desktop to ${desktopChanged.value + 1}`);
          virtualDesktop.GoToDesktopNumber(desktopChanged.value);
        }
      }
    }
  }
  if (debugLog) verboseLogFileOnly(`placeWindowsByConfig: ${placedCount} placed, ${skippedCount} skipped, ${processedCount} processed, ${failedCount} failed (${wins.length} windows)`);
  if (failedCount > 0) verboseLogFileOnly(`placeWindowsByConfig: ${failedCount} window(s) failed to place`);
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

/**
 * Расставить окна, которые только что появились.
 *
 * Вынесено из обработчика таймера, чтобы отклонению этого обещания было куда
 * попасть. Расстановщик живёт в процессе службы MQTT рядом с клиентом брокера,
 * экспортом в Home Assistant, статистикой окон и сторожем демона claude-wt, а
 * node 22 на необработанном отклонении выходит целиком: одно окно, чей процесс
 * умер между перечислением и расстановкой, уносило бы всех разом — и Tauri
 * поднял бы заново только демона, но не эту службу.
 */
async function placeNewWindowIds(newIds) {
  // Окно, поставленное по просьбе с точкой курсора, правилам из `config.windows`
  // не отдаётся: правило подобрано по заголовку или пути, то есть про «человек
  // просил именно этот экран» оно не знает ничего, а приходит позже нас —
  // таймер тикает раз в 1500 мс с задержкой ещё в секунду.
  const pinned = noAutoplaceIds();
  const newIdSet = new Set(newIds.filter(id => !pinned.has(id)));
  const winsToPlace = getWindows().filter(w => newIdSet.has(w.id));
  if (winsToPlace.length === 0) return;
  verboseLogFileOnly(`Autoplacer: placing ${winsToPlace.length} window(s): ${winsToPlace.map(w => w.title || path.basename(w.path)).join(', ')}`);
  await placeWindowsByConfig(winsToPlace, { changeDesktop: winsToPlace.length === 1 });
}

function startPlaceNewWindows() {
  // Clear any existing interval first to prevent leaks
  if (placeNewWindowsIntervalId !== null) {
    clearInterval(placeNewWindowsIntervalId);
    placeNewWindowsIntervalId = null;
  }

  const updateInterval = 1500;
  const delay = 1000;
  // Poll only raw visible hwnds (cheap); build full Window objects with
  // process paths and titles only when an unseen hwnd shows up.
  let knownIds = null;
  placeNewWindowsIntervalId = setInterval(() => {
    // Тело целиком под перехватом: getVisibleWindowIds() ходит в нативный
    // модуль, а исключение из обработчика setInterval роняет процесс, в котором
    // заодно живут MQTT, экспорт в Home Assistant и сторож демона claude-wt.
    // Молчащий расстановщик лучше, чем молчащее всё.
    try {
      const ids = getVisibleWindowIds();
      if (knownIds === null) {
        knownIds = new Set(ids);
        return;
      }
      const newIds = ids.filter(id => !knownIds.has(id));
      knownIds = new Set(ids);
      if (newIds.length === 0) return;
      verboseLogFileOnly(`Autoplacer: detected ${newIds.length} new visible hwnd(s)`);
      setTimeout(() => {
        // .catch(), а не голый async-обработчик: необработанное отклонение
        // отсюда — это немедленный выход процесса в node 22.
        placeNewWindowIds(newIds).catch((e) => {
          console.error('Autoplacer: failed to place new windows:', e);
          verboseLogFileOnly(`Autoplacer: failed to place new windows: ${e?.message ?? e}`);
        });
      }, delay);
    } catch (e) {
      console.error('Autoplacer: failed to poll visible windows:', e);
      verboseLogFileOnly(`Autoplacer: failed to poll visible windows: ${e?.message ?? e}`);
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

export { parsePosFromRule, resolveMonitorRelativePos } from './placement-helpers.js';
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
