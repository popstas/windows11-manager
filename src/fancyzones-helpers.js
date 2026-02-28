/** Pure helper for FancyZones position calculation. No file I/O. */

import { applyMonitorGaps, applyMonitorsOffset } from './geometry.js';

function calcFancyZonePos({ zone, monBounds, monitorGaps, monitorsOffset }) {
  const pos = {
    x: monBounds.x + zone.X,
    y: monBounds.y + zone.Y,
    width: zone.width,
    height: zone.height,
  };
  applyMonitorGaps({ pos, monBounds, monitorGaps });
  applyMonitorsOffset({ pos, offset: monitorsOffset });
  return pos;
}

export { calcFancyZonePos };
