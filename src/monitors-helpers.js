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

/**
 * Найти среди подключённых мониторов тот, что описан записью `monitorsSize`.
 *
 * Точного совпадения размеров мало по двум причинам, обе встречаются на живой
 * машине:
 *
 * - **Поворот.** Ultrawide 3440×1440, поставленный вертикально, приходит как
 *   1440×3440. Это тот же монитор, и правила размещения для него те же.
 * - **Масштаб.** node-window-manager отдаёт логические размеры, а в конфиге
 *   пишут физические: 4K при 125% выглядит как 3072×1728. Умножение на
 *   scaleFactor возвращает 3840×2160.
 *
 * Порядок проб — от самого точного к самому вольному, чтобы два похожих
 * монитора не перепутались: сначала как есть, потом поворот, затем масштаб и
 * только в конце то и другое вместе.
 */
function matchMonitorBySize(mons, size) {
  if (!size) return undefined;
  const { width, height } = size;
  const scaled = m => {
    const sf = typeof m.getScaleFactor === 'function' ? (m.getScaleFactor() || 1) : 1;
    return { width: Math.round(m.bounds.width * sf), height: Math.round(m.bounds.height * sf) };
  };
  const probes = [
    m => m.bounds.width === width && m.bounds.height === height,
    m => m.bounds.width === height && m.bounds.height === width,
    m => { const s = scaled(m); return s.width === width && s.height === height; },
    m => { const s = scaled(m); return s.width === height && s.height === width; },
  ];
  for (const probe of probes) {
    const found = mons.find(m => m?.bounds && probe(m));
    if (found) return found;
  }
  return undefined;
}

/**
 * Мониторы, разложенные по номерам из `monitorsSize`.
 *
 * Позиция сохраняется даже для ненайденного монитора. Раньше в массив
 * попадали только найденные, и один отключённый монитор сдвигал все следующие:
 * `getMons()[2]` начинал указывать на монитор из позиции 4, а правила
 * размещения молча уезжали не на тот экран.
 */
function monitorsByConfigNumber(mons, monitorsSize) {
  const out = [];
  for (const key of Object.keys(monitorsSize ?? {})) {
    out[parseInt(key, 10) - 1] = matchMonitorBySize(mons, monitorsSize[key]);
  }
  return out;
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

export {
  findMonitorByPoint,
  findMonitorNumByName,
  matchMonitorBySize,
  monitorsByConfigNumber,
  sortMonitors,
};
