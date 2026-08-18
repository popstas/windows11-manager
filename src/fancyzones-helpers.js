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

  // Деления на DPI/scaleFactor здесь намеренно нет. editor-parameters.json
  // FancyZones хранит координаты и размеры зон уже в логических пикселях —
  // в том же пространстве, где работают node-window-manager getBounds()/
  // setBounds(). Проверено на живой машине (popstas-pc, 2026-08-18,
  // монитор MSI, масштаб Windows 125%, dpi 120): getScaleFactor() там даёт
  // 1.25, а monitor-width/work-area-width/height из editor-parameters.json
  // побайтово совпадают с bounds/work из node-window-manager (3072x1728,
  // work 2893x1728). Деление на scaleFactor превращало зону на всю высоту
  // рабочей области в зону 80% высоты — это и был баг. Поле dpi в файле
  // осталось, но использовать его для пересчёта координат зон не нужно.

  return pos;
}

export { calcFancyZonePos };
