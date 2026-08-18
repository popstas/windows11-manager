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

  // Деления на DPI/scaleFactor здесь намеренно нет. Зоны и work-area из
  // editor-parameters.json/custom-layouts.json живут в том же пространстве,
  // что getBounds()/setBounds() node-window-manager — то есть уже в логических
  // пикселях (проверено на popstas-pc, 2026-08-18, монитор MSI, 125%/dpi 120:
  // work-area совпала с getWorkArea() node-window-manager; независимо
  // подтверждено фикстурой data/FancyZonesProfile/custom-layouts.json —
  // раскладка «3 - Monitor 15" horiz» имеет ref-width/ref-height 1726x1200,
  // ровно work-area её 192-dpi монитора, при зонах высотой 1200). Про
  // monitor-width/monitor-height (физические пиксели в этой же фикстуре)
  // ничего не утверждается — калькулятор их не использует. Деление на
  // scaleFactor превращало зону на всю высоту рабочей области в зону 80%
  // высоты — это и был баг.

  return pos;
}

export { calcFancyZonePos };
