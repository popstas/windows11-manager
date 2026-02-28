import { windowManager } from 'node-window-manager';
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

function getWindows() {
  const windows = windowManager.getWindows();
  const list = [];
  for (const window of windows) {
    if (!window.isVisible()) continue;
    if (isWindowExcluded({
      title: window.getTitle(),
      path: window.path,
      excludedTitles: EXCLUDED_TITLES,
      excludedPaths: EXCLUDED_PATHS,
    })) continue;
    const title = window.getTitle();
    if (title) {
      window.title = title;
      list.push(window);
    }
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

export { matchRules, isWindowExcluded } from './windows-helpers.js';
export {
  getWindows,
  getAppFromPath,
  isWindowMatchRule,
  getMatchedRules,
  getWindowInfo,
  findWindows,
  findWindow,
  getWindow,
};
