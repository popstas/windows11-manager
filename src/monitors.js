import fs from 'node:fs';
import { windowManager } from 'node-window-manager';
import { getConfig } from './config.js';
import { findMonitorByPoint, findMonitorNumByName, sortMonitors } from './monitors-helpers.js';

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
  const mons = getWindowsMonitors();
  const sorted = [];
  for (const n in config.monitorsSize) {
    const size = config.monitorsSize[n];
    const found = mons.find(m => m.bounds.width === size.width && m.bounds.height === size.height);
    if (found) sorted.push(found);
  }
  return sorted[ind];
}

function getMons() {
  const config = getConfig();
  const mons = [{}];
  for (const i in config.monitorsSize) {
    mons.push(getMonitor(i));
  }
  return mons;
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

export { findMonitorByPoint, findMonitorNumByName, sortMonitors } from './monitors-helpers.js';
export {
  getWindowsMonitors,
  getMonitor,
  getMons,
  getMonitorByPoint,
  getMonitorNumByName,
  getSortedMonitors,
  getFancyZoneMonitor,
};
