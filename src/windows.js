const { windowManager } = require('node-window-manager');
const { getConfig } = require('./config');

function getAppFromPath(p) {
  const parts = p.split('\\');
  return parts[parts.length - 1].toLowerCase();
}

function getWindows() {
  const config = getConfig();
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

function isWindowMatchRule(w, rule) {
  let isMatch = false;
  const testField = (winField, regex) => {
    if (!regex) return false;
    const reg = new RegExp(regex, 'i');
    return reg.test(w[winField]);
  };
  if (rule.titleMatch) {
    isMatch = testField('title', rule.titleMatch);
    if (!isMatch) return false;
  }
  if (rule.pathMatch) {
    isMatch = testField('path', rule.pathMatch);
  }
  if (isMatch && rule.exclude) {
    if (testField('title', rule.exclude?.titleMatch)) isMatch = false;
    if (isMatch && testField('path', rule.exclude?.pathMatch)) isMatch = false;
  }
  return isMatch;
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

module.exports = {
  getWindows,
  getAppFromPath,
  isWindowMatchRule,
  getMatchedRules,
  getWindowInfo,
  findWindows,
  findWindow,
};
