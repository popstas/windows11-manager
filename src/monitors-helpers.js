/** Pure helper functions for monitor logic. No external I/O. */

function findMonitorByPoint(mons, { x, y }) {
  for (const mon of mons) {
    if (!mon || !mon.bounds) continue;
    const b = mon.bounds;
    if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) {
      return mon;
    }
  }
}

function findMonitorNumByName(monitorsSize, name) {
  for (const key in monitorsSize) {
    if (monitorsSize[key].name === name) return parseInt(key, 10);
  }
}

function sortMonitors(monitors, monitorsSize) {
  return [...monitors].sort((a, b) => {
    const aByName = findMonitorNumByName(monitorsSize, a.monitor);
    const bByName = findMonitorNumByName(monitorsSize, b.monitor);
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

export { findMonitorByPoint, findMonitorNumByName, sortMonitors };
