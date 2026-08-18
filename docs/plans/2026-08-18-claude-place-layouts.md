# claude-place — раскладки tile/cascade: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** научить windows11-manager раскладывать окна терминалов Claude плиткой и каскадом по просьбе `claude-place`, как это уже делает `macos-windows-manager`.

**Architecture:** вся арифметика — в чистом модуле `src/claude-layout-helpers.js` (порт `crates/mwm-core/src/layout.rs` и `request.rs` с мака), тесты гоняются на любой машине. I/O-слой `src/claude-layout.js` разрешает зоны FancyZones, находит рабочую область, берёт список сессий и двигает окна через уже существующий `placeWindow()`. Команда `claude-place` регистрируется в общей карте команд (`src/commands/build.js`), поэтому её сразу видят оба транспорта — MQTT и HTTP.

**Tech Stack:** Node.js ESM, commander, vitest, node-window-manager (vendored), PowerToys FancyZones.

**Spec:** `docs/specs/2026-08-18-claude-place-layouts-design.md`

## Global Constraints

- **Имена и форма тела берутся у мака как есть.** Команда — `claude-place`, тело — `{"mode": "tile"|"cascade", "ids": [...]}`, плюс JSON-строка и сырая строка. Расхождение с `macos-windows-manager` в разборе одного топика — это отладка сразу на двух машинах.
- **Все координаты — виртуализированные логические пиксели**, те же, в которых работают `getBounds()` и `setBounds()`. `getScaleFactor()` в арифметике раскладки не появляется нигде: поправку масштаба при переезде между экранами делает `placeWindow()`.
- **Чистое отделено от I/O.** В `src/claude-layout-helpers.js` нет ни одного импорта из `node-window-manager`, `config.js` или `fs` — иначе тесты перестанут запускаться на машине разработчика (linux).
- **Тесты:** `npm test` (vitest, `include: ['src/**/*.test.js']`).
- **Комментарии и сообщения в журнал — по-русски**, как во всех соседних модулях (`src/commands/`, `src/claude-wt/`).
- Константы раскладки: `STEP = 50`, `MIN_COLS = 80`, `MAX_COLS = 120`, `COL_PX = 10`, `CHROME_PX = 32`.

---

## File Structure

| файл | ответственность |
|---|---|
| `src/claude-layout-helpers.js` (создать) | разбор тела просьбы + вся арифметика раскладок. Ни одного побочного эффекта |
| `src/claude-layout-helpers.test.js` (создать) | юнит-тесты на всё вышеперечисленное |
| `src/claude-layout.js` (создать) | зоны, рабочая область, список окон, вызов `placeWindow` |
| `src/monitors.js` (править) | `+getPrimaryMonitor()` |
| `src/lib/index.js` (править) | `+export { arrangeClaudeWindows }` — чтобы попало в `winMan` |
| `src/index.js` (править) | `+claude-wt place <mode>` |
| `src/commands/claude-commands.js` (править) | обработчик `claude-place` |
| `src/commands/build.js` (править) | регистрация под `throttlePress` |
| `config.example.yaml` (править) | `claudeWt.tileZones` |
| `AGENTS.md` (править) | раздел про раскладки |

---

### Task 1: Разбор тела просьбы

**Files:**
- Create: `src/claude-layout-helpers.js`
- Test: `src/claude-layout-helpers.test.js`

**Interfaces:**
- Consumes: ничего
- Produces: `parseArrangePayload(payload) → { mode: 'tile'|'cascade', ids: string[] } | null`

- [x] **Step 1: Написать падающий тест**

Создать `src/claude-layout-helpers.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { parseArrangePayload } from './claude-layout-helpers.js';

describe('parseArrangePayload', () => {
  it('разбирает объект с режимом и списком', () => {
    expect(parseArrangePayload({ mode: 'tile', ids: ['a', 'b'] }))
      .toEqual({ mode: 'tile', ids: ['a', 'b'] });
  });

  it('разбирает строку JSON с объектом', () => {
    expect(parseArrangePayload('{"mode":"cascade","ids":["a"]}'))
      .toEqual({ mode: 'cascade', ids: ['a'] });
  });

  it('разбирает json-строку с одним именем раскладки', () => {
    expect(parseArrangePayload('"tile"')).toEqual({ mode: 'tile', ids: [] });
  });

  // Так шлёт панель openHASP: у неё в теле топика голое слово.
  it('разбирает сырую строку', () => {
    expect(parseArrangePayload('cascade')).toEqual({ mode: 'cascade', ids: [] });
  });

  it('не придирается к регистру и пробелам', () => {
    expect(parseArrangePayload('  TILE  ')).toEqual({ mode: 'tile', ids: [] });
  });

  it('отсутствующий ids — это пустой список, а не отказ', () => {
    expect(parseArrangePayload({ mode: 'tile' })).toEqual({ mode: 'tile', ids: [] });
  });

  it('выбрасывает из ids не-строки и пустые строки', () => {
    expect(parseArrangePayload({ mode: 'tile', ids: ['a', '', '  b  ', 7, null] }))
      .toEqual({ mode: 'tile', ids: ['a', 'b'] });
  });

  it('ids не массив — пустой список', () => {
    expect(parseArrangePayload({ mode: 'tile', ids: 'a' })).toEqual({ mode: 'tile', ids: [] });
  });

  it('незнакомая раскладка — null', () => {
    expect(parseArrangePayload({ mode: 'mosaic' })).toBeNull();
  });

  it('пустое тело — null', () => {
    expect(parseArrangePayload('')).toBeNull();
    expect(parseArrangePayload(null)).toBeNull();
    expect(parseArrangePayload({})).toBeNull();
  });

  it('число в теле — null, а не раскладка', () => {
    expect(parseArrangePayload('5')).toBeNull();
  });
});
```

- [x] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run src/claude-layout-helpers.test.js`
Expected: FAIL — `Failed to resolve import "./claude-layout-helpers.js"`

- [x] **Step 3: Написать минимальную реализацию**

Создать `src/claude-layout-helpers.js`:

```js
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
```

- [x] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run src/claude-layout-helpers.test.js`
Expected: PASS, 11 тестов

- [x] **Step 5: Коммит**

```bash
git add src/claude-layout-helpers.js src/claude-layout-helpers.test.js
git commit -m "feat(claude-place): разбор тела просьбы о раскладке"
```

---

### Task 2: Плитка по зонам FancyZones

**Files:**
- Modify: `src/claude-layout-helpers.js`
- Test: `src/claude-layout-helpers.test.js`

**Interfaces:**
- Consumes: ничего из Task 1 (соседние функции в том же файле)
- Produces:
  - `splitCounts(n, cells) → number[]` — сколько окон в каждой ячейке
  - `stackInCell(cell, count) → Bounds[]` — деление прямоугольника по высоте
  - `tileByZones(rects, n) → Bounds[]`
  - `Bounds` здесь и далее — `{ x, y, width, height }`, целые числа

- [x] **Step 1: Написать падающий тест**

Дописать в `src/claude-layout-helpers.test.js`:

```js
import { splitCounts, stackInCell, tileByZones } from './claude-layout-helpers.js';

describe('splitCounts', () => {
  it('окон меньше, чем ячеек — по одному в первые', () => {
    expect(splitCounts(1, 4)).toEqual([1, 0, 0, 0]);
    expect(splitCounts(3, 4)).toEqual([1, 1, 1, 0]);
  });

  it('поровну', () => {
    expect(splitCounts(4, 4)).toEqual([1, 1, 1, 1]);
  });

  // Добор с конца: первое окно списка — самое верхнее в пикере, и ячейка ему
  // достаётся целиком.
  it('лишние окна достаются последним ячейкам', () => {
    expect(splitCounts(6, 4)).toEqual([1, 1, 2, 2]);
    expect(splitCounts(9, 4)).toEqual([2, 2, 2, 3]);
  });
});

describe('stackInCell', () => {
  const CELL = { x: 100, y: 0, width: 500, height: 1000 };

  it('одно окно занимает ячейку целиком', () => {
    expect(stackInCell(CELL, 1)).toEqual([{ x: 100, y: 0, width: 500, height: 1000 }]);
  });

  it('двое делят высоту пополам', () => {
    expect(stackInCell(CELL, 2)).toEqual([
      { x: 100, y: 0, width: 500, height: 500 },
      { x: 100, y: 500, width: 500, height: 500 },
    ]);
  });

  // Без остатка между нижним окном и краем ячейки оставалась бы щель.
  it('нижнему достаётся остаток от деления', () => {
    const out = stackInCell(CELL, 3);
    expect(out.map((b) => b.height)).toEqual([333, 333, 334]);
    expect(out[2].y + out[2].height).toBe(1000);
  });
});

describe('tileByZones', () => {
  const ZONES = [
    { x: 0, y: 0, width: 500, height: 1000 },
    { x: 500, y: 0, width: 500, height: 1000 },
    { x: 1000, y: 0, width: 500, height: 1000 },
    { x: 1500, y: 0, width: 500, height: 1000 },
  ];

  it('одно окно встаёт в первую зону целиком', () => {
    expect(tileByZones(ZONES, 1)).toEqual([{ x: 0, y: 0, width: 500, height: 1000 }]);
  });

  it('по окну на зону', () => {
    expect(tileByZones(ZONES, 4).map((b) => b.x)).toEqual([0, 500, 1000, 1500]);
  });

  it('шесть окон на четыре зоны: две последние делятся пополам', () => {
    expect(tileByZones(ZONES, 6)).toEqual([
      { x: 0, y: 0, width: 500, height: 1000 },
      { x: 500, y: 0, width: 500, height: 1000 },
      { x: 1000, y: 0, width: 500, height: 500 },
      { x: 1000, y: 500, width: 500, height: 500 },
      { x: 1500, y: 0, width: 500, height: 500 },
      { x: 1500, y: 500, width: 500, height: 500 },
    ]);
  });

  it('ноль окон и ноль зон — пусто', () => {
    expect(tileByZones(ZONES, 0)).toEqual([]);
    expect(tileByZones([], 3)).toEqual([]);
  });
});
```

- [x] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run src/claude-layout-helpers.test.js`
Expected: FAIL — `splitCounts is not a function`

- [x] **Step 3: Написать минимальную реализацию**

Дописать в `src/claude-layout-helpers.js` перед строкой `export`:

```js
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
```

И поправить строку экспорта:

```js
export {
  layoutFromName,
  normalizeIds,
  parseArrangePayload,
  splitCounts,
  stackInCell,
  tileByZones,
};
```

- [x] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run src/claude-layout-helpers.test.js`
Expected: PASS, 21 тест

- [x] **Step 5: Коммит**

```bash
git add src/claude-layout-helpers.js src/claude-layout-helpers.test.js
git commit -m "feat(claude-place): плитка по зонам FancyZones"
```

---

### Task 3: Запасная сетка, каскад и общая точка входа

**Files:**
- Modify: `src/claude-layout-helpers.js`
- Test: `src/claude-layout-helpers.test.js`

**Interfaces:**
- Consumes: `splitCounts`, `stackInCell`, `tileByZones` из Task 2
- Produces:
  - `columns(width) → number`
  - `tileGrid(work, n) → Bounds[]`
  - `cascade(work, n) → Bounds[]`
  - `arrange({ mode, zones, work, n }) → Bounds[]` — единственная точка входа для I/O-слоя

- [ ] **Step 1: Написать падающий тест**

Дописать в `src/claude-layout-helpers.test.js`:

```js
import { columns, tileGrid, cascade, arrange } from './claude-layout-helpers.js';

describe('columns', () => {
  // 80 колонок × 10 px + 32 = 832 наименьшая, 120 × 10 + 32 = 1232 наибольшая.
  it('три — идеал на широком экране', () => {
    expect(columns(3440)).toBe(3);
  });

  it('узкий экран режет до двух: терминал не должен стать уже 80 знаков', () => {
    expect(columns(1920)).toBe(2);
  });

  it('на 4K колонок четыре: три дали бы шире 120 знаков', () => {
    expect(columns(3840)).toBe(4);
  });

  it('совсем узкий экран — одна колонка, не ноль', () => {
    expect(columns(800)).toBe(1);
  });
});

describe('tileGrid', () => {
  const WORK = { x: 0, y: 0, width: 1920, height: 1040 };

  // Растянутое на весь экран окно было бы вдвое шире тех 120 знаков, ради
  // которых колонки и считаются.
  it('единственное окно занимает колонку, а не экран', () => {
    expect(tileGrid(WORK, 1)).toEqual([{ x: 0, y: 0, width: 960, height: 1040 }]);
  });

  // Ровно тот случай из README мака: «три окна на узком экране встают как одно
  // во всю высоту слева и два по половине справа».
  it('три окна на двухколоночном экране: слева одно, справа два', () => {
    expect(tileGrid(WORK, 3)).toEqual([
      { x: 0, y: 0, width: 960, height: 1040 },
      { x: 960, y: 0, width: 960, height: 520 },
      { x: 960, y: 520, width: 960, height: 520 },
    ]);
  });

  it('на широком экране три колонки', () => {
    const out = tileGrid({ x: 0, y: 0, width: 3440, height: 1400 }, 3);
    expect(out.map((b) => b.x)).toEqual([0, 1146, 2292]);
    expect(out.every((b) => b.width === 1146)).toBe(true);
  });

  it('нулевая рабочая область — пусто', () => {
    expect(tileGrid({ x: 0, y: 0, width: 0, height: 0 }, 3)).toEqual([]);
  });
});

describe('cascade', () => {
  const WORK = { x: 0, y: 0, width: 1920, height: 1040 };

  // Двум окнам ступенька нужна одна, и отдавать им столько же места, сколько
  // десяти, значит впустую резать высоту.
  it('двум окнам — одна ступенька', () => {
    expect(cascade(WORK, 2)).toEqual([
      { x: 0, y: 0, width: 960, height: 990 },
      { x: 50, y: 50, width: 960, height: 990 },
    ]);
  });

  it('переполненная стопка начинается заново от левого верхнего угла', () => {
    const out = cascade(WORK, 12);
    expect(out[0]).toEqual({ x: 0, y: 0, width: 960, height: 540 });
    expect(out[10]).toEqual({ x: 500, y: 500, width: 960, height: 540 });
    expect(out[11]).toEqual({ x: 0, y: 0, width: 960, height: 540 });
  });

  it('окно не уезжает за края рабочей области', () => {
    for (const b of cascade(WORK, 12)) {
      expect(b.x + b.width).toBeLessThanOrEqual(WORK.width);
      expect(b.y + b.height).toBeLessThanOrEqual(WORK.height);
    }
  });
});

describe('arrange', () => {
  const WORK = { x: 0, y: 0, width: 1920, height: 1040 };
  const ZONES = [{ x: 0, y: 0, width: 960, height: 1040 }];

  it('плитка идёт по зонам, когда они есть', () => {
    expect(arrange({ mode: 'tile', zones: ZONES, work: WORK, n: 1 }))
      .toEqual([{ x: 0, y: 0, width: 960, height: 1040 }]);
  });

  it('без зон плитка считается своей сеткой', () => {
    expect(arrange({ mode: 'tile', zones: [], work: WORK, n: 1 }))
      .toEqual([{ x: 0, y: 0, width: 960, height: 1040 }]);
  });

  // Каскад считает от рабочей области, а не от зон, — даже когда зоны заданы.
  it('каскад зон не касается', () => {
    expect(arrange({ mode: 'cascade', zones: ZONES, work: WORK, n: 1 }))
      .toEqual([{ x: 0, y: 0, width: 960, height: 1040 }]);
  });

  it('ноль окон или нет рабочей области — пусто', () => {
    expect(arrange({ mode: 'tile', zones: [], work: WORK, n: 0 })).toEqual([]);
    expect(arrange({ mode: 'cascade', zones: [], work: null, n: 3 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run src/claude-layout-helpers.test.js`
Expected: FAIL — `columns is not a function`

- [ ] **Step 3: Написать минимальную реализацию**

Дописать в `src/claude-layout-helpers.js` перед строкой экспорта:

```js
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
```

И дописать в блок `export {…}` четыре имени: `columns, tileGrid, cascade, arrange`. Константы наружу не отдаются — их правят здесь же.

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run src/claude-layout-helpers.test.js`
Expected: PASS, 36 тестов

- [ ] **Step 5: Прогнать весь набор — соседние модули не задеты**

Run: `npm test`
Expected: PASS, всё как было плюс новый файл

- [ ] **Step 6: Коммит**

```bash
git add src/claude-layout-helpers.js src/claude-layout-helpers.test.js
git commit -m "feat(claude-place): запасная сетка, каскад и общая точка входа"
```

---

### Task 4: I/O-слой — зоны, рабочая область, окна

**Files:**
- Create: `src/claude-layout.js`
- Modify: `src/monitors.js` (добавить `getPrimaryMonitor`, дописать в блок экспорта в конце файла)
- Modify: `src/lib/index.js` (добавить строку экспорта)
- Modify: `src/index.js:174` (рядом с `const claudeWt = program.command('claude-wt')`)
- Modify: `config.example.yaml` (в блок `claudeWt:`)

**Interfaces:**
- Consumes: `arrange`, `parseArrangePayload` из Task 1–3
- Produces: `arrangeClaudeWindows({ mode, ids, log }) → Promise<{ ok: true, placed: number } | { ok: false, reason: string }>`

Проверяется этот шаг вручную на popstas-pc: юнит-тестов на I/O-слой в этом проекте нет ни у `placement.js`, ни у `fancyzones.js` — они тянут node-window-manager, которого на машине разработчика нет.

- [ ] **Step 1: Добавить `getPrimaryMonitor` в `src/monitors.js`**

После функции `getWindowsMonitors()`:

```js
/** Главный монитор — запасной ответ, когда зоны не сказали, на каком экране считать. */
function getPrimaryMonitor() {
  return getWindowsMonitors().find(mon => mon.isPrimary());
}
```

И дописать `getPrimaryMonitor` в перечень имён во втором блоке `export {…}` в конце файла (там, где `getWindowsMonitors, getMonitor, getMons, …`).

- [ ] **Step 2: Создать `src/claude-layout.js`**

```js
/**
 * Раскладки окон Claude: просьба `claude-place` от пикера и панели.
 *
 * Здесь только то, что ходит наружу — зоны FancyZones, мониторы, список
 * сессий, движение окон. Вся арифметика в claude-layout-helpers.js, и её
 * тесты гоняются на машине без node-window-manager.
 */
import { getConfig } from './config.js';
import { fancyZonesToPos } from './fancyzones.js';
import { getMonitorByPoint, getPrimaryMonitor } from './monitors.js';
import { getWindowById } from './windows.js';
import { placeWindow } from './placement.js';
import { claudeWtSessions } from './claude-wt/view.js';
import { orderSessions } from './claude-wt/ha/session-slots.js';
import { normalizeSort } from './claude-wt/ha/session-groups.js';
import { arrange } from './claude-layout-helpers.js';

/**
 * Зоны из `claudeWt.tileZones`, разрешённые в прямоугольники.
 *
 * Пусто значит «считай своей сеткой», и об этом всегда есть строка warn:
 * протухший editor-parameters.json — известная болезнь этого проекта
 * (AGENTS.md, «Known issues»), и тихий откат спрятал бы её — окна просто
 * встали бы не туда, а человек искал бы причину в зонах.
 *
 * `fancyZonesToPos()` зовётся под try: при ненайденной раскладке
 * `getFancyZoneInfo()` возвращает false, и разбор его на месте бросает
 * TypeError вместо ответа «не нашлось».
 */
function resolveZones(log) {
  const list = getConfig()?.claudeWt?.tileZones;
  if (!Array.isArray(list) || !list.length) {
    log('claude-place: claudeWt.tileZones не задан — считаю своей сеткой', 'warn');
    return [];
  }
  const rects = [];
  for (const zone of list) {
    let rect;
    try {
      rect = fancyZonesToPos(zone);
    } catch (e) {
      log(`claude-place: зона ${JSON.stringify(zone)} — ${e.message}`, 'warn');
    }
    if (!rect) {
      log(`claude-place: зона ${JSON.stringify(zone)} не разрешилась — считаю своей сеткой`, 'warn');
      return [];
    }
    rects.push(rect);
  }
  return rects;
}

/**
 * Рабочая область — экран без панели задач, `MONITORINFO.rcWork`.
 *
 * Монитор ищется по прямоугольнику первой зоны, а не по её номеру: номер в
 * tileZones — номер монитора FancyZones (getSortedMonitors по
 * editor-parameters.json), а getMons() нумерует по config.monitors. Это две
 * разные нумерации, и сводить их здесь — заводить третье место, где они
 * разойдутся.
 */
function layoutWorkArea(rects) {
  const mon = (rects[0] && getMonitorByPoint(rects[0])) || getPrimaryMonitor();
  if (!mon) return null;
  return mon.getWorkArea?.() ?? mon.bounds ?? null;
}

/**
 * Окна, которые надо разложить, в порядке раскладки.
 *
 * `ids` пуст — все открытые сессии порядком этой машины, тем же, каким она
 * рисует панель. `ids` задан — порядок просящего: пикер видит свой список и
 * ждёт, что раскладка ляжет его чередой. Ненайденный id пропускается со
 * строкой в журнал: сессия закрыта или живёт на другой машине, и отменять из-за
 * неё всю просьбу незачем.
 */
function pickWindows(ids, log) {
  let res;
  try {
    res = claudeWtSessions();
  } catch (e) {
    return { error: e.message };
  }
  if (!res.ok) return { error: res.reason };
  const open = res.sessions.filter(s => s.open && s.windowId);
  let chosen;
  if (ids.length) {
    chosen = [];
    for (const id of ids) {
      const session = open.find(s => s.id === id);
      if (!session) {
        log(`claude-place: сессия ${id} здесь не открыта — пропущена`, 'warn');
        continue;
      }
      chosen.push(session);
    }
  } else {
    chosen = orderSessions(open, normalizeSort(getConfig()?.homeassistant?.sessionsSort));
  }
  const windows = [];
  for (const session of chosen) {
    const w = getWindowById(session.windowId);
    if (!w) {
      log(`claude-place: окно сессии ${session.id} исчезло — пропущено`, 'warn');
      continue;
    }
    windows.push(w);
  }
  return { windows, asked: ids.length || open.length };
}

/**
 * Разложить окна сессий Claude плиткой или каскадом.
 *
 * Двигает `placeWindow()`, а не голый `setBounds()`: он уже умеет пропуск
 * свёрнутых окон, пропуск «уже стоит там», поправку масштаба при переезде
 * между экранами с разным DPI, повтор при промахе и строку журнала в
 * привычном формате `from → to`. Второй раз поправлять масштаб здесь нельзя.
 *
 * `isBulk: true` глушит bringToTop() внутри: плитке он не нужен вовсе
 * (перекрытий нет), а каскаду нужен порядком, поэтому окна поднимаются
 * отдельным проходом — в порядке списка, так что последнее оказывается сверху.
 */
async function arrangeClaudeWindows({ mode, ids = [], log = () => {} }) {
  const zones = resolveZones(log);
  const work = layoutWorkArea(zones);
  if (!work && (mode === 'cascade' || !zones.length)) {
    return { ok: false, reason: 'не найден монитор для раскладки' };
  }
  const { error, windows, asked } = pickWindows(ids, log);
  if (error) return { ok: false, reason: error };
  if (!windows.length) return { ok: false, reason: 'открытых сессий claude нет' };

  const rects = arrange({ mode, zones, work, n: windows.length });
  for (let i = 0; i < windows.length; i += 1) {
    const pos = rects[i];
    if (!pos) break;
    // Одно упавшее окно не обрывает остальные — та же сетка, что в
    // placeWindowsByConfig(): процесс окна мог умереть между перечислением и
    // расстановкой.
    await placeWindow({ w: windows[i], rule: { pos }, isBulk: true })
      .catch(e => log(`claude-place: ${windows[i].id} — ${e.message}`, 'error'));
  }
  if (mode === 'cascade') {
    for (const w of windows) {
      try {
        w.bringToTop();
      } catch (e) {
        log(`claude-place: ${w.id} не поднялось — ${e.message}`, 'warn');
      }
    }
  }
  log(`claude-place ${mode}: разложено ${windows.length} из ${asked}`);
  return { ok: true, placed: windows.length };
}

export { arrangeClaudeWindows };
```

- [ ] **Step 3: Отдать функцию в `winMan`**

В `src/lib/index.js` дописать после строки `export * from '../placement.js';`:

```js
export * from '../claude-layout.js';
```

- [ ] **Step 4: Добавить команду CLI**

В `src/index.js`, сразу после `claudeWt.command('status')…` и до `claudeWt.command('restore')`:

```js
  claudeWt
    .command('place <mode>')
    .description('разложить окна сессий claude: tile | cascade')
    .action(async (mode) => {
      const { parseArrangePayload } = await import('./claude-layout-helpers.js');
      const parsed = parseArrangePayload(mode);
      if (!parsed) {
        console.log(`unknown layout: ${mode} (ожидается tile или cascade)`);
        process.exit(1);
      }
      const res = await winMan.arrangeClaudeWindows({
        mode: parsed.mode,
        log: (message) => console.log(message),
      });
      if (!res.ok) {
        console.log(res.reason);
        process.exit(1);
      }
      process.exit(0);
    });
```

- [ ] **Step 5: Описать ключ конфига**

В `config.example.yaml`, в блок `claudeWt:` — после строки `terminalExecutables: []`:

```yaml
  # Зоны FancyZones под терминалы claude, по порядку. Порядок списка — порядок
  # окон: первое окно списка (самое верхнее в пикере) встаёт в первую зону.
  # Окон меньше зон — занимаются первые, остальные пустые; больше — последние
  # зоны делятся по высоте. Форма пары та же, что у rule.fancyZones.
  # Ключа нет или зона не нашлась — плитка считается своей сеткой из колонок по
  # 80–120 знаков, и в журнал уходит строка warn с причиной.
  # tileZones:
  #   - { monitor: 1, position: 6 }
  #   - { monitor: 1, position: 7 }
  #   - { monitor: 1, position: 8 }
  #   - { monitor: 1, position: 9 }
```

- [ ] **Step 6: Убедиться, что ничего не сломано**

Run: `npm test`
Expected: PASS — новых тестов здесь нет, но `src/lib/index.js` и `src/monitors.js` не должны сломать существующие

- [ ] **Step 7: Коммит**

```bash
git add src/claude-layout.js src/monitors.js src/lib/index.js src/index.js config.example.yaml
git commit -m "feat(claude-place): зоны, рабочая область и движение окон"
```

---

### Task 5: Команда `claude-place`

**Files:**
- Modify: `src/commands/claude-commands.js` (импорт вверху, обработчик в объекте `return {…}`)
- Modify: `src/commands/build.js` (в объект `map`)
- Test: `src/commands/claude-commands.test.js`, `src/commands/build.test.js`

**Interfaces:**
- Consumes: `winMan.arrangeClaudeWindows(...)` из Task 4, `parseArrangePayload` из Task 1
- Produces: ключ `'claude-place'` в карте команд — его сразу видят оба транспорта, MQTT и HTTP

- [ ] **Step 1: Написать падающий тест**

Дописать в конец `src/commands/claude-commands.test.js`. Мок `arrangeClaudeWindows` надо добавить и в общий `deps()` — в объект `winMan`, рядом с `restoreClaudeSessions`:

```js
      arrangeClaudeWindows: vi.fn().mockResolvedValue({ ok: true, placed: 2 }),
```

Сами тесты:

```js
describe('claude-place', () => {
  it('передаёт раскладку и список из объекта', async () => {
    const d = deps();
    await claudeCommands(d)['claude-place']({ mode: 'tile', ids: ['a', 'b'] });
    expect(d.winMan.arrangeClaudeWindows).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'tile', ids: ['a', 'b'] }),
    );
  });

  // Так шлёт панель openHASP: голое слово в теле топика.
  it('принимает сырую строку', async () => {
    const d = deps();
    await claudeCommands(d)['claude-place']('cascade');
    expect(d.winMan.arrangeClaudeWindows).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'cascade', ids: [] }),
    );
  });

  it('незнакомая раскладка — жалоба в журнал и ни одного движения', async () => {
    const d = deps();
    await claudeCommands(d)['claude-place']('mosaic');
    expect(d.winMan.arrangeClaudeWindows).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('mosaic'), 'warn');
  });

  it('отказ раскладки доходит до человека', async () => {
    const d = deps({
      winMan: { arrangeClaudeWindows: vi.fn().mockResolvedValue({ ok: false, reason: 'открытых сессий claude нет' }) },
    });
    await claudeCommands(d)['claude-place']('tile');
    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('открытых сессий claude нет'));
  });

  it('исключение не роняет обработчик', async () => {
    const d = deps({
      winMan: { arrangeClaudeWindows: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    await claudeCommands(d)['claude-place']('tile');
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('boom'), 'error');
    expect(d.notify).toHaveBeenCalled();
  });
});
```

И в `src/commands/build.test.js` — проверка, что команда попала в карту. Мок там свой, в функции `winManStub()`; дописать в неё рядом с `restoreClaudeSessions`:

```js
    arrangeClaudeWindows: vi.fn().mockResolvedValue({ ok: true, placed: 0 }),
```

Сам тест — внутрь существующего `describe('buildCommandMap', …)`, где уже есть `const map = makeMap();`:

```js
  it('содержит claude-place', () => {
    expect(typeof map['claude-place']).toBe('function');
  });
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `npx vitest run src/commands/claude-commands.test.js src/commands/build.test.js`
Expected: FAIL — `claudeCommands(d)['claude-place'] is not a function`

- [ ] **Step 3: Написать обработчик**

В `src/commands/claude-commands.js` — импорт после существующих:

```js
import { parseArrangePayload } from '../claude-layout-helpers.js';
```

И в объект `return {…}`, после `'claude-focus': focus,`:

```js
    /**
     * Разложить окна сессий плиткой или каскадом.
     *
     * Тело разбирается тремя видами, как у мака: объект от пикера, json-строка
     * и голое слово с панели openHASP. Успех в журнал пишет сам
     * arrangeClaudeWindows — он один знает, сколько окон нашлось; сюда доходят
     * только отказы, и они идут ещё и человеком, потому что у публикации в
     * MQTT ответа нет и молчание неотличимо от успеха.
     */
    async 'claude-place'(payload) {
      const parsed = parseArrangePayload(payload);
      if (!parsed) {
        log(`claude-place: тело не разобрано — ${JSON.stringify(payload)}`, 'warn');
        return;
      }
      let res;
      try {
        res = await winMan.arrangeClaudeWindows({ mode: parsed.mode, ids: parsed.ids, log });
      } catch (e) {
        log(`claude-place ${parsed.mode}: ${e.message}`, 'error');
        notify(`claude-wt: ошибка раскладки — ${e.message}`);
        return;
      }
      if (!res?.ok) {
        const reason = res?.reason ?? 'не удалось разложить';
        log(`claude-place ${parsed.mode}: ${reason}`, 'warn');
        notify(`claude-wt: ${reason}`);
      }
    },
```

- [ ] **Step 4: Зарегистрировать команду**

В `src/commands/build.js`, в объект `map` — после строки с `'claude-focus': withRefresh(...)`:

```js
    // Ограничитель по той же причине, что у claude-focus-slot: источник —
    // палец на панели openHASP, а каждая раскладка — десяток setBounds()
    // подряд, то есть настоящая работа.
    'claude-place': throttlePress(claude['claude-place'], {
      onDrop: (payload) => log(`claude-place ${payload} — отброшено, не чаще раза в секунду`, 'warn'),
    }),
```

- [ ] **Step 5: Запустить тесты и убедиться, что они проходят**

Run: `npx vitest run src/commands/claude-commands.test.js src/commands/build.test.js`
Expected: PASS

- [ ] **Step 6: Прогнать весь набор**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Коммит**

```bash
git add src/commands/claude-commands.js src/commands/claude-commands.test.js src/commands/build.js src/commands/build.test.js
git commit -m "feat(claude-place): просьба claude-place по MQTT"
```

---

### Task 6: Документация

**Files:**
- Modify: `AGENTS.md` (новый раздел после «claude-wt polling budget»)

- [ ] **Step 1: Дописать раздел в `AGENTS.md`**

```markdown
## Раскладки claude-place

Просьба `claude-place` раскладывает окна сессий Claude плиткой или каскадом.
Имена команды, форма тела (`{"mode": "tile"|"cascade", "ids": [...]}`, json-строка,
голое слово) и правила раскладок взяты у `macos-windows-manager` **как есть** —
кнопки в ccfzf-picker и на панели openHASP одни на все хосты, и разойтись с
маком в разборе одного топика значит отлаживать сразу на двух машинах. Меняя
что-то здесь, меняйте и там (`crates/mwm-core/src/{layout,request}.rs`).

- Вся арифметика — `src/claude-layout-helpers.js`, чистая и с юнит-тестами.
  Там же правятся `COL_PX` (ширина знака) и `CHROME_PX` (рамка и полоса
  прокрутки): оба заведомо приблизительны и меряются на живой машине.
- Всё, что ходит наружу, — `src/claude-layout.js`: зоны, мониторы, сессии,
  движение окон через `placeWindow()`.
- **Плитка идёт по зонам FancyZones**, а не по своей сетке: зоны уже нарисованы
  человеком, и делить монитор второй раз — значит спорить с ним. Список зон —
  `claudeWt.tileZones`, порядок списка задаёт порядок окон.
- Своя сетка (порт маковской, колонки по 80–120 знаков) — запасной путь для
  машины без FancyZones. Откат **всегда** пишет строку `warn` с причиной:
  протухший `editor-parameters.json` — известная болезнь (см. «Known issues»
  выше), и тихий откат прятал бы её.
- Каскад считает от рабочей области (`MONITORINFO.rcWork`, монитор первой зоны,
  иначе главный), зон он не касается.
- Отладка без брокера: `node src/index.js claude-wt place tile|cascade`.
```

- [ ] **Step 2: Проверить, что ссылки в тексте не врут**

Run: `ls src/claude-layout-helpers.js src/claude-layout.js && grep -n "COL_PX\|CHROME_PX" src/claude-layout-helpers.js && grep -nF "place <mode>" src/index.js`
Expected: все три находятся

- [ ] **Step 3: Коммит**

```bash
git add AGENTS.md
git commit -m "docs: раскладки claude-place в AGENTS.md"
```

---

## Ручная проверка на popstas-pc

Юнит-тесты не трогают ни node-window-manager, ни FancyZones, поэтому после
Task 6 нужен прогон на живой машине (`ssh popstas-pc`, `./data/scripts/deploy-pc.sh`):

1. `node src/index.js claude-wt place tile` при трёх-четырёх открытых сессиях —
   окна встают в зоны из `tileZones`, порядком панели.
2. То же с числом окон больше числа зон — последние зоны делятся по высоте.
3. `node src/index.js claude-wt place cascade` — стопка со ступенькой 50,
   последнее окно сверху, ничего не уехало под панель задач.
4. Закомментировать `tileZones` и повторить п.1 — своя сетка плюс строка `warn`
   в `data/windows11-manager.log`.
5. Публикация в MQTT голым словом `tile` в топик `<base>/claude-place` — панель
   openHASP шлёт именно её.
6. Два нажатия подряд — второе отброшено с сообщением про «не чаще раза в
   секунду».
