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

export { layoutFromName, normalizeIds, parseArrangePayload };
