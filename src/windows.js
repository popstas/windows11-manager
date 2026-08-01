import { windowManager, addon, Window } from 'node-window-manager';
import { getConfig } from './config.js';
import { getAppFromPath, isWindowMatchRule } from './window-match.js';
import { matchRules, isWindowExcluded } from './windows-helpers.js';

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

// A single known hwnd, at the cost of one initWindow (OpenProcess + exe path)
// instead of the whole getWindows() sweep. For pollers that already know which
// handles they care about; returns null for a handle that is no longer a window.
function getWindowById(id) {
  if (!addon) return null;
  const w = new Window(id);
  return w.isWindow() ? w : null;
}

// Windows parks minimized windows at x = -32000. restore() un-maximizes a
// maximized window, so it must only be called for one that is actually
// minimized.
const MINIMIZED_X = -30000;

/**
 * Bring a window to the foreground, un-minimizing it first if needed.
 *
 * Consumers used to call a `focusWindow` that this package never defined.
 */
function focusWindowById(id) {
  const w = getWindowById(id);
  if (!w) return false;
  const bounds = w.getBounds();
  if (bounds && bounds.x <= MINIMIZED_X) w.restore();
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
