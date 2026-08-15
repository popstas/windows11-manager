import fs from 'node:fs';
import { windowManager } from 'node-window-manager';
import { getConfig } from './config.js';
import {
  findMonitorByPoint,
  findMonitorNumByName,
  monitorsByConfigNumber,
  sortMonitors,
} from './monitors-helpers.js';

function getWindowsMonitors() {
  return windowManager.getMonitors().map(mon => {
    mon.bounds = mon.getBounds();
    mon.name = mon.getTitle;
    return mon;
  });
}

function getMonitor(num) {
  const config = getConfig();
  const ind = config.monitors[num];
  return monitorsByConfigNumber(getWindowsMonitors(), config.monitorsSize)[ind];
}

function getMons() {
  const config = getConfig();
  const byNumber = monitorsByConfigNumber(getWindowsMonitors(), config.monitorsSize);
  // Индекс 0 — заглушка: номера мониторов в правилах размещения начинаются с 1.
  return [{}, ...Object.keys(config.monitorsSize ?? {}).map(n => byNumber[config.monitors[n]])];
}

function getMonitorByPoint({ x, y }) {
  return findMonitorByPoint(getMons(), { x, y });
}

function getMonitorNumByName(name) {
  const config = getConfig();
  return findMonitorNumByName(config.monitorsSize, name);
}

function getSortedMonitors() {
  const config = getConfig();
  const editor = JSON.parse(fs.readFileSync(`${config.fancyZones.path}/editor-parameters.json`, 'utf8'));
  return sortMonitors(editor.monitors, config.monitorsSize);
}

function getFancyZoneMonitor(num) {
  const sortedMons = getSortedMonitors();
  return sortedMons[num - 1];
}

export {
  findMonitorByPoint,
  findMonitorNumByName,
  matchMonitorBySize,
  monitorsByConfigNumber,
  sortMonitors,
} from './monitors-helpers.js';
export {
  getWindowsMonitors,
  getMonitor,
  getMons,
  getMonitorByPoint,
  getMonitorNumByName,
  getSortedMonitors,
  getFancyZoneMonitor,
};
