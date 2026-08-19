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

/**
 * Ширина знака моноширинного шрифта в логических пикселях.
 *
 * Ограничение задано в колонках, а двигаются окна в пикселях, и перевести одно
 * в другое нечем: терминал своей ширины в знаках не сообщает. Десять — Cascadia
 * Mono 12pt при 96 DPI (кегль 16 px, ширина знака 0.6 кегля ≈ 9.6). Масштаб
 * сюда не входит: и `getBounds()`, и `setBounds()` живут в виртуализированном
 * пространстве, а терминал DPI-aware и растёт ровно во столько же раз, во
 * сколько виртуализация ужимает координаты. Число заведомо приблизительное, и
 * это осознанно: ошибка в полпикселя сдвигает границу на несколько колонок, а
 * не ломает раскладку. Меряется на живой машине и правится здесь.
 */
const COL_PX = 10;

/** Что у окна занято не текстом: рамка, отступы, полоса прокрутки. */
const CHROME_PX = 32;

/** Колонок на терминал — не меньше и не больше. */
const MIN_COLS = 80;
const MAX_COLS = 120;

/** Ступенька каскада — вправо и вниз разом. */
const STEP = 50;

const minWidth = () => MIN_COLS * COL_PX + CHROME_PX;
const maxWidth = () => MAX_COLS * COL_PX + CHROME_PX;

/**
 * Сколько колонок в сетке. Зависит от экрана и только от него.
 *
 * Три — идеал, и от него отступают только под нажимом экрана. Когда экран
 * узок настолько, что оба ограничения разом не выполнить (одна колонка уже
 * шире 120 знаков, а две — уже 80), побеждает нижнее: читать узкий терминал
 * хуже, чем широкий. Порядок операций здесь и решает этот спор, поэтому его
 * нельзя переписать «покороче».
 */
function columns(width) {
  const most = Math.max(1, Math.floor(width / minWidth()));
  const least = Math.max(1, Math.ceil(width / maxWidth()));
  return Math.max(1, Math.min(most, Math.max(3, least)));
}

/**
 * Запасная сетка: та же плитка, но по своим колонкам, а не по зонам.
 *
 * Считается, когда зон нет вовсе, — на машине, где FancyZones не настроен.
 * Про то, что случился откат, говорит вызывающий: тихий откат спрятал бы
 * протухший editor-parameters.json, известную болезнь этого проекта.
 */
function tileGrid(work, n) {
  if (!n || !work || work.width <= 0 || work.height <= 0) return [];
  const cols = columns(work.width);
  // Ширина режется по 120 колонкам даже там, где экран позволяет больше:
  // растянутый терминал читать нечем — глаз не доносит строку до конца.
  // Колонок при этом ровно столько, чтобы до обрезки не дошло: она сторож.
  const w = Math.min(Math.floor(work.width / cols), maxWidth());
  const counts = splitCounts(n, cols);
  const out = [];
  for (let col = 0; col < cols; col += 1) {
    if (!counts[col]) continue;
    out.push(...stackInCell(
      { x: work.x + col * w, y: work.y, width: w, height: work.height },
      counts[col],
    ));
  }
  return out;
}

/**
 * Стопка со сдвигом вправо и вниз.
 *
 * Окна одного размера: половина рабочей области по ширине, а по высоте —
 * сколько осталось после ступенек. Высота считается от числа окон в стопке:
 * двум окнам ступенька нужна одна, и отдавать им столько же места, сколько
 * десяти, значит впустую резать высоту.
 *
 * Ступенек помещается столько, чтобы окно не стало ниже половины рабочей
 * области и не уехало за правый край. Дальше стопка начинается заново от
 * левого верхнего угла: окон, которым не хватило ступенек, к этому времени
 * десяток, и экрану уже нечего им предложить, как ни считай.
 */
function cascade(work, n) {
  if (!n || !work || work.width <= 0 || work.height <= 0) return [];
  const w = Math.floor(work.width / 2);
  const roomRight = Math.floor((work.width - w) / STEP);
  const roomDown = Math.floor(Math.floor(work.height / 2) / STEP);
  const perStack = 1 + Math.max(0, Math.min(roomRight, roomDown));
  const steps = Math.min(n, perStack) - 1;
  const h = work.height - steps * STEP;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const step = i % perStack;
    out.push({ x: work.x + step * STEP, y: work.y + step * STEP, width: w, height: h });
  }
  return out;
}

/**
 * Перевести прямоугольник из пространства монитора (`getBounds()`/
 * `getWorkArea()` node-window-manager, физические пиксели монитора) в
 * пространство окон (`Window.getBounds()`/`setBounds()`) — то, в котором
 * реально двигаются окна: обёртка (`vendor/node-window-manager/src/classes/
 * window.ts`) делит сырые координаты на масштаб монитора при чтении и
 * умножает при записи.
 *
 * Масштаб 1 — прямоугольник без изменений, без округления: не терять точность
 * там, где округлять нечего.
 */
function toWindowSpace(rect, scaleFactor) {
  if (!rect || !scaleFactor || scaleFactor === 1) return rect;
  return {
    x: Math.round(rect.x / scaleFactor),
    y: Math.round(rect.y / scaleFactor),
    width: Math.round(rect.width / scaleFactor),
    height: Math.round(rect.height / scaleFactor),
  };
}

/**
 * Какому окну вернуть фокус после раскладки.
 *
 * Раскладка поднимает все окна поверх чужих, и после этого фокус обязан
 * оказаться на одном из них — иначе поднятая плитка стоит впереди, а ввод
 * уходит окну, которого не видно.
 *
 * Бывшее переднее окно в приоритете, но только если оно само раскладывается:
 * человек звал раскладку, глядя на одно из этих окон, и отбирать у него ввод
 * незачем. Переднее окно со стороны (пикер, браузер) в счёт не идёт — вернуть
 * фокус ему значило бы отдать ввод тому, что раскладка только что накрыла.
 *
 * Пустой список — ничего фокусировать не надо, `null`.
 */
function pickFocusTarget(ids = [], activeId = 0) {
  if (!ids.length) return null;
  if (activeId && ids.includes(activeId)) return activeId;
  return ids[0];
}

/**
 * Разложить `n` окон. Порядок ответа — порядок окон.
 *
 * На входе именно рабочая область, а не экран: что из экрана вычесть, знает
 * платформа (панель задач отдаёт `MONITORINFO.rcWork`), и знание это здесь не
 * повторяется — повторённое, оно разошлось бы с настоящим на первом же
 * переезде панели.
 */
function arrange({ mode, zones = [], work, n }) {
  if (!n) return [];
  if (mode === 'cascade') return cascade(work, n);
  if (zones.length) return tileByZones(zones, n);
  return tileGrid(work, n);
}

/**
 * Окна по рабочим столам, текущий стол первым.
 *
 * Плитка на разбросанных сессиях прежде шла одним списком: окна с чужого
 * стола делили зоны с окнами текущего, и на каждом столе оставались дыры, а
 * подъём чужого окна утаскивал человека на его стол. Группа — это отдельная
 * раскладка: своя сетка зон с нуля и свой проход подъёма.
 *
 * Стол у окна — из слота claude-wt, а он бывает пуст (claudeWt.desktop
 * выключён, слот записан до того, как демон научился спрашивать номер). Такое
 * окно идёт в текущую группу: «стол неизвестен» — это не «стол чужой», и
 * молча не поднимать его было бы хуже, чем поднять лишнее.
 *
 * `current` пуст, когда текущий стол не удалось узнать вовсе; тогда им
 * считается стол первого окна — пикер ставит первой ту сессию, ради которой
 * раскладку и просят.
 */
function groupByDesktop(items = [], current = null) {
  if (!items.length) return [];
  const desk = items.map(it => it?.desktop ?? null);
  const cur = current ?? desk.find(d => d !== null) ?? null;
  const numbers = [...new Set(desk.filter(d => d !== null && d !== cur))].sort((a, b) => a - b);
  const order = [cur, ...numbers];
  return order.map(desktop => ({
    desktop,
    isCurrent: desktop === cur,
    // Стол не задан — окно к текущей группе: см. заголовок.
    items: items.filter((it, i) => (desk[i] === null ? desktop === cur : desk[i] === desktop)),
  })).filter(g => g.items.length);
}

export { groupByDesktop, layoutFromName, normalizeIds, parseArrangePayload, pickFocusTarget, splitCounts, stackInCell, tileByZones, columns, tileGrid, cascade, arrange, toWindowSpace };
