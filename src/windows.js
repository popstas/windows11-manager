import { windowManager } from 'node-window-manager';
import { getConfig } from './config.js';
import { getAppFromPath, isWindowMatchRule } from './window-match.js';

function getWindows() {
  const excludedTitles = [
    'Default IME',
    'Program Manager',
    'GlowWindow_',
    'Переключение задач',
  ];
  const excludedPaths = [
    'TextInputHost.exe',
    'LogiOverlay.exe',
  ];
  const windows = windowManager.getWindows();
  const list = [];
  for (let window of windows) {
    if (!window.isVisible()) continue;
    let isExcluded = false;
    for (let title of excludedTitles) {
      if (window.getTitle().includes(title)) isExcluded = true;
    }
    if (isExcluded) continue;
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
  return list;
}

function getMatchedRules(w) {
  const config = getConfig();
  const rules = config.windows.filter(rule => isWindowMatchRule(w, rule));
  const single = rules.find(rule => rule.single);
  if (single) return [single];
  return rules;
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
