import { windowManager, addon, Window } from 'node-window-manager';
import { getConfig } from './config.js';
import { getAppFromPath, isWindowMatchRule } from './window-match.js';
import { matchRules, isWindowExcluded, isMinimized } from './windows-helpers.js';

const EXCLUDED_TITLES = [
  'Default IME',
  'Program Manager',
  'GlowWindow_',
  'Переключение задач',
];

const EXCLUDED_PATHS = [
  'TextInputHost.exe',
  'LogiOverlay.exe',
];

// Raw hwnds of visible top-level windows. Unlike getWindows(), makes no
// OpenProcess/getTitle call per window, so it is cheap enough to poll.
function getVisibleWindowIds() {
  if (!addon || !addon.getWindows) return [];
  return addon.getWindows().filter(id => addon.isWindowVisible(id));
}

// Bare hwnd of the foreground window — GetForegroundWindow() and nothing else.
// windowManager.getActiveWindow() wraps the same hwnd in a Window, whose
// constructor calls initWindow (OpenProcess + exe path); that is exactly the
// per-tick cost the claude-wt daemon is written to avoid.
function getActiveWindowId() {
  if (!addon || !addon.getActiveWindow) return 0;
  return addon.getActiveWindow();
}

// A single known hwnd, at the cost of one initWindow (OpenProcess + exe path)
// instead of the whole getWindows() sweep. For pollers that already know which
// handles they care about; returns null for a handle that is no longer a window.
function getWindowById(id) {
  if (!addon) return null;
  const w = new Window(id);
  return w.isWindow() ? w : null;
}

/**
 * Bring a window to the foreground, un-minimizing it first if needed.
 *
 * Признак свёрнутого — общая isMinimized(), а не свой порог. Прежде здесь
 * стояло -30000 «потому что Windows паркует на -32000», и это оказалось
 * неправдой: замер на popstas-pc 19.08.2026 показал -20480, то есть условие не
 * срабатывало никогда. restore() не звался, оставался голый bringToTop(), и
 * свёрнутое окно выходило на передний план свёрнутым — нажатие на сессию в
 * пикере и на панели выглядело как «ничего не происходит». Порог -10000 из
 * isMinimized() ловит обе парковки и не задевает монитор слева от главного.
 *
 * Проверка нужна по-прежнему: restore() разворачивает и развёрнутое на весь
 * экран окно, а звать его на каждый фокус значило бы отменять максимизацию.
 *
 * Consumers used to call a `focusWindow` that this package never defined.
 */
function focusWindowById(id) {
  const w = getWindowById(id);
  if (!w) return false;
  if (isMinimized(w.getBounds())) w.restore();
  w.bringToTop();
  return true;
}

function getWindows() {
  const windows = windowManager.getWindows();
  const list = [];
  for (const window of windows) {
    if (!window.isVisible()) continue;
    const title = window.getTitle();
    if (!title) continue;
    if (isWindowExcluded({
      title,
      path: window.path,
      excludedTitles: EXCLUDED_TITLES,
      excludedPaths: EXCLUDED_PATHS,
    })) continue;
    window.title = title;
    list.push(window);
  }
  return list;
}

function getMatchedRules(w) {
  const config = getConfig();
  return matchRules(w, config.windows);
}

function getWindowInfo(w) {
  const config = getConfig();
  let msg = getAppFromPath(w.path);
  msg += ` (${w.getTitle()})`;
  if (config.debug) {
    msg += `\npath: ${w.path}` +
      `\nbounds: ${JSON.stringify(w.getBounds())}` +
      `\nproc: ${w.processId}\n`;
  }
  return msg;
}

function findWindows(rule) {
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
  return windows.filter(w => isWindowMatchRule(w, rule));
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
  if (rule.window === 'current') {
    return windowManager.getActiveWindow();
  }
  if (parseInt(rule.window)) {
    return getWindows().find((w) => w.id === Number(rule.window));
  }
}

/**
 * Resolve a rule to a window and focus it.
 *
 * Consumers used to call a `focusWindow` that this package never defined.
 */
function focusWindow(rule) {
  const windows = findWindows(rule);
  if (!windows || !windows.length) {
    console.log(`focusWindow: no window matched rule ${JSON.stringify(rule)}`);
    return false;
  }
  return focusWindowById(windows[0].id);
}

export { matchRules, isWindowExcluded } from './windows-helpers.js';
export {
  getVisibleWindowIds,
  getActiveWindowId,
  getWindowById,
  focusWindowById,
  focusWindow,
  getWindows,
  getAppFromPath,
  isWindowMatchRule,
  getMatchedRules,
  getWindowInfo,
  findWindows,
  findWindow,
  getWindow,
};
