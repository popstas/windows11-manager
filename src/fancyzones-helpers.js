/** Pure helper for FancyZones position calculation. No file I/O. */

import { applyMonitorGaps, applyMonitorsOffset } from './geometry.js';

function calcFancyZonePos({ zone, monBounds, monitorGaps, monitorsOffset, scaleFactor }) {
  const pos = {
    x: monBounds.x + zone.X,
    y: monBounds.y + zone.Y,
    width: zone.width,
    height: zone.height,
  };
  applyMonitorGaps({ pos, monBounds, monitorGaps });
  applyMonitorsOffset({ pos, offset: monitorsOffset });

  if (scaleFactor && scaleFactor !== 1) {
    pos.x = Math.round(pos.x / scaleFactor);
    pos.y = Math.round(pos.y / scaleFactor);
    pos.width = Math.round(pos.width / scaleFactor);
    pos.height = Math.round(pos.height / scaleFactor);
  }

  return pos;
}

export { calcFancyZonePos };
