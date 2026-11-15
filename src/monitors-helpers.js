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
  for (const probe of sizeProbes(size)) {
    const found = mons.find(m => m?.bounds && probe(m));
    if (found) return found;
  }
  return undefined;
}

/** Пробы размера для `matchMonitorBySize` — от самой точной к самой вольной. */
function sizeProbes({ width, height }) {
  const scaled = m => {
    const sf = typeof m.getScaleFactor === 'function' ? (m.getScaleFactor() || 1) : 1;
    return { width: Math.round(m.bounds.width * sf), height: Math.round(m.bounds.height * sf) };
  };
  return [
    m => m.bounds.width === width && m.bounds.height === height,
    m => m.bounds.width === height && m.bounds.height === width,
    m => { const s = scaled(m); return s.width === width && s.height === height; },
    m => { const s = scaled(m); return s.width === height && s.height === width; },
  ];
}

/**
 * Порядок мониторов на столе: сверху вниз рядами, внутри ряда — слева
 * направо, по левому верхнему углу. Ряд — разница по вертикали больше 1000px:
 * портрет, выступающий над соседом на полэкрана, остаётся в том же ряду.
 */
function compareByPosition(a, b) {
  const yOffset = b.y - a.y;
  if (Math.abs(yOffset) > 1000) return yOffset > 0 ? -1 : 1;
  return a.x - b.x;
}

/**
 * Мониторы, разложенные по номерам из `monitorsSize`.
 *
 * Позиция сохраняется даже для ненайденного монитора. Раньше в массив
 * попадали только найденные, и один отключённый монитор сдвигал все следующие:
 * `getMons()[2]` начинал указывать на монитор из позиции 4, а правила
 * размещения молча уезжали не на тот экран.
 *
 * Мониторы одного размера (на nb ноутбук и правый — оба 1920x1200) по размеру
 * не различить. Поэтому кандидаты перебираются в порядке `sortMonitors` — слева
 * направо по левому верхнему углу, — и монитор, доставшийся одной записи,
 * другой уже не достаётся: записи одного размера получают мониторы по порядку
 * номеров. Раньше обе находили один и тот же экран, а второго для правил
 * (`monN.*`, номер монитора у сессий claude-wt) не было вовсе.
 */
function monitorsByConfigNumber(mons, monitorsSize) {
  const keys = Object.keys(monitorsSize ?? {});
  const out = [];
  for (const key of keys) out[parseInt(key, 10) - 1] = undefined;
  const candidates = (mons ?? [])
    .filter(m => m?.bounds)
    .sort((a, b) => compareByPosition(a.bounds, b.bounds));
  const used = new Set();
  // Сначала точные совпадения у всех записей, потом повороты, потом масштаб:
  // иначе ранняя запись забрала бы поворотом монитор, который поздней
  // подходит точно.
  for (let level = 0; level < 4; level++) {
    for (const key of keys) {
      const idx = parseInt(key, 10) - 1;
      if (out[idx] || !monitorsSize[key]) continue;
      const probe = sizeProbes(monitorsSize[key])[level];
      const found = candidates.find(m => !used.has(m) && probe(m));
      if (!found) continue;
      out[idx] = found;
      used.add(found);
    }
  }
  return out;
}

function findMonitorNumByName(monitorsSize, name) {
  for (const key in monitorsSize) {
    if (monitorsSize[key].name === name) return parseInt(key, 10);
  }
}

function sortMonitors(monitors, monitorsSize) {
  const pos = m => ({ x: m['left-coordinate'], y: m['top-coordinate'] });
  return [...monitors].sort((a, b) => {
    const aByName = findMonitorNumByName(monitorsSize, a.monitor);
    const bByName = findMonitorNumByName(monitorsSize, b.monitor);
    if (aByName !== undefined && bByName !== undefined) return aByName - bByName;
    return compareByPosition(pos(a), pos(b));
  });
}

export {
  compareByPosition,
  findMonitorByPoint,
  findMonitorNumByName,
  matchMonitorBySize,
  monitorsByConfigNumber,
  sortMonitors,
};
