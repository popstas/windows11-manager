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

  // Деление на scaleFactor здесь ЕСТЬ и должно быть. Геометрия мониторов —
  // editor-parameters.json FancyZones (monBounds здесь) и координаты зон в
  // custom-layouts.json — живёт в ФИЗИЧЕСКИХ пикселях. Координаты окон —
  // getBounds()/setBounds() node-window-manager — в ЛОГИЧЕСКИХ,
  // виртуализованных: процесс DPI-unaware, и Windows масштабирует для него
  // весь экран. Это два разных пространства в одном API, и деление на
  // scaleFactor = dpi/96 переводит зону из первого во второе. Без него окна
  // на масштабированном мониторе получаются больше, чем зона (проверено
  // живой правкой на popstas-pc, монитор MSI, масштаб 125%: без деления
  // окна вылезали за пределы зоны).
  if (scaleFactor && scaleFactor !== 1) {
    pos.x = Math.round(pos.x / scaleFactor);
    pos.y = Math.round(pos.y / scaleFactor);
    pos.width = Math.round(pos.width / scaleFactor);
    pos.height = Math.round(pos.height / scaleFactor);
  }

  return pos;
}

export { calcFancyZonePos };
