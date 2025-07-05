const { windowManager } = require('node-window-manager');
const { getConfig } = require('./config');

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
  for (let n in config.monitorsSize) {
    const size = config.monitorsSize[n];
    const found = mons.find(m => m.bounds.width == size.width && m.bounds.height == size.height);
    if (found) sorted.push(found);
  }
  return sorted[ind];
}

function getMons() {
  const config = getConfig();
  const mons = [{}];
  for (let i in config.monitorsSize) {
    mons.push(getMonitor(i));
  }
  return mons;
}

function getMonitorNumByName(name) {
  const config = getConfig();
  for (let key in config.monitorsSize) {
    if (config.monitorsSize[key].name == name) return parseInt(key);
  }
}

function getSortedMonitors() {
  const config = getConfig();
  const editor = require(`${config.fancyZones.path}/editor-parameters.json`);
  return editor.monitors.sort((a, b) => {
    const aByName = getMonitorNumByName(a.monitor);
    const bByName = getMonitorNumByName(b.monitor);
    if (aByName !== undefined && bByName !== undefined) return aByName - bByName;
    const yOffset = b['top-coordinate'] - a['top-coordinate'];
    if (Math.abs(yOffset) > 1000) {
      if (yOffset > 0) return -1;
      if (yOffset < 0) return 1;
      return 0;
    }
    return a['left-coordinate'] - b['left-coordinate'];
  });
}

function getFancyZoneMonitor(num) {
  const sortedMons = getSortedMonitors();
  return sortedMons[num - 1];
}

module.exports = {
  getWindowsMonitors,
  getMonitor,
  getMons,
  getMonitorNumByName,
  getSortedMonitors,
  getFancyZoneMonitor,
};
