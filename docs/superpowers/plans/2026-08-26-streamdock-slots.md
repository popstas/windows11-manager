# Слоты claude-wt на StreamDock — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** пять кнопок физической доски StreamDock показывают сессии Claude Code картинкой 128×128 и поднимают окно сессии нажатием.

**Architecture:** слушатель http уже работает внутри служебного процесса (`src/http-server.js`, порт `httpPort`, умолчание 9722). К нему добавляются два пути — картинка слота по GET и нажатие по POST. Слоты строит новый модуль `src/claude-wt/dock/` тем же `buildSlots`, каким живёт экспорт в Home Assistant, и держит **один** снимок на обе дороги: картинка и нажатие обязаны приходить из одного снимка, иначе кнопка поднимет не ту сессию, которая на ней нарисована. Картинка — SVG-строка, форматирование текста, без растра и без шрифтов в зависимостях.

**Tech Stack:** Node 20+ ESM, vitest (тесты рядом с кодом, `*.test.js`), Vue 3 + TypeScript в плагине StreamDock.

**Spec:** [`docs/superpowers/specs/2026-08-26-streamdock-slots-design.md`](../specs/2026-08-26-streamdock-slots-design.md)

## Global Constraints

- **Комментарии, названия тестов и сообщения `assert` — по-русски**, всё видимое человеку — по-английски. Комментарий объясняет «почему», а не «что».
- **Ключ конфига `streamdock` — верхнего уровня**, рядом с `homeassistant` и `httpPort`. Внутри `claudeWt` он молча ничего не сделает — та же беда уже случалась с `placeWindowOnOpen`, `publishStats` и `homeassistant`.
- **Живой конфиг** — `C:\Users\popstas\AppData\Roaming\windows-mqtt\windows11-manager.config.yaml` (первый путь в `configCandidates()`). `config.example.yaml` не читается никогда: ключ переносится руками, это шаг задачи 8.
- **Умолчания слотов:** `slots: 5`, `interval: 10` (секунд), `sort: recent`, `openOnly: true`.
- **Цвета фона:** `active #2e7d32`, `question #b26a00`, `review #c62828`, `idle #3a3a3e`, `closed #26262a`, `empty #141416`. Знаки только ASCII: `>`, `?`, `!`, `-`, `x`.
- **Ничего в `src/claude-wt/ha/` не правим.** Экспорт в Home Assistant и панель openHASP этой задачей не затрагиваются вовсе; из него только импортируются чистые функции.
- **Тесты гоняются `npm test`** (vitest), поштучно — `npx vitest run <файл>`.

---

### Task 1: Картинка слота

**Files:**
- Create: `src/claude-wt/dock/render.js`
- Test: `src/claude-wt/dock/render.test.js`

**Interfaces:**
- Consumes: `basenameOfCwd(cwd)` из `src/claude-wt/project-helpers.js` (чистый помощник, тянет только `wt-profile-helpers.js`); форму слота из `buildSlots` — поля `slot`, `title`, `cwd`, `status`, `contextPct`.
- Produces: `slotSvg(slot, { size = 128 } = {}) -> string` — экспорт по имени из `src/claude-wt/dock/render.js`.

- [ ] **Step 1: Написать падающий тест**

```js
// src/claude-wt/dock/render.test.js
import { describe, it, expect } from 'vitest';
import { slotSvg } from './render.js';

const slot = (over = {}) => ({
  slot: 1,
  title: 'ccfzf picker',
  cwd: '/home/popstas/projects/js/ccfzf-picker',
  status: 'active',
  contextPct: 42,
  ...over,
});

describe('slotSvg', () => {
  it('размер вшит в документ: кнопка ровно 128 на 128', () => {
    // Плагин ужимает всё, что больше, канвасом; наш SVG приходит готовым и
    // мимо ресайза — размер обязан стоять в самой картинке.
    const svg = slotSvg(slot());
    expect(svg).toContain('width="128"');
    expect(svg).toContain('height="128"');
    expect(svg).toContain('viewBox="0 0 128 128"');
  });

  it('фон красится состоянием — по цвету на каждое', () => {
    const bg = (status) => slotSvg(slot({ status })).match(/<rect[^>]*fill="(#[0-9a-f]{6})"/)[1];
    expect(bg('active')).toBe('#2e7d32');
    expect(bg('question')).toBe('#b26a00');
    expect(bg('review')).toBe('#c62828');
    expect(bg('idle')).toBe('#3a3a3e');
    expect(bg('closed')).toBe('#26262a');
    expect(bg('empty')).toBe('#141416');
  });

  it('на кнопке всё, ради чего в неё смотрят: проект, имя, процент, знак', () => {
    const svg = slotSvg(slot());
    expect(svg).toContain('ccfzf-picker');
    expect(svg).toContain('ccfzf');
    expect(svg).toContain('42%');
    expect(svg).toContain('&gt;');
  });

  it('амперсанд в имени экранируется, а не ломает документ', () => {
    // Имя приходит от человека и от агента. Один сырой `&` — и StreamDock не
    // разберёт картинку вовсе: кнопка погаснет молча.
    const svg = slotSvg(slot({ title: 'a & b <c>' }));
    expect(svg).toContain('&amp;');
    expect(svg).not.toMatch(/[^&]& /);
    expect(svg).toContain('&lt;c&gt;');
  });

  it('длинное имя переносится на две строки и обрезается, а не вылезает за кнопку', () => {
    const svg = slotSvg(slot({ title: 'очень длинное имя сессии которое никуда не влезает целиком' }));
    const lines = [...svg.matchAll(/font-size="15"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(lines.length).toBe(2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(13);
    expect(lines[1]).toContain('…');
  });

  it('пустой слот несёт свой номер: видно, что кнопка настроена, а сессии нет', () => {
    const svg = slotSvg({ slot: 4, status: 'empty', title: '', cwd: '', contextPct: 0 });
    expect(svg).toContain('#141416');
    expect(svg).toContain('>4<');
  });

  it('процента нет — ноль, а не пустое место', () => {
    // Перехват статуслайна стоит не у всех, и пустая строка на месте числа
    // читается как «кнопка сломалась».
    expect(slotSvg(slot({ contextPct: 0 }))).toContain('0%');
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd /home/popstas/projects/js/windows11-manager && npx vitest run src/claude-wt/dock/render.test.js`
Expected: FAIL — `Failed to resolve import "./render.js"`.

- [ ] **Step 3: Написать модуль**

```js
// src/claude-wt/dock/render.js
/**
 * Картинка слота для физической кнопки StreamDock. Чистая, без I/O.
 *
 * SVG, а не растр: рендер картинки на сервере — это шрифт в зависимостях, а
 * `setImage` у плагина и без того кормится SVG-data-URI (`httpButton` так
 * рисует свои кнопки уже сейчас).
 */
import { basenameOfCwd } from '../project-helpers.js';

// Цвет несёт состояние целиком: кнопку видно с двух метров, а текст на ней —
// нет. Оттенки приглушены нарочно — пять горящих кнопок рядом не должны
// сливаться в одно пятно.
const BG = {
  active: '#2e7d32',
  question: '#b26a00',
  review: '#c62828',
  idle: '#3a3a3e',
  closed: '#26262a',
  empty: '#141416',
};

// Только ASCII. Тот же довод, что у знаков на панели openHASP: во встроенных
// шрифтах нет ни ▶, ни ·, а рисует картинку чужая программа, о шрифтах которой
// мы ничего не знаем.
const GLYPH = {
  active: '>',
  question: '?',
  review: '!',
  idle: '-',
  closed: 'x',
  empty: '',
};

const FONT = "'Segoe UI', Roboto, sans-serif";

// Ширина текста на сервере не измеряется ничем, поэтому считается по числу
// знаков: у Segoe UI средняя ширина близка к 0.55em, и кегль 15 на 112 px
// полезной ширины — это тринадцать знаков в строке. Та же приблизительность
// уже работает в makeKeySvg плагина.
const TITLE_CHARS = 13;
const TITLE_LINES = 2;
const PROJECT_CHARS = 17;

function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fit(text, maxChars) {
  const s = String(text ?? '').trim();
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 1))}…`;
}

/** Перенос по словам. Слово длиннее строки не делится по слогам — обрезается. */
function wrap(text, maxChars, maxLines) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = [''];
  for (const word of words) {
    const last = lines[lines.length - 1];
    const next = last ? `${last} ${word}` : word;
    if (next.length <= maxChars) {
      lines[lines.length - 1] = next;
      continue;
    }
    if (lines.length === maxLines) {
      // Место кончилось, а текст — нет: хвост показывает многоточие, иначе
      // обрезанное имя читается как полное.
      lines[lines.length - 1] = fit(next, maxChars);
      break;
    }
    lines.push(word);
  }
  return lines.map((line) => fit(line, maxChars)).filter(Boolean);
}

function open(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">`;
}

function slotSvg(slot, { size = 128 } = {}) {
  const status = BG[slot?.status] ? slot.status : 'empty';
  const bg = `<rect width="128" height="128" fill="${BG[status]}"/>`;

  if (status === 'empty') {
    const n = Number(slot?.slot) || '';
    return [
      open(size),
      bg,
      `<text x="64" y="76" text-anchor="middle" font-family="${FONT}" font-size="30" fill="#3a3a3e">${esc(n)}</text>`,
      '</svg>',
    ].join('');
  }

  const project = fit(basenameOfCwd(slot?.cwd), PROJECT_CHARS);
  const title = wrap(slot?.title, TITLE_CHARS, TITLE_LINES);
  const pct = Number(slot?.contextPct) || 0;

  return [
    open(size),
    bg,
    `<text x="8" y="20" font-family="${FONT}" font-size="11" fill="#ffffff" fill-opacity="0.75">${esc(project)}</text>`,
    ...title.map((line, i) => (
      `<text x="8" y="${48 + i * 19}" font-family="${FONT}" font-size="15" fill="#ffffff">${esc(line)}</text>`
    )),
    `<text x="8" y="118" font-family="${FONT}" font-size="12" fill="#ffffff" fill-opacity="0.75">${pct}%</text>`,
    `<text x="120" y="118" text-anchor="end" font-family="${FONT}" font-size="16" fill="#ffffff">${esc(GLYPH[status])}</text>`,
    '</svg>',
  ].join('');
}

export { slotSvg, BG, GLYPH };
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run src/claude-wt/dock/render.test.js`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/claude-wt/dock/render.js src/claude-wt/dock/render.test.js
git commit -m "feat(streamdock): картинка слота — SVG 128x128 с состоянием фоном"
```

---

### Task 2: Снимок слотов

**Files:**
- Create: `src/claude-wt/dock/slots.js`
- Test: `src/claude-wt/dock/slots.test.js`

**Interfaces:**
- Consumes: `slotSvg(slot)` из задачи 1; `buildSlots(sessions, count, sort)` и `sessionIdForSlot(slots, n)` из `src/claude-wt/ha/session-slots.js`; `labelSessions(sessions)` и `normalizeSort(mode)` из `src/claude-wt/ha/session-groups.js`; `winMan.claudeWtSessions()` → `{ ok, sessions }` либо `{ ok: false, reason }`.
- Produces: `createDock({ winMan, config, log, now = Date.now }) -> null | { count, slots(), svg(n), resolve(n) }`. `svg(n)` — строка либо `null` (номер вне диапазона). `resolve(n)` — `{ id }`, `{ empty: true }` либо `null` (номер вне диапазона). `null` вместо всего объекта — доска выключена.

- [ ] **Step 1: Написать падающий тест**

```js
// src/claude-wt/dock/slots.test.js
import { describe, it, expect } from 'vitest';
import { createDock } from './slots.js';

const session = (over = {}) => ({
  id: 'aaa',
  title: 'alpha',
  cwd: '/home/popstas/projects/js/alpha',
  open: true,
  agentState: 'active',
  agentContextPct: 10,
  lastActivity: 100,
  ...over,
});

function fakeWinMan(sessions) {
  const calls = { count: 0 };
  return {
    calls,
    claudeWtSessions() {
      calls.count += 1;
      return { ok: true, sessions };
    },
  };
}

const CONFIG = { streamdock: { enabled: true, slots: 3, interval: 10 } };

describe('createDock', () => {
  it('блока streamdock нет — доски нет вовсе', () => {
    // Роуты заводятся по наличию доски: без блока в конфиге сервер о них не
    // должен знать, а не отвечать пустыми картинками.
    expect(createDock({ winMan: fakeWinMan([]), config: {}, log: () => {} })).toBe(null);
    expect(createDock({ winMan: fakeWinMan([]), config: { streamdock: { enabled: false } }, log: () => {} })).toBe(null);
  });

  it('снимок живёт свой интервал и не перечитывает дамп на каждую кнопку', () => {
    // Пять кнопок опрашивают картинку каждая по своему таймеру; чтение дампа
    // на каждый запрос означало бы пять чтений сетевого диска подряд.
    let now = 1000;
    const winMan = fakeWinMan([session()]);
    const dock = createDock({ winMan, config: CONFIG, log: () => {}, now: () => now });

    dock.slots();
    dock.slots();
    expect(winMan.calls.count).toBe(1);

    now += 9999;
    dock.slots();
    expect(winMan.calls.count).toBe(1);

    now += 2;
    dock.slots();
    expect(winMan.calls.count).toBe(2);
  });

  it('картинка и нажатие приходят из одного снимка', () => {
    // Главное свойство модуля: иначе кнопка поднимет не ту сессию, которая на
    // ней нарисована.
    let now = 1000;
    const sessions = [session({ id: 'first', title: 'first' })];
    const winMan = {
      claudeWtSessions: () => ({ ok: true, sessions }),
    };
    const dock = createDock({ winMan, config: CONFIG, log: () => {}, now: () => now });

    expect(dock.svg(1)).toContain('first');
    sessions[0] = session({ id: 'second', title: 'second' });
    expect(dock.resolve(1)).toEqual({ id: 'first' });
  });

  it('пустой слот — не ошибка, а пустая кнопка', () => {
    const dock = createDock({ winMan: fakeWinMan([]), config: CONFIG, log: () => {} });
    expect(dock.resolve(2)).toEqual({ empty: true });
    expect(dock.svg(2)).toContain('#141416');
  });

  it('номер вне диапазона — null у обеих дорог', () => {
    // Это опечатка в настройке кнопки, и молчать о ней нельзя: сервер отвечает
    // на null четырёхсотчетвёркой.
    const dock = createDock({ winMan: fakeWinMan([session()]), config: CONFIG, log: () => {} });
    expect(dock.svg(0)).toBe(null);
    expect(dock.svg(4)).toBe(null);
    expect(dock.resolve(4)).toBe(null);
    expect(dock.count).toBe(3);
  });

  it('дамп не прочитался — держим прежний снимок, а не гасим кнопки', () => {
    let ok = true;
    const winMan = { claudeWtSessions: () => (ok ? { ok: true, sessions: [session()] } : { ok: false, reason: 'нет файла' }) };
    let now = 1000;
    const logged = [];
    const dock = createDock({ winMan, config: CONFIG, log: (m, lvl) => logged.push(lvl), now: () => now });

    expect(dock.resolve(1)).toEqual({ id: 'aaa' });
    ok = false;
    now += 20000;
    expect(dock.resolve(1)).toEqual({ id: 'aaa' });
    expect(logged).toContain('error');
  });

  it('закрытые сессии в слоты не идут, пока openOnly не снят', () => {
    const winMan = fakeWinMan([session({ id: 'dead', open: false }), session({ id: 'live' })]);
    const dock = createDock({ winMan, config: CONFIG, log: () => {} });
    expect(dock.resolve(1)).toEqual({ id: 'live' });
    expect(dock.resolve(2)).toEqual({ empty: true });
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/claude-wt/dock/slots.test.js`
Expected: FAIL — `Failed to resolve import "./slots.js"`.

- [ ] **Step 3: Написать модуль**

```js
// src/claude-wt/dock/slots.js
/**
 * Слоты физической доски StreamDock.
 *
 * Снимок свой, но строитель — тот же, что у экспорта в Home Assistant
 * (`buildSlots`), и умолчания те же: порядок на доске и на панели обязан
 * совпадать, а разойтись им негде — функция одна.
 *
 * Почему не `haExport.slots()` напрямую: тот наполняется тиком экспорта, а тик
 * заводится только по подключению к брокеру. Доска от брокера не зависит вовсе
 * — слушатель поднимается без mqtt, `focus` локальный, — и, взяв чужой снимок,
 * мы гасили бы кнопки ровно тогда, когда всё нужное для их работы живо.
 */
import { buildSlots, sessionIdForSlot } from '../ha/session-slots.js';
import { labelSessions, normalizeSort } from '../ha/session-groups.js';
import { slotSvg } from './render.js';

const DEFAULT_SLOTS = 5;
const DEFAULT_INTERVAL_SEC = 10;

/**
 * Настройки доски. `null` — доски нет: у сервера тогда нет и роутов.
 *
 * `sort` читается и под именем `sessionsSort`: так этот же ключ называется в
 * блоке `homeassistant`, и человек, скопировавший строку оттуда, получил бы
 * молчаливое умолчание вместо своего порядка.
 */
function dockConfig(config) {
  const raw = config?.streamdock;
  if (!raw || raw.enabled === false) return null;
  return {
    slots: Number(raw.slots) || DEFAULT_SLOTS,
    intervalMs: (Number(raw.interval) || DEFAULT_INTERVAL_SEC) * 1000,
    sort: normalizeSort(raw.sort ?? raw.sessionsSort),
    openOnly: raw.openOnly !== false,
  };
}

function createDock({ winMan, config, log, now = Date.now }) {
  const cfg = dockConfig(config);
  if (!cfg) return null;

  let snapshot = [];
  let takenAt = -Infinity;

  function slots() {
    const at = now();
    if (at - takenAt < cfg.intervalMs) return snapshot;
    let sessions;
    try {
      const res = winMan.claudeWtSessions();
      if (!res.ok) throw new Error(res.reason);
      sessions = labelSessions(res.sessions);
    } catch (e) {
      // Прежний снимок лучше пустых кнопок: дамп на сетевом диске не читается
      // разово чаще, чем ломается насовсем.
      log(`streamdock: сессии не прочитаны — ${e.message}`, 'error');
      return snapshot;
    }
    const forSlots = cfg.openOnly ? sessions.filter((s) => s.open) : sessions;
    snapshot = buildSlots(forSlots, cfg.slots, cfg.sort);
    takenAt = at;
    return snapshot;
  }

  const inRange = (n) => Number.isInteger(n) && n >= 1 && n <= cfg.slots;

  return {
    count: cfg.slots,
    slots,
    svg(n) {
      if (!inRange(n)) return null;
      const slot = slots().find((s) => s.slot === n);
      return slotSvg(slot ?? { slot: n, status: 'empty' });
    },
    resolve(n) {
      if (!inRange(n)) return null;
      const id = sessionIdForSlot(slots(), n);
      return id ? { id } : { empty: true };
    },
  };
}

export { createDock, DEFAULT_SLOTS, DEFAULT_INTERVAL_SEC };
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run src/claude-wt/dock/slots.test.js`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/claude-wt/dock/slots.js src/claude-wt/dock/slots.test.js
git commit -m "feat(streamdock): снимок слотов — один на картинку и на нажатие"
```

---

### Task 3: Команда нажатия

**Files:**
- Modify: `src/commands/build.js` (сигнатура `buildCommandMap`, новая запись в карте)
- Test: `src/commands/build.test.js`

**Interfaces:**
- Consumes: `dock.resolve(n)` из задачи 2; `claude['claude-focus']({ id })` из `claudeCommands`; `throttlePress(handler, { onDrop })` и `DROPPED` из `src/commands/press-throttle.js`; `slotFromPayload(payload)` из `src/commands/claude-commands.js`.
- Produces: команда `claude-dock-press` в карте `buildCommandMap({ ..., dock })`. Тело — `{ slot: n }`. Ответ: `{ id }` либо `{ empty: true }`; отброшенное ограничителем — `DROPPED`.

- [ ] **Step 1: Написать падающий тест**

Тесты дописываются в существующий `describe`-файл и пользуются его же
заглушками: `winManStub()` (все методы — `vi.fn()`) и `makeMap(overrides)`,
который собирает карту с заглушкой `haExport`. Своего набора заглушек рядом не
заводить.

Путь фокуса настоящий, и тест обязан его пройти целиком: `claude-focus` →
`findSession` (`winMan.claudeWtSessions({ brief: true })`) → `chooseAction`
(нужны `open: true`, `windowId`, живой `getWindowById`) → 
`winMan.focusTerminalWindow(windowId, mark)`. Метода `focusTerminalWindow` в
`winManStub()` нет — он дописывается в тесте.

```js
// добавить в src/commands/build.test.js
import { DROPPED } from './press-throttle.js';   // если импорта ещё нет

describe('claude-dock-press', () => {
  const dockWith = (answer) => ({ count: 5, resolve: vi.fn().mockReturnValue(answer) });

  function focusable() {
    const winMan = winManStub();
    winMan.claudeWtSessions.mockReturnValue({
      ok: true,
      sessions: [{ id: 'sess-1', open: true, windowId: 7 }],
    });
    winMan.getWindowById.mockReturnValue({ id: 7 });
    winMan.focusTerminalWindow = vi.fn().mockResolvedValue(true);
    return winMan;
  }

  it('нажатие поднимает окно той сессии, которую назвал снимок доски', async () => {
    const winMan = focusable();
    const dock = dockWith({ id: 'sess-1' });
    const map = makeMap({ winMan, dock });

    const result = await map['claude-dock-press']({ slot: 2 });

    expect(dock.resolve).toHaveBeenCalledWith(2);
    expect(winMan.focusTerminalWindow).toHaveBeenCalledWith(7, expect.anything());
    expect(result).toEqual({ id: 'sess-1' });
  });

  it('пустой слот не зовёт фокус и не молчит', async () => {
    // Нажатие на пустую кнопку — не ошибка транспорта, но и не тишина:
    // человек нажал, а не случилось ничего, и в логе должна остаться строка.
    const winMan = focusable();
    const log = vi.fn();
    const map = makeMap({ winMan, log, dock: dockWith({ empty: true }) });

    expect(await map['claude-dock-press']({ slot: 3 })).toEqual({ empty: true });
    expect(winMan.focusTerminalWindow).not.toHaveBeenCalled();
    expect(log.mock.calls.some(([msg]) => String(msg).includes('3'))).toBe(true);
  });

  it('второе нажатие подряд отбрасывается ограничителем', async () => {
    // Палец, снятый неровно, даёт две-три посылки подряд — та же беда, ради
    // которой ограничитель стоит на claude-focus-slot.
    const map = makeMap({ winMan: focusable(), dock: dockWith({ id: 'sess-1' }) });

    await map['claude-dock-press']({ slot: 1 });
    expect(map['claude-dock-press']({ slot: 1 })).toBe(DROPPED);
  });

  it('доски нет — команда есть, но фокус не зовёт', async () => {
    // Карта одна на оба транспорта, и команда в ней заводится всегда; роутов
    // же без доски нет, поэтому попасть сюда можно только вызовом руками.
    const winMan = focusable();
    const map = makeMap({ winMan });

    expect(await map['claude-dock-press']({ slot: 1 })).toEqual({ empty: true });
    expect(winMan.focusTerminalWindow).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/commands/build.test.js`
Expected: FAIL — `map['claude-dock-press'] is not a function`.

- [ ] **Step 3: Дописать карту команд**

В `buildCommandMap` добавить `dock = null` в разбор аргумента:

```js
function buildCommandMap({ winMan, config, log, notify, haExport, publishDone = () => {}, dock = null }) {
```

И запись в карту, рядом с `claude-focus-slot`:

```js
    // Нажатие на кнопку доски StreamDock. Ограничитель — по той же причине,
    // что у claude-focus-slot: источник тот же, живой палец на физической
    // кнопке. Слот резолвится по снимку доски, а не по снимку панели: у них
    // разные сроки годности, и кнопка обязана значить то, что на ней
    // нарисовано.
    'claude-dock-press': throttlePress(
      withRefresh(async (payload) => {
        const slot = Number(slotFromPayload(payload));
        const found = dock?.resolve(slot) ?? null;
        if (!found || found.empty) {
          log(`streamdock: слот ${slot} пуст`, 'warn');
          return { empty: true };
        }
        await claude['claude-focus']({ id: found.id });
        return { id: found.id };
      }),
      { onDrop: (payload) => log(`claude-dock-press ${payload} — отброшено, не чаще раза в секунду`, 'warn') },
    ),
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run src/commands/build.test.js`
Expected: PASS, включая четыре новых теста.

- [ ] **Step 5: Коммит**

```bash
git add src/commands/build.js src/commands/build.test.js
git commit -m "feat(streamdock): команда нажатия на кнопку доски"
```

---

### Task 4: Роуты картинки и нажатия

**Files:**
- Modify: `src/http-server.js`
- Test: `src/http-server.test.js`

**Interfaces:**
- Consumes: `dock` из задачи 2 (`count`, `svg(n)`); команду `claude-dock-press` из задачи 3 через `router.dispatch`.
- Produces: `startHttpServer({ router, port, log, dock = null })` — тот же возвращаемый `server`, что и раньше. Пути: `GET /claude-wt/slot/<n>.svg`, `POST /claude-wt/slot/<n>/press`.

- [ ] **Step 1: Написать падающий тест**

```js
// добавить в src/http-server.test.js, внутрь describe('startHttpServer')
  const fakeDock = { count: 5, svg: (n) => (n <= 5 ? `<svg data-slot="${n}"></svg>` : null) };

  async function listen(opts) {
    const server = startHttpServer({ port: 0, log: () => {}, ...opts });
    await new Promise((resolve) => server.once('listening', resolve));
    return { server, port: server.address().port };
  }

  it('картинка слота отдаётся по GET как SVG и не кэшируется', async () => {
    // Плагин перечитывает картинку своим таймером; закэшированная кнопка
    // застыла бы на состоянии получасовой давности.
    const { server, port } = await listen({ router: { dispatch: async () => ({ ok: true }) }, dock: fakeDock });

    const res = await fetch(`http://127.0.0.1:${port}/claude-wt/slot/3.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('data-slot="3"');

    server.close();
  });

  it('номер вне диапазона — 404, а не пустая картинка', async () => {
    // Это опечатка в настройке кнопки, и она должна быть видна.
    const { server, port } = await listen({ router: { dispatch: async () => ({ ok: true }) }, dock: fakeDock });
    expect((await fetch(`http://127.0.0.1:${port}/claude-wt/slot/9.svg`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/claude-wt/slot/9/press`, { method: 'POST' })).status).toBe(404);
    server.close();
  });

  it('нажатие доезжает до команды с номером слота из пути', async () => {
    const seen = [];
    const router = { dispatch: async (command, body) => { seen.push([command, body]); return { ok: true, result: { id: 'x' } }; } };
    const { server, port } = await listen({ router, dock: fakeDock });

    const res = await fetch(`http://127.0.0.1:${port}/claude-wt/slot/2/press`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(seen).toEqual([['claude-dock-press', { slot: 2 }]]);
    server.close();
  });

  it('без доски обоих путей нет вовсе', async () => {
    const { server, port } = await listen({ router: { dispatch: async () => ({ ok: true }) } });
    expect((await fetch(`http://127.0.0.1:${port}/claude-wt/slot/1.svg`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/claude-wt/slot/1/press`, { method: 'POST' })).status).toBe(404);
    server.close();
  });

  it('командные пути по GET по-прежнему 405', async () => {
    // Ветка GET заведена ради картинок; открыть по ней роутер команд значило бы
    // отдать перезагрузку и раскладку окон любому, кто откроет ссылку.
    const { server, port } = await listen({ router: { dispatch: async () => ({ ok: true }) }, dock: fakeDock });
    expect((await fetch(`http://127.0.0.1:${port}/claude-wt/focus`)).status).toBe(405);
    server.close();
  });
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/http-server.test.js`
Expected: FAIL — картинка отвечает 405 (сервер принимает только POST).

- [ ] **Step 3: Дописать сервер**

В шапке файла, рядом с `ROUTES`:

```js
/**
 * Пути доски StreamDock. Отдельно от `ROUTES` и не через `routeToCommand`:
 * там точное совпадение пути с командой, а здесь в пути стоит номер слота, и
 * картинка вообще не команда — у неё тело ответа, а не результат роутера.
 */
const SLOT_IMAGE = /^\/claude-wt\/slot\/(\d+)\.svg$/;
const SLOT_PRESS = /^\/claude-wt\/slot\/(\d+)\/press$/;

function slotNumber(url, re) {
  const clean = String(url ?? '').split('?')[0].replace(/\/+$/, '') || '/';
  const match = re.exec(clean);
  return match ? Number(match[1]) : null;
}
```

В `startHttpServer` принять доску и завести ветку GET **до** проверки метода:

```js
function startHttpServer({ router, port = 9722, log, dock = null }) {
  const inDockRange = (n) => Boolean(dock) && Number.isInteger(n) && n >= 1 && n <= dock.count;
  const server = http.createServer(async (req, res) => {
    const notFound = () => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    };

    // Картинка кнопки. Единственный GET на всём сервере: роутер команд по нему
    // не открывается — ниже стоит прежняя проверка метода.
    if (req.method === 'GET') {
      const slot = slotNumber(req.url, SLOT_IMAGE);
      const svg = inDockRange(slot) ? dock.svg(slot) : null;
      if (!svg) {
        notFound();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        // Плагин перечитывает картинку своим таймером, и закэшированная кнопка
        // застыла бы на прошлом состоянии сессии.
        'Cache-Control': 'no-store',
      });
      res.end(svg);
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    // Нажатие на кнопку доски. Номер берётся из пути, а тело не читается
    // вовсе: у кнопки плагина его может не быть, а пустой разбор ответил бы
    // 400 на исправное нажатие.
    const pressSlot = slotNumber(req.url, SLOT_PRESS);
    if (pressSlot !== null) {
      if (!inDockRange(pressSlot)) {
        notFound();
        return;
      }
      const result = await router.dispatch('claude-dock-press', { slot: pressSlot });
      // …далее тот же разбор результата, что и у команд ниже: !ok → 500,
      // DROPPED → 429, иначе 200 с телом.
    }
```

Чтобы разбор результата не оказался написан дважды, вынести хвост нынешнего обработчика в функцию и звать её из обеих веток:

```js
function replyResult(res, log, url, result) {
  if (!result.ok) {
    log(`POST ${url}: ${result.error}`, 'error');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  if (result.result === DROPPED) {
    log(`POST ${url}: отброшено ограничителем частоты`, 'warn');
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'throttled' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, ...(result.result ?? {}) }));
}
```

Комментарий про дребезг платы, стоящий сейчас у ветки `DROPPED`, переезжает в `replyResult` вместе с кодом — он объясняет именно её.

Экспорт дополнить: `export { startHttpServer, routeToCommand, ROUTES, SLOT_IMAGE, SLOT_PRESS };`

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run src/http-server.test.js`
Expected: PASS — прежние тесты (занятый порт, 429) и пять новых.

- [ ] **Step 5: Коммит**

```bash
git add src/http-server.js src/http-server.test.js
git commit -m "feat(streamdock): роуты картинки слота и нажатия"
```

---

### Task 5: Проводка службы, конфиг и документация

**Files:**
- Modify: `src/mqtt/service.js:34-70` (создание доски и передача её в карту команд и в сервер)
- Modify: `config.example.yaml` (блок `streamdock` рядом с `homeassistant`)
- Modify: `AGENTS.md` (раздел `claude-wt`: два новых пути и ключ конфига)
- Test: `src/mqtt/service.test.js`

**Interfaces:**
- Consumes: `createDock({ winMan, config, log })` из задачи 2; `buildCommandMap({ ..., dock })` из задачи 3; `startHttpServer({ ..., dock })` из задачи 4.
- Produces: живой сервер, отдающий картинку слота, когда в конфиге есть блок `streamdock`.

- [ ] **Step 1: Написать падающий тест**

Прочитать `src/mqtt/service.test.js` и повторить его способ поднимать службу с заглушкой `winMan` и без брокера (`env` без `W11M_MQTT_HOST`). Тест ниже вписать в тот же стиль:

```js
// добавить в src/mqtt/service.test.js
it('с блоком streamdock служба отдаёт картинку слота по http', async () => {
  // Сквозная проверка проводки: модули по отдельности уже проверены, а
  // забытый `dock` в одном из двух вызовов не виден ни одному из них.
  const winMan = {
    claudeWtSessions: () => ({
      ok: true,
      sessions: [{ id: 'aaa', title: 'alpha', cwd: '/home/popstas/projects/js/alpha', open: true, agentState: 'active', lastActivity: 1 }],
    }),
  };
  const service = startService({
    winMan,
    config: { httpPort: 0, streamdock: { enabled: true, slots: 5 } },
    log: () => {},
    env: {},
  });

  const res = await fetch(`http://127.0.0.1:${service.httpPort()}/claude-wt/slot/1.svg`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('alpha');

  service.stop();
});
```

Если `startService` в этом тесте поднимается не сразу слушающим, дождаться `listening` тем же приёмом, каким это делают тесты `http-server.test.js`.

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/mqtt/service.test.js`
Expected: FAIL — 404: доска в службе не создаётся.

- [ ] **Step 3: Провести доску через службу**

В `src/mqtt/service.js` добавить импорт и создать доску до роутера:

```js
import { createDock } from '../claude-wt/dock/slots.js';
```

```js
  // Доска StreamDock: физические кнопки с картинками сессий. Брокер ей не
  // нужен — ровно как http-транспорту, автопостановщику и сторожу демона.
  // Блока `streamdock` в конфиге нет — доски нет, и роутов у сервера тоже.
  const dock = createDock({ winMan, config: withBase, log });

  const router = createRouter(buildCommandMap({
    winMan, config: withBase, log, notify, haExport, publishDone, dock,
  }));

  const httpServer = startHttpServer({ router, port: config?.httpPort ?? 9722, log, dock });
```

- [ ] **Step 4: Дописать образец конфига**

В `config.example.yaml`, следом за блоком `homeassistant`:

```yaml
# Физическая доска StreamDock: пять кнопок с картинками сессий.
# Ключ верхнего уровня, как `homeassistant` и `httpPort`; внутри `claudeWt`
# он молча ничего не сделает. Блока нет — роутов картинок нет вовсе.
# Картинка кнопки: GET  http://127.0.0.1:9722/claude-wt/slot/<n>.svg
# Нажатие:        POST http://127.0.0.1:9722/claude-wt/slot/<n>/press
streamdock:
  enabled: true
  # Кнопок в верхнем ряду доски. Порядок и статусы — те же, что у панели
  # openHASP: строитель слотов один на обоих.
  slots: 5
  # Срок годности снимка слотов, в секундах. Картинка и нажатие приходят из
  # одного снимка, поэтому это же и есть возможное отставание кнопки.
  interval: 10
  # cost | oldest | newest | recent | name — тот же список, что у
  # `homeassistant.sessionsSort`.
  sort: recent
  # Только живые сессии: кнопок пять, и каждая, занятая закрытой сессией,
  # вытесняет работающую.
  openOnly: true
```

- [ ] **Step 5: Дописать AGENTS.md**

В раздел `## claude-wt: связка четырёх мест` добавить абзац:

```markdown
**Доска StreamDock висит на том же слушателе.** `GET /claude-wt/slot/<n>.svg`
отдаёт картинку кнопки 128×128 (`src/claude-wt/dock/`), `POST
/claude-wt/slot/<n>/press` поднимает окно сессии этого слота. Слоты строит тот
же `buildSlots`, что и экспорт в Home Assistant, но снимок свой: тик экспорта
заводится по подключению к брокеру, а доске брокер не нужен. Гейт — ключ
`streamdock` **верхнего уровня** конфига; блока нет — обоих путей нет.
Плагин доски живёт отдельно: `/home/popstas/projects/js/streamdock-http-button`.
```

- [ ] **Step 6: Убедиться, что всё проходит**

Run: `npm test`
Expected: PASS целиком, включая прежние тесты службы.

- [ ] **Step 7: Коммит**

```bash
git add src/mqtt/service.js src/mqtt/service.test.js config.example.yaml AGENTS.md
git commit -m "feat(streamdock): доска заводится в службе, ключ streamdock в образце конфига"
```

---

### Task 6: Плагин — действие по нажатию и SVG без ресайза

**Files:**
- Modify: `src/plugin/actions/imageButton.ts` (репозиторий `/home/popstas/projects/js/streamdock-http-button`)
- Modify: `src/pages/actions/imageButton.vue` (там же)

**Interfaces:**
- Consumes: роуты из задач 4–5.
- Produces: настройка `actionUrl` у действия `imageButton`; `POST actionUrl` на `keyUp`/`touchTap`; ответ `image/svg+xml` уходит в `setImage` как есть.

Тестов в этом репозитории нет вовсе (vitest не подключён), заводить их ради двух правок не будем — проверка живая, в задаче 8.

- [ ] **Step 1: Добавить отправку запроса по нажатию**

В `src/plugin/actions/imageButton.ts`, рядом с остальными помощниками:

```ts
  // Действие кнопки: подъём окна сессии на той стороне. Ошибку глотать нельзя
  // молча — на доске не видно ничего, и единственный след остаётся в консоли.
  const sendAction = async (context: string) => {
    const action = plugin.getAction(context);
    const settings = action?.settings as any;
    const actionUrl = settings?.actionUrl || '';
    if (!actionUrl) return;
    try {
      const response = await fetch(actionUrl, { method: 'POST' });
      if (!response.ok) {
        console.warn(`[ImageButton] Action URL answered ${response.status}: ${actionUrl}`);
      }
    } catch (error) {
      console.error(`[ImageButton] Action request failed for ${actionUrl}:`, error);
    }
  };
```

И в обоих обработчиках нажатия — сначала действие, потом уже существующее принудительное обновление картинки:

```ts
    keyUp({ context, payload }) {
      console.log(`[ImageButton] Button pressed (keyUp): ${context}`);
      // Сначала подъём окна: человек нажал ради него. Обновление следом
      // покажет уже снятое «требует внимания».
      sendAction(context).finally(() => {
        imageUrlMap.delete(context);
        loadImageContent(context, true);
      });
    },
    touchTap({ context, payload }) {
      console.log(`[ImageButton] Button pressed (touchTap): ${context}`);
      sendAction(context).finally(() => {
        imageUrlMap.delete(context);
        loadImageContent(context, true);
      });
    }
```

- [ ] **Step 2: Пропустить SVG мимо канваса**

В `loadImageContent`, там где сейчас безусловно зовётся `resizeAndCropImage`, поставить развилку по типу ответа. Тип запомнить при чтении ответа:

```ts
        const contentType = response.headers.get('content-type') || '';
        const blob = await response.blob();
        // …существующее превращение blob в dataUrl…

        // SVG уходит в setImage как есть. Канвас в resizeAndCropImage
        // полагается на intrinsic-размеры картинки, а у SVG они бывают
        // пустыми — кнопка тогда гаснет молча. Наш SVG и без того ровно
        // 128×128, ужимать его нечем и незачем.
        const isSvg = contentType.includes('image/svg+xml');
        let processedDataUrl = dataUrl;
        if (!isSvg) {
          try {
            processedDataUrl = await resizeAndCropImage(dataUrl);
            console.log('[ImageButton] Image resized and cropped to 128x128');
          } catch (error) {
            console.warn('[ImageButton] Failed to resize/crop image, using original:', error);
          }
        }
```

Сохранение картинки в файл (`saveImageToFile`) остаётся как есть: оно и сейчас тихо не работает вне dev-сервера.

- [ ] **Step 3: Добавить поле в настройки**

В `src/pages/actions/imageButton.vue` — по образцу соседних полей, все четыре места:

```ts
  const actionUrl = ref('');
```

в `watch(() => property.settings, …)`:

```ts
        if ((newSettings as any).actionUrl !== undefined) {
          actionUrl.value = (newSettings as any).actionUrl || '';
        }
```

в `saveConfig`:

```ts
        actionUrl: actionUrl.value || '',
```

в `useWatchEvent({ didReceiveSettings … })`:

```ts
        if (settings.actionUrl !== undefined) {
          actionUrl.value = settings.actionUrl || '';
        }
```

и вкладка в шаблоне, следом за `Img Source`:

```html
    <TabView label="Action">
      <div class="field-wrapper">
        <label class="field-label">Action URL:</label>
        <input
          v-model="actionUrl"
          placeholder="http://127.0.0.1:9722/claude-wt/slot/1/press"
          class="field-input text-input"
          :disabled="saving"
        />
        <div class="field-help">
          URL to POST when the button is pressed. Leave empty to only refresh the image.
        </div>
      </div>
    </TabView>
```

- [ ] **Step 4: Проверить, что проект собирается**

Run: `cd /home/popstas/projects/js/streamdock-http-button && npx vite build`
Expected: сборка без ошибок TypeScript.

`npm run build` здесь звать **нельзя**: следом за `vite build` он зовёт `script/autofile.cjs`, а тот копирует результат в `%APPDATA%\HotSpot\StreamDock\plugins\…` и на Linux падает на `path.join(undefined, …)`. На целевой машине это и есть нужный шаг — см. задачу 7.

- [ ] **Step 5: Коммит**

```bash
cd /home/popstas/projects/js/streamdock-http-button
git add src/plugin/actions/imageButton.ts src/pages/actions/imageButton.vue
git commit -m "feat(imageButton): action URL on press and SVG images without canvas resize"
```

Сообщения коммитов в этом репозитории английские — здесь так уже принято, посмотреть `git log --oneline -10` перед коммитом и повторить принятый стиль.

---

### Task 7: Скрипт выкатки плагина

**Files:**
- Create: `data/scripts/deploy-win.sh` в `/home/popstas/projects/js/streamdock-http-button` (каталог `data/` там уже в `.gitignore` — файл вне git, как и у соседей)

**Interfaces:**
- Consumes: `npm run build` в репозитории плагина; `script/autofile.cjs`, который сам копирует `dist` в каталог плагинов StreamDock.
- Produces: `./data/scripts/deploy-win.sh` с флагами `--no-build`, `--no-launch`.

Проверенные факты о целевой машине (снято 2026-08-26): репозиторий — `D:\projects\js\streamdock-http-button`, node v24.12.0, npm 11.4.2, `StreamDock.exe` — `C:\Program Files (x86)\StreamDock\StreamDock.exe`, работает в сессии Console 1, каталог плагина — `C:\Users\popstas\AppData\Roaming\HotSpot\StreamDock\plugins\pro.popstas.httpbutton.sdPlugin`.

- [ ] **Step 1: Написать скрипт**

```bash
#!/usr/bin/env bash
#
# Выкатка плагина StreamDock на popstas-pc (Windows 11).
#
# Копировать dist руками не надо и не следует: `script/autofile.cjs` последним
# шагом сам сносит %APPDATA%\HotSpot\StreamDock\plugins\<PUUID>.sdPlugin и
# кладёт туда свежую сборку. Продублируй путь здесь — и он разойдётся с
# плагином при первом же переименовании UUID.
#
# Запуск идёт через schtasks, а не напрямую: служба OpenSSH на Windows сажает
# сессию в session 0 (services), а рабочий стол человека — в session 1
# (console). StreamDock — это программа с окном и физической доской: запущенная
# прямо из ssh, она попала бы туда, где ни того, ни другого нет.
#
# Плагины StreamDock читает при старте, поэтому программа гасится и
# поднимается заново — иначе на доске остаётся прежняя сборка.
#
# Скрипт вне git (data/ в .gitignore): он знает имена хостов и пути этой
# установки, а не проекта.
#
#   ./data/scripts/deploy-win.sh              # обновить, собрать, перезапустить
#   ./data/scripts/deploy-win.sh --no-build   # только перезапустить собранное
#   ./data/scripts/deploy-win.sh --no-launch  # собрать, но не перезапускать
#
set -euo pipefail

TARGET_HOST=${TARGET_HOST:-popstas-pc}
REPO=${REPO:-'D:\projects\js\streamdock-http-button'}
BRANCH=${BRANCH:-master}
TASK_NAME=${TASK_NAME:-streamdock}
WIN_USER=${WIN_USER:-popstas}
APP=${APP:-'C:\Program Files (x86)\StreamDock\StreamDock.exe'}

do_build=1
do_launch=1
for arg in "$@"; do
  case "$arg" in
    --no-build)  do_build=0 ;;
    --no-launch) do_launch=0 ;;
    *) echo "неизвестный аргумент: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
win() { ssh "$TARGET_HOST" "$@"; }

if [ "$do_build" = 1 ]; then
  say "обновление репозитория на $TARGET_HOST"
  win "cd /d $REPO && git fetch origin && git checkout $BRANCH && git pull --ff-only"
  win "cd /d $REPO && git log --oneline -1"

  # npm ci, а не install: сборка обязана повторяться, а не собирать то, что
  # оказалось в кэше машины.
  say "зависимости"
  win "cd /d $REPO && npm ci"

  # autofile.cjs внутри `npm run build` сам разложит dist по каталогу плагинов.
  say "сборка"
  win "cd /d $REPO && npm run build"
fi

say "проверка разложенного плагина"
win "if exist \"C:\\Users\\$WIN_USER\\AppData\\Roaming\\HotSpot\\StreamDock\\plugins\\pro.popstas.httpbutton.sdPlugin\\manifest.json\" (echo PLUGIN_OK) else (echo PLUGIN_MISSING && exit 1)"

if [ "$do_launch" = 1 ]; then
  say "регистрация задачи $TASK_NAME"
  win "schtasks /create /tn $TASK_NAME /tr \"$APP\" /sc once /st 00:00 /ru $WIN_USER /it /f"

  say "остановка StreamDock"
  win "taskkill /IM StreamDock.exe /F" || true

  say "запуск в интерактивной сессии"
  win "schtasks /run /tn $TASK_NAME"

  # schtasks /run возвращается, не дожидаясь запуска; проверка отдельным ssh
  # стоит своих сотен миллисекунд, но программа с окном поднимается дольше
  # трея — секунда здесь не запас, а необходимость.
  sleep 1
  say "проверка"
  win "tasklist /FI \"IMAGENAME eq StreamDock.exe\" /FO LIST | findstr /I \"PID Session\"" \
    || { echo "StreamDock не поднялся" >&2; exit 1; }
fi

say "готово"
```

- [ ] **Step 2: Сделать исполняемым**

```bash
chmod +x /home/popstas/projects/js/streamdock-http-button/data/scripts/deploy-win.sh
```

- [ ] **Step 3: Убедиться, что файл вне git**

Run: `cd /home/popstas/projects/js/streamdock-http-button && git status --short`
Expected: `data/scripts/deploy-win.sh` в выводе **не появляется** — каталог `data/` в `.gitignore`.

Коммита у этой задачи нет: файл вне git намеренно.

---

### Task 8: Деплой на Windows

Отдельной задачей, а не строчкой в предыдущей: код лежит здесь, а работает на той машине, и до выкатки правка не проверена ничем, кроме тестов. Деплой этой связки уже врал молча не один раз — «скрипт отработал» здесь не значит «правка на месте».

**Files:** ничего в репозиториях не правится; работа идёт на popstas-pc.

- [ ] **Step 1: Запушить обе ветки**

```bash
cd /home/popstas/projects/js/windows11-manager && git push -u origin feat/streamdock-slots
cd /home/popstas/projects/js/streamdock-http-button && git push -u origin <ветка>
```

Скрипты выкатки первым делом делают `git pull` на целевой машине: незапушенное не уедет вовсе.

- [ ] **Step 2: Перенести ключ `streamdock` в живой конфиг**

Живой конфиг — `C:\Users\popstas\AppData\Roaming\windows-mqtt\windows11-manager.config.yaml`. `config.example.yaml` сам собой не читается никогда.

```bash
scp popstas-pc:'C:/Users/popstas/AppData/Roaming/windows-mqtt/windows11-manager.config.yaml' /tmp/w11m.yaml
# дописать блок streamdock верхним уровнем (не внутрь claudeWt!), затем:
scp /tmp/w11m.yaml popstas-pc:'C:/Users/popstas/AppData/Roaming/windows-mqtt/windows11-manager.config.yaml'
```

Править локально и класть обратно `scp`, а не редактировать на Windows: PowerShell `Set-Content` пишет UTF-16 или добавляет BOM, а в файле есть русский текст. После заливки сверить `cmp`.

- [ ] **Step 3: Выкатить менеджер**

Правка целиком в node-части, трей пересобирать незачем:

```bash
cd /home/popstas/projects/js/windows11-manager && BRANCH=feat/streamdock-slots ./data/scripts/deploy-pc.sh --no-build
```

- [ ] **Step 4: Проверить сервер живьём**

```bash
ssh popstas-pc "curl -s -i http://127.0.0.1:9722/claude-wt/slot/1.svg" | head -20
```

Ожидается `200`, `Content-Type: image/svg+xml`, в теле — имя живой сессии. Пусто или 404 — смотреть лог приложения (`data/windows11-manager.log`): туда идёт вывод служебного процесса.

- [ ] **Step 5: Выкатить плагин**

```bash
cd /home/popstas/projects/js/streamdock-http-button && BRANCH=<ветка> ./data/scripts/deploy-win.sh
```

- [ ] **Step 6: Настроить пять кнопок**

В интерфейсе StreamDock положить действие Image Button на пять кнопок верхнего ряда и заполнить у каждой (`n` = 1…5):

- Image URL: `http://127.0.0.1:9722/claude-wt/slot/<n>.svg`
- Action URL: `http://127.0.0.1:9722/claude-wt/slot/<n>/press`
- Update Interval: `10000` (миллисекунды!)
- Image Name: `claude<n>`

- [ ] **Step 7: Проверить поведением**

1. Картинки на пяти кнопках показывают проект, имя, процент и знак состояния; порядок совпадает с панелью openHASP.
2. Нажатие на кнопку живой сессии поднимает её окно.
3. Нажатие на пустую кнопку не делает ничего, а в логе — строка `streamdock: слот N пуст`.
4. Два быстрых нажатия подряд: второе отброшено, в логе — строка про ограничитель.
5. Сессия, окна которой на этой машине нет (живёт на маке), нажатием не поднимается — это известное ограничение, а не поломка.

- [ ] **Step 8: Рассказать, что осталось невыкаченным**

Назвать явно коммиты, легшие после запуска скриптов: на машине их нет, а на экране это неотличимо от неработающей правки.

---

## Self-Review

**Покрытие спеки:** слоты и их снимок — задача 2; картинка и все её правила — задача 1; роуты, коды ответов и сторож на GET — задача 4; команда с ограничителем — задача 3; конфиг верхнего уровня и проводка — задача 5; три правки плагина — задача 6; скрипт выкатки — задача 7; живая проверка и перенос ключа в живой конфиг — задача 8. Раздел спеки «Чего не делаем» задач не порождает намеренно.

**Расхождение со спекой, внесённое здесь:** `sort` читается и под именем `sessionsSort` (задача 2). Причина — молчаливый отказ: в блоке `homeassistant` этот ключ называется `sessionsSort`, и скопированная оттуда строка дала бы умолчание вместо заданного порядка. Спеку поправить одной строкой при исполнении задачи 2.

**Имена, которые обязаны совпасть между задачами:** `slotSvg(slot, { size })` (1 → 2), `createDock(...) -> { count, slots, svg, resolve }` (2 → 3, 4, 5), команда `claude-dock-press` с телом `{ slot }` (3 → 4), `startHttpServer({ router, port, log, dock })` (4 → 5), настройка `actionUrl` (5 → 6 → 8).
