import { getConfig } from '../config.js';
import { getVisibleWindowIds, getWindowById } from '../windows.js';
import { placeWindowByConfig } from '../placement.js';
import { getWindowsMonitors } from '../monitors.js';
import { virtualDesktop } from '../virtual-desktop.js';
import { loadSessionIndex } from './sessions.js';
import { readState, writeState, upsertSlot } from './state.js';
import { step } from './tracker-helpers.js';
import {
  mergeClaudeWtConfig,
  isTerminalPath,
  desktopOnlyActions,
  layoutFingerprint,
  unresolvedTitles,
} from './daemon-helpers.js';
import { stripTitleDecoration } from './title-helpers.js';

function getClaudeWtConfig() {
  return mergeClaudeWtConfig(getConfig().claudeWt);
}

function isTerminalWindow(w) {
  return isTerminalPath(w?.path);
}

// Windows the tracker follows, and handles already ruled out. Keeping both
// means a hwnd costs one initWindow over its whole lifetime instead of one per
// tick — see the note on snapshot() below.
let terminals = new Map();
let notTerminals = new Set();

/**
 * The tick's view of the world, built the cheap way.
 *
 * getWindows() costs ~31 ms of CPU because it does OpenProcess plus an exe-path
 * query for *every* window in the system; at 1 Hz that alone is measurable in a
 * CPU graph (commit 96c2584). getVisibleWindowIds() is ~0.6 ms — EnumWindows
 * plus IsWindowVisible and nothing else. So: poll handles, resolve a handle to
 * a process exactly once, and read titles and bounds only for the handful of
 * windows that turned out to be Windows Terminal.
 */
function snapshot() {
  const ids = getVisibleWindowIds();
  const present = new Set(ids);
  // Windows recycles hwnds, so a handle that went away must lose its verdict.
  for (const id of terminals.keys()) if (!present.has(id)) terminals.delete(id);
  for (const id of notTerminals) if (!present.has(id)) notTerminals.delete(id);
  for (const id of ids) {
    if (terminals.has(id) || notTerminals.has(id)) continue;
    const w = getWindowById(id);
    if (w && isTerminalWindow(w)) terminals.set(id, w);
    else notTerminals.add(id);
  }
  const windows = [];
  for (const [id, w] of terminals) {
    // Заголовок нормализуется здесь и больше нигде: дальше по цепочке — история
    // заголовков в слотах, детект дублей, сравнение с индексом — всё работает с
    // одной формой. Заодно снимается мигание статус-глифа, иначе заголовок
    // считался бы новым каждый раз, когда Claude Code начинает или заканчивает
    // работу, и привязка к сессии переигрывалась бы без конца.
    const title = stripTitleDecoration(w.getTitle());
    const bounds = w.getBounds();
    if (!title || !bounds) continue;
    windows.push({ id, title, bounds });
  }
  return windows;
}

let intervalId = null;
let prevWindows = [];
let lastWritten = '';
let liveState = null;
let reportedTitles = new Set();

/** Diagnostics for the case the design cannot detect: a title we fail to match. */
function reportUnresolved(nextWindows) {
  for (const title of unresolvedTitles(nextWindows)) {
    if (reportedTitles.has(title)) continue;
    reportedTitles.add(title);
    console.log(`[claude-wt] terminal window not matched to a session: "${title}"`);
  }
  if (reportedTitles.size > 200) reportedTitles = new Set();
}

async function place(rule, what) {
  try {
    await placeWindowByConfig(rule);
  } catch (e) {
    console.error(`[claude-wt] failed to place ${what}: ${e.message}`);
  }
}

async function claudeWtTick() {
  const cfg = getClaudeWtConfig();
  // Состояние живёт в памяти: с диска оно читается один раз при старте, дальше
  // файл — только снимок для восстановления, а не рабочая структура.
  if (!liveState) liveState = readState(cfg.statePath);
  const windows = snapshot();
  const sessionIndex = loadSessionIndex(cfg.sessionsFile);
  // monitors нужны ДО actions: step() зажимает координаты сам, иначе запрошенная
  // и фактически применённая позиция расходятся и guard собственного хода
  // висит до таймаута, а потом записывает зажатую позицию поверх исходной.
  const monitors = windows.length ? getWindowsMonitors() : [];
  const seenWindows = prevWindows;
  const { nextWindows, actions, bindings, nextState } = step({
    prevWindows: seenWindows,
    windows,
    sessionIndex,
    state: liveState,
    monitors,
    now: Date.now(),
    options: { stableTicks: cfg.stableTicks },
  });
  prevWindows = nextWindows;
  if (cfg.debug) reportUnresolved(nextWindows);

  for (const action of actions) {
    // action.bounds уже зажаты внутри step() — повторно клампить не нужно
    const rule = { window: action.windowId, ...action.bounds };
    if (cfg.desktop && action.desktop) rule.desktop = action.desktop;
    await place(rule, `window ${action.windowId}`);
  }

  if (cfg.desktop) {
    const fixes = desktopOnlyActions({
      prevWindows: seenWindows, nextWindows, slots: nextState.slots, actions,
    });
    for (const fix of fixes) {
      await place({ window: fix.windowId, desktop: fix.desktop }, `window ${fix.windowId} on desktop ${fix.desktop}`);
    }
  }

  // Читаем номер виртуального стола только в момент привязки окна к сессии:
  // этот вызов спавнит VirtualDesktop11.exe, в горячем цикле ему не место.
  if (cfg.desktop) {
    for (const binding of bindings) {
      try {
        const num = await virtualDesktop.GetWindowDesktopNumber(binding.windowId);
        if (num !== undefined && nextState.slots[binding.sessionId]) {
          nextState.slots[binding.sessionId] = upsertSlot(nextState.slots[binding.sessionId], {
            desktop: Number(num) + 1,
          });
        }
      } catch (e) {
        console.error(`[claude-wt] failed to read desktop for ${binding.windowId}: ${e.message}`);
      }
    }
  }

  liveState = nextState;
  const fingerprint = layoutFingerprint(nextState);
  if (fingerprint !== lastWritten) {
    writeState(cfg.statePath, nextState);
    lastWritten = fingerprint;
  }
}

function startClaudeWt() {
  const cfg = getClaudeWtConfig();
  if (!cfg.enabled) {
    console.error('[claude-wt] claudeWt.enabled is false in config, refusing to start');
    return;
  }
  if (!cfg.statePath) {
    console.error('[claude-wt] claudeWt.statePath is not set in config, refusing to start');
    return;
  }
  stopClaudeWt();
  liveState = null;
  prevWindows = [];
  lastWritten = '';
  terminals = new Map();
  notTerminals = new Set();
  reportedTitles = new Set();
  console.log(`[claude-wt] watching every ${cfg.interval}ms, state: ${cfg.statePath}`);
  // Динамический импорт: restore.js импортирует этот модуль, статический импорт
  // в обратную сторону дал бы цикл.
  import('./restore.js')
    .then(mod => mod.maybeRestoreOnStart())
    .catch(e => console.error(`[claude-wt] crash check failed: ${e.message}`));
  intervalId = setInterval(() => {
    claudeWtTick().catch(e => console.error(`[claude-wt] tick failed: ${e.message}`));
  }, cfg.interval);
}

function stopClaudeWt() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function claudeWtStatus() {
  const cfg = getClaudeWtConfig();
  const state = liveState ?? readState(cfg.statePath);
  return {
    running: intervalId !== null,
    slots: Object.entries(state.slots).map(([id, slot]) => ({
      id, title: slot.titles[0], bounds: slot.bounds, desktop: slot.desktop, lastSeen: slot.lastSeen,
    })),
    lastLayout: state.lastLayout,
    statePath: cfg.statePath,
    sessionsFile: cfg.sessionsFile,
  };
}

export { CLAUDE_WT_DEFAULTS } from './daemon-helpers.js';
export {
  getClaudeWtConfig,
  isTerminalWindow,
  startClaudeWt,
  stopClaudeWt,
  claudeWtStatus,
  claudeWtTick,
};
