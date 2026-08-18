/**
 * Раскладки окон: где чему стоять, когда человек просит разложить.
 *
 * Чистый расчёт: на входе прямоугольники и число окон, на выходе —
 * прямоугольники по порядку. Ни node-window-manager, ни конфига здесь нет
 * намеренно — тесты этого файла гоняются на машине разработчика, а плитка не
 * та вещь, ради которой стоит идти к Windows.
 *
 * Порт `crates/mwm-core/src/layout.rs` и `request.rs` из macos-windows-manager.
 * Имена функций и числа держатся теми же нарочно: расходиться с маком в
 * разборе одного топика — это отладка сразу на двух машинах.
 */

/** Раскладка по имени из просьбы. Имена — те же, что шлёт пикер. */
function layoutFromName(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().toLowerCase();
  return n === 'tile' || n === 'cascade' ? n : null;
}

/** Список сессий из тела: только непустые строки, обрезанные по краям. */
function normalizeIds(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((v) => typeof v === 'string')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Просьба о раскладке: `{"mode": …, "ids": [...]}`, json-строка и сырая
 * строка — теми же тремя видами, что и просьба о сессии, и по той же причине:
 * топики общие с маком, а с панели openHASP прилетает голое слово.
 *
 * Список сессий необязателен: панель шлёт одно имя раскладки, а порядок у неё
 * взяться неоткуда. Пустой список не отказ, а «разложи всё, что ведёшь».
 */
function parseArrangePayload(payload) {
  let name;
  let ids = [];
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    name = payload.mode;
    ids = normalizeIds(payload.ids);
  } else {
    const text = String(payload ?? '').trim();
    if (!text) return null;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined; // не json вовсе — значит сырая строка, как её шлёт панель
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      name = parsed.mode;
      ids = normalizeIds(parsed.ids);
    } else if (typeof parsed === 'string') {
      name = parsed;
    } else {
      name = text;
    }
  }
  const mode = layoutFromName(name);
  return mode ? { mode, ids } : null;
}

/**
 * Сколько окон достаётся каждой ячейке (зоне или колонке).
 *
 * Обе ветки — одна формула, маковская (`layout.rs`, `tile()`): окон меньше,
 * чем ячеек, — занимаются первые, по одному; больше — лишние достаются
 * последним ячейкам, а не первым. Первое окно списка — самое верхнее в
 * пикере, и ячейка ему достаётся целиком: разложи мы остаток слева, полную
 * получало бы последнее, до которого человеку дела меньше всего.
 */
function splitCounts(n, cells) {
  const base = Math.floor(n / cells);
  const rem = n % cells;
  const out = [];
  for (let k = 0; k < cells; k += 1) {
    out.push(base === 0 ? (k < rem ? 1 : 0) : base + (k >= cells - rem ? 1 : 0));
  }
  return out;
}

/**
 * Разделить прямоугольник по высоте на `count` равных частей.
 *
 * Нижней достаётся остаток от деления: без этого между ней и краем оставалась
 * бы щель в пару точек, и «занимает зону целиком» переставало быть правдой.
 */
function stackInCell(cell, count) {
  const h = Math.floor(cell.height / count);
  const out = [];
  for (let row = 0; row < count; row += 1) {
    const y = cell.y + row * h;
    const height = row === count - 1 ? cell.y + cell.height - y : h;
    out.push({ x: cell.x, y, width: cell.width, height });
  }
  return out;
}

/**
 * Плитка по готовым прямоугольникам зон FancyZones.
 *
 * Зоны уже нарисованы человеком, и делить монитор второй раз своей сеткой —
 * значит спорить с тем, как он его поделил. Здесь зона занимает то место, где
 * на маке стояла колонка.
 */
function tileByZones(rects, n) {
  if (!n || !rects?.length) return [];
  const counts = splitCounts(n, rects.length);
  const out = [];
  rects.forEach((rect, k) => {
    if (counts[k] > 0) out.push(...stackInCell(rect, counts[k]));
  });
  return out;
}

export { layoutFromName, normalizeIds, parseArrangePayload, splitCounts, stackInCell, tileByZones };
