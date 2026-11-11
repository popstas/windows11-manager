# Окна head и детей по зонам FancyZones: план менеджера

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** менеджер знает основные зоны мониторов, пишет в файл трекера, где стоит каждая сессия, ставит окно ребёнка head по зоне (явной, `stack` или `free`) и раскладывает группу "head + дети" просьбой `claude-place group`.

**Architecture:** вся арифметика (в какой зоне окно, какое место, какая зона следующая, раскладка группы) — чистые функции в `src/claude-wt/head-zones-helpers.js` под vitest. Наружу ходят три тонких модуля: `head-zones.js` (зоны и мониторы FancyZones с кэшем на 60 с, без отката через `positionsMap`), `child-place.js` вместе с `child-registry.js` (окно ребёнка при `session-new`) и `group-layout.js` (режим `group`). Трекер получает поля через `buildWindowsFile`. `session-new` и `claude-place` подключают новые модули в уже существующих местах: хук `place` у `focusSpawnedWindow` и `arrangeClaudeWindows`.

**Tech Stack:** Node.js ESM, vitest, node-window-manager (через `src/windows.js`, `src/placement.js`), VirtualDesktop11 (`src/virtual-desktop.js`).

**Spec:** `docs/superpowers/specs/2026-11-11-claude-wt-head-zones-design.md`

## Global Constraints

- **Нумерация мониторов.** Номер монитора в `headZones` — номер FancyZones в нумерации кода, то есть индекс в `getSortedMonitors()` плюс 1, тот же, что у `tileZones` и `rule.fancyZones`. На popstas-nb это 1 — ноутбук (SDC41A0), 2 — вертикальный (WCSC005), 3 — правый (WCSA044). Раскладка Стаса — `1: [3, 4], 2: [1, 2], 3: [1, 4]` (спека исправлена head-сессией 2026-11-12; сырой порядок `editor-parameters.json` — 1 ноутбук, 2 правый, 3 вертикальный — с кодом не совпадает). Проверено пробой на nb 2026-11-12: зоны 1 и 4 монитора 3 перекрываются ровно на 364 px.
- **Порядок ключей.** Ключи `headZones` — целые числа, а JS перебирает такие ключи объекта по возрастанию. Поэтому "порядок ключей" из спеки — это возрастание номера монитора, а "первый ключ" — наименьший номер.
- **Окно в зоне.** Окно относится к зоне, если пересечение покрывает не меньше 60% площади окна (`ZONE_MIN_SHARE = 0.6`). Если подходят две зоны, выигрывает большее пересечение, при равенстве — первая в паре.
- **Места в зоне.** В зоне не больше трёх мест (`MAX_SLOTS = 3`). Места с четвёртого идут поверх: место номер `(k mod 3) + 1`.
- **Head не двигается при открытии ребёнка.** Ни в одном режиме.
- **Чужие окна не двигаются.** Двигаются только окна детей этого head и, в режиме `group`, окна самой группы.
- **Рабочий стол head.** Ребёнок открывается на рабочем столе head. Фокус и `bringToTop()` — только если текущий стол совпадает со столом head; иначе `GoToDesktopNumber` не зовётся вовсе.
- **Бюджет опроса.** Никаких `getWindows()` в тике демона. Файлы FancyZones и `windowManager.getMonitors()` читаются не чаще раза в 60 с (`HEAD_LAYOUT_TTL_MS = 60000`).
- **Откат `positionsMap`.** `getFancyZoneInfo` без второго аргумента ведёт себя как раньше. Зоны `headZones` разрешаются с `{ positionsFallback: false }`. Правило "первая раскладка монитора без учёта стола" не трогать: это бэклог, хуже не делать.
- **Контракт с пикером и скиллами — дословно:**
  - `windows[<sid>]` получает `monitor` (номер FancyZones или `null`), `zone` (номер зоны или `null`) и `slot` (1–3 или `null`), и все три входят в `windowsFingerprint`.
  - Верхний уровень файла получает `headZones`: нормализованная копия конфига с ключами-строками, `{}`, если ключа нет.
  - `session-new` принимает `zone: {monitor, position}`: целые числа, пара обязана быть в `headZones`, иначе 400.
  - `claude-place` принимает `{"mode":"group","groups":[[headId, childId...], ...],"selected": id|null}`. Берётся первая группа с `selected`, иначе первая с сессией активного окна.
- **Порядок выкатки** согласован с пикером: сначала менеджер с режимом `group`, потом пикер.
- **Ничего молчаливого.** Любой откат на нынешнее поведение пишет строку `warn` с причиной. Одна и та же причина пишется один раз, пока не сменится набор причин: лог popstas-pc уже вырос до 316 МБ на повторяющемся отказе.
- **Оформление.** Комментарии и журнал по-русски, в стиле кодовой базы. Префиксы журнала — `claude-wt …` и `claude-place …`.
- **Коммиты.** Conventional commits, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Первый коммит забирает с собой незакоммиченную строку бэклога в `docs/TODO.md`.

## Review Focus

1. **Стас на другом рабочем столе.** Ребёнок head ставится на стол head, а Стаса никуда не переключает: нет фокуса, нет `bringToTop()`, нет `GoToDesktopNumber`. Тест — Task 7, шаг 1, `«чужой стол: без фокуса и без подъёма»`.
2. **Два spawn подряд.** Head открывает трёх детей за секунды. Без очереди оба хвоста посчитают одно и то же `k` и встанут друг на друга. Тест — Task 7, `«второй хвост ждёт первый»`.
3. **Протухший `editor-parameters.json`.** Если монитор отключён, а в файле он ещё есть, его зоны пропускаются с `warn`, а не попадают на другой экран. Тест — Task 3, `«монитор не подключён — зоны пропущены»`.
4. **Спам в журнале.** Пока `headZones` не разрешаются, `warn` пишется один раз на смену причин, а не каждую минуту и не каждый тик. Тест — Task 3, `«та же причина второй раз не пишется»`.
5. **Ребёнок закрыт или hwnd занят чужим окном.** Запись реестра, чьего окна больше нет или чьё окно уже не терминал, в `k` не считается. Тест — Task 7, `«закрытый ребёнок не занимает место»`.

---

## Файлы

| Файл | Что |
|---|---|
| `src/claude-wt/head-zones-helpers.js` (новый) | Нормализация конфига, геометрия окна в зоне, планы `stack`, `free` и `group`, выбор группы. Чистый. |
| `src/claude-wt/head-zones-helpers.test.js` (новый) | Тесты на числах с nb. |
| `src/claude-wt/head-zones.js` (новый) | `resolveHeadLayout()`: зоны и мониторы FancyZones в пространстве окон, кэш, дедуп `warn`. |
| `src/claude-wt/head-zones.test.js` (новый) | С моками `fancyzones.js`, `monitors.js`, `node-window-manager`. |
| `src/claude-wt/child-registry.js` (+test, новые) | Реестр детей этой машины: sessionId → headId, hwnd, стол. |
| `src/claude-wt/child-place.js` (+test, новые) | Где поставить окно ребёнка и как; очередь хвостов. |
| `src/claude-wt/group-layout.js` (+test, новые) | `arrangeGroup()` для `claude-place group`. |
| `src/fancyzones.js`, `src/fancyzones.test.js` | Опция `positionsFallback`. |
| `src/claude-wt/daemon-helpers.js` (+test) | Умолчания и нормализация `headZones`, `childPlacement`. |
| `src/claude-wt/windows-file-helpers.js` (+test), `src/claude-wt/index.js` | Поля трекера, отпечаток, вызов из `publishWindows`. |
| `src/claude-wt/session-new-helpers.js` (+test), `src/claude-wt/session-new.js` (+test) | Разбор `zone`, хвост с `placeChildWindow`. |
| `src/claude-wt/project.js` (+`place-spawned-window.test.js` или `project.test.js`) | `focusSpawnedWindow` понимает `{ desktop, focus: false }`. |
| `src/claude-layout-helpers.js` (+test), `src/claude-layout.js`, `src/index.js` | Режим `group`: разбор, развилка, CLI. |
| `config.example.yaml`, `AGENTS.md`, `docs/TODO.md` | Документация. |

Типы, общие для задач (JSDoc в `head-zones-helpers.js`):

```js
/** @typedef {{x:number, y:number, width:number, height:number}} Rect */
/** @typedef {{monitor:number, position:number, rect:Rect}} ZoneRect */
/** @typedef {{monitors: {monitor:number, rect:Rect}[], zones: ZoneRect[]}} HeadLayout */
/** @typedef {{monitor:number|null, zone:number|null, slot:1|2|3|null}} Location */
```

Числа с nb для тестов (пространство окон, масштаб 1):
- **Мониторы** из `editor-parameters.json`:
  - 1: `{x:0, y:0, width:1722, height:1200}`;
  - 2: `{x:-1080, y:-534, width:1080, height:1880}`;
  - 3: `{x:1920, y:0, width:1920, height:1160}`.
- **Зоны** (`fancyZonesToPos`):
  - `1:3` = `{x:-8, y:0, width:916, height:1208}`;
  - `1:4` = `{x:892, y:0, width:838, height:1208}`;
  - `3:1` = `{x:2036, y:0, width:1096, height:1168}`;
  - `3:4` = `{x:2752, y:0, width:1096, height:1168}`.

---

### Task 1: Ключи конфига `headZones` и `childPlacement`

**Files:**
- Create: `src/claude-wt/head-zones-helpers.js`, `src/claude-wt/head-zones-helpers.test.js`
- Modify: `src/claude-wt/daemon-helpers.js` (`CLAUDE_WT_DEFAULTS`, `mergeClaudeWtConfig`), `src/claude-wt/daemon-helpers.test.js`, `config.example.yaml` (рядом с `tileZones`), `AGENTS.md` (новый раздел "Окна head и детей по зонам" после "Раскладки claude-place"), `docs/TODO.md` (уже изменён head-сессией, просто в коммит)

**Interfaces:**
- Produces:
  - `normalizeHeadZones(raw) -> { zones: Record<string,[number,number]>, problems: string[] }`;
  - `normalizeChildPlacement(raw) -> 'stack'|'free'`;
  - `zoneKey(monitor, position) -> string` (`"1:4"`);
  - после `mergeClaudeWtConfig`: `cfg.headZones` (уже нормализован), `cfg.headZonesProblems: string[]`, `cfg.childPlacement`.

- [ ] **Step 1: Тесты**

```js
it('пара целых на целый ключ проходит, ключи — строки', () => {
  expect(normalizeHeadZones({ 1: [3, 4], 2: [1, 2], 3: [1, 4] }))
    .toEqual({ zones: { 1: [3, 4], 2: [1, 2], 3: [1, 4] }, problems: [] });
});
it('мусорная запись отбрасывается с причиной, соседние живут', () => {
  const r = normalizeHeadZones({ 1: [3, 4], x: [1, 2], 2: [1], 3: [2, 2], 4: ['1', 2] });
  expect(r.zones).toEqual({ 1: [3, 4] });
  expect(r.problems).toHaveLength(4);
});
it('не объект — пусто без причин', () => {
  expect(normalizeHeadZones(undefined)).toEqual({ zones: {}, problems: [] });
});
it.each([['stack', 'stack'], ['free', 'free'], [' FREE ', 'free'], ['yolo', 'stack'], [undefined, 'stack']])(
  'childPlacement %s -> %s', (raw, want) => expect(normalizeChildPlacement(raw)).toBe(want));
it('mergeClaudeWtConfig кладёт нормализованные headZones и умолчание stack', () => {
  const cfg = mergeClaudeWtConfig({ headZones: { 1: [3, 4], 9: 'x' } });
  expect(cfg.headZones).toEqual({ 1: [3, 4] });
  expect(cfg.headZonesProblems).toHaveLength(1);
  expect(cfg.childPlacement).toBe('stack');
});
```

- [ ] **Step 2:** `npx vitest run src/claude-wt/head-zones-helpers.test.js src/claude-wt/daemon-helpers.test.js` — FAIL (нет модуля).
- [ ] **Step 3: Реализация.**
  - Ключ — целое ≥ 1 (по `Number(key)`). Значение — массив ровно из двух разных целых ≥ 1, строки не принимаются.
  - Каждая причина — строка `claudeWt.headZones.<key>: <что не так>`.
  - `childPlacement` — `trim().toLowerCase()`, всё, кроме `free`, даёт `stack`.
  - Умолчания: `headZones: {}`, `childPlacement: 'stack'`.
- [ ] **Step 4: Документация.**
  - **`config.example.yaml`:** закомментированный блок с `headZones: { 1: [3, 4], 2: [1, 2], 3: [1, 4] }` и `childPlacement: stack`. В комментарии: нумерация кода (`getSortedMonitors`, как у `tileZones`), порядок ключей — по возрастанию, первая зона пары — зона head в `group`.
  - **`AGENTS.md`:** новый раздел со строкой про две нумерации и пробу nb. Сюда же Task 3, 7 и 9 добавляют по пункту.
- [ ] **Step 5:** те же тесты — PASS; `npm test` — PASS.
- [ ] **Step 6: Commit** `feat(claude-wt): ключи headZones и childPlacement`, вместе с `docs/TODO.md`.

### Task 2: Где стоит окно — чистая геометрия

**Files:**
- Modify: `src/claude-wt/head-zones-helpers.js`, `src/claude-wt/head-zones-helpers.test.js`

**Interfaces:**
- Consumes: `zoneKey` (Task 1).
- Produces:
  - `ZONE_MIN_SHARE = 0.6`, `MAX_SLOTS = 3`, `NO_LOCATION = {monitor:null, zone:null, slot:null}`;
  - `editorMonitorRect(entry) -> Rect`: `left-coordinate`, `top-coordinate`, `work-area-width`, `work-area-height`, поделённые на `dpi/96`, как в `calcFancyZonePos`;
  - `zoneOfRect(rect, zones: ZoneRect[]) -> ZoneRect|null`;
  - `slotInZone(rect, zoneRect: Rect) -> 1|2|3`;
  - `monitorOfRect(rect, monitors) -> number|null`, по центру окна;
  - `locateWindow(bounds, layout: HeadLayout|null) -> Location`.

- [ ] **Step 1: Тесты** (числа nb выше; `LAYOUT` — три монитора и зоны `1:3, 1:4, 3:1, 3:4`)

```js
it('head ровно в зоне 1:3', () => {
  expect(locateWindow({ x: -8, y: 0, width: 916, height: 1208 }, LAYOUT)).toEqual({ monitor: 1, zone: 3, slot: 1 });
});
it('57% в зоне 1:4 — не в зоне, но монитор известен', () => {
  // nda-sign с nb: 838 из 1456 ширины в 1:4
  expect(locateWindow({ x: 274, y: 402, width: 1456, height: 709 }, LAYOUT)).toEqual({ monitor: 1, zone: null, slot: null });
});
it('перекрытие 3:1 и 3:4 — выигрывает большее пересечение', () => {
  expect(zoneOfRect({ x: 2600, y: 0, width: 600, height: 1168 }, LAYOUT.zones).position).toBe(1);
});
it('ровно в полосе перекрытия — первая зона пары', () => {
  expect(zoneOfRect({ x: 2752, y: 0, width: 380, height: 1168 }, LAYOUT.zones).position).toBe(1);
});
// Верхние кромки, которые даёт stackInCell на 1, 2 и 3 места: 0; 0 и 604; 0, 402 и 804.
it.each([[0, 1], [604, 2], [402, 2], [804, 3], [700, 2], [704, 3]])('зона 1208: верх на %i — место %i', (y, slot) => {
  expect(slotInZone({ x: 892, y, width: 838, height: 402 }, { x: 892, y: 0, width: 838, height: 1208 })).toBe(slot);
});
it.each([[0, 1], [584, 2], [389, 2], [778, 3]])('зона 1168: верх на %i — место %i', (y, slot) => {
  expect(slotInZone({ x: 2036, y, width: 1096, height: 389 }, { x: 2036, y: 0, width: 1096, height: 1168 })).toBe(slot);
});
it('свёрнутое окно и пустая раскладка — NO_LOCATION', () => {
  expect(locateWindow({ x: -32000, y: -32000, width: 160, height: 28 }, LAYOUT)).toEqual(NO_LOCATION);
  expect(locateWindow({ x: 0, y: 0, width: 10, height: 10 }, null)).toEqual(NO_LOCATION);
});
it('editorMonitorRect делит на dpi/96', () => {
  expect(editorMonitorRect({ 'left-coordinate': 0, 'top-coordinate': 0, 'work-area-width': 2893, 'work-area-height': 1728, dpi: 120 }))
    .toEqual({ x: 0, y: 0, width: 2314, height: 1382 });
});
```

- [ ] **Step 2:** `npx vitest run src/claude-wt/head-zones-helpers.test.js` — FAIL.
- [ ] **Step 3: Реализация.**
  - **Место (`slot`)** считается по верхней кромке окна, в целых числах:
    - `p = floor(zone.height / 3)`, `dy = rect.y - zone.y`;
    - `2*dy < p` → место 1; `4*dy < 7*p` → место 2; иначе место 3.

    Пороги стоят посередине между верхними кромками, которые даёт `stackInCell` на 1, 2 и 3 места. Тогда окно на всю зону — место 1, половины — 1 и 2, трети — 1, 2, 3. С `round(dy / (h/3))` половина (`dy = h/2`, ровно 1.5) округлялась бы в место 3. По центру окна было бы хуже: окно на всю зону получило бы место 2.
  - **Свёрнутость** — `isMinimized(bounds)` из `src/windows-helpers.js`, она принимает прямоугольник. Трекерная `isMinimized(win)` из `tracker-helpers.js` — обёртка над ней же по `win.bounds`.
- [ ] **Step 4:** PASS. **Commit** `feat(claude-wt): в какой зоне и на каком месте стоит окно`.

### Task 3: Зоны FancyZones без отката и с кэшем

**Files:**
- Modify: `src/fancyzones.js` (`getFancyZoneInfo(opts, { positionsFallback = true } = {})`, `fancyZonesToPos(opts, options)` передаёт опцию дальше), `src/fancyzones.test.js`
- Create: `src/claude-wt/head-zones.js`, `src/claude-wt/head-zones.test.js`
- Modify: `AGENTS.md` (пункт: без отката, подключённость, кэш)

**Interfaces:**
- Consumes: `editorMonitorRect`, `zoneKey` (Task 1–2), `toWindowSpace` (`src/claude-layout-helpers.js`), `getSortedMonitors` (`src/monitors.js`), `windowManager.getMonitors()`.
- Produces:
  - `HEAD_LAYOUT_TTL_MS = 60000`;
  - `resolveHeadLayout({ headZones, log, nowMs = Date.now() }) -> HeadLayout|null`: `null`, если `headZones` пуст или не разрешилась ни одна зона;
  - `resetHeadLayoutCache()` — только для тестов.

- [ ] **Step 1: Тест `fancyzones.test.js`** (временный каталог, как у соседних тестов `fancyZonesToPos`). Зона `{monitor: 1, position: 9}` отсутствует, а `positionsMap` ведёт её в существующую. Без опции — прямоугольник, как раньше. С `{ positionsFallback: false }` — `undefined`.
- [ ] **Step 2: Тесты `head-zones.test.js`.** Мокаются `../fancyzones.js` (`fancyZonesToPos`), `../monitors.js` (`getSortedMonitors`) и `node-window-manager` (`getMonitors` → `[{ getBounds, getScaleFactor }]`). Тесты:
  - `«разрешает зоны и мониторы в пространстве окон»`: три монитора nb → `zones` с `1:3, 1:4`, `monitors` из трёх записей;
  - `«монитор не подключён — зоны пропущены»`: `getSortedMonitors` знает три монитора, а живых два (нет вертикального). Зоны монитора 2 отсутствуют, в `log` ровно одна строка `warn` с номером монитора, `fancyZonesToPos` для них не звался;
  - `«зона не разрешилась — пропущена с warn»`: `fancyZonesToPos` вернул `undefined`, а потом бросил, — две разные строки;
  - `«fancyZonesToPos зовётся с positionsFallback: false»`;
  - `«кэш: второй вызов в пределах 60 с не читает файлы, смена headZones — читает»`;
  - `«та же причина второй раз не пишется»`: два пересчёта (через `nowMs + 60001`) с одной и той же поломкой дают одну строку `warn`. Починка, а затем новая поломка дают вторую.
- [ ] **Step 3:** `npx vitest run src/fancyzones.test.js src/claude-wt/head-zones.test.js` — FAIL.
- [ ] **Step 4: Реализация.**
  - **Подключён ли монитор FancyZones `n`.** Центр `editorMonitorRect(getSortedMonitors()[n-1])` лежит внутри одного из `toWindowSpace(m.getBounds(), m.getScaleFactor())` живых мониторов. Мониторы, которых нет в `headZones`, тоже идут в `layout.monitors`, если подключены: `monitor` в трекере нужен и вне основных зон.
  - **Дедуп `warn`.** Модуль помнит `lastProblems` (строку из причин, соединённых через `\n`) и пишет причины, только если она изменилась. Причины `cfg.headZonesProblems` из Task 1 идут туда же.
  - **Ошибки.** Любое исключение при чтении файлов — причина, а не падение: тик демона не роняется.
- [ ] **Step 5:** PASS; `npm test` — PASS. **Commit** `feat(claude-wt): зоны headZones без отката positionsMap`.

### Task 4: Поля трекера `monitor/zone/slot` и `headZones`

**Files:**
- Modify: `src/claude-wt/windows-file-helpers.js` (`buildWindowsFile`, `windowsFingerprint`), `src/claude-wt/windows-file-helpers.test.js`, `src/claude-wt/index.js` (`publishWindows`)

**Interfaces:**
- Consumes: `locateWindow`, `NO_LOCATION` (Task 2), `resolveHeadLayout` (Task 3).
- Produces: `buildWindowsFile({ ..., layout, headZones })`. Окна тика уже несут `bounds` (`src/claude-wt/index.js`, `snapshot()`).

- [ ] **Step 1: Тесты.**
  - `«у окна в зоне есть monitor, zone и slot»`.
  - `«свёрнутое окно — три null»`.
  - `«без layout — три null, headZones: {}»`.
  - `«headZones — копия нормализованного конфига»` — `{ "1": [3, 4] }`.
  - `«отпечаток меняется, когда окно переехало в другую зону»`. Оба `buildWindowsFile` отличаются только `bounds` одного окна, а `windowsFingerprint(...)` у них разный.
  - `«signalPrint от зоны не зависит»`: он не меняется, и это намеренно.
  - Фикстура `tauri-app/src-tauri/tests/fixtures/windows-file.json` (её читает трей, `tray_windows.rs`) получает новые поля. Проверить, что Rust-тест трея её всё ещё разбирает: `cd tauri-app/src-tauri && . "$HOME/.cargo/env" && rtk proxy cargo test tray_windows`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Реализация.**
  - **Поля окна.** В записи окна: `...locateWindow(w.bounds, layout)`, после `minimized`. Свёрнутость `locateWindow` проверяет сам (Task 2), поля `w.minimized` у окна тика нет — есть только `bounds`.
  - **Отпечаток.** В `windowsFingerprint` к строке окна добавляются `monitor`, `zone` и `slot`.
  - **`publishWindows`.** Зовёт `resolveHeadLayout({ headZones: cfg.headZones, log })` и передаёт `layout` и `headZones: cfg.headZones`. Здесь `log` — `console.warn` с префиксом `[claude-wt]`. Кэш Task 3 гарантирует не больше одного чтения файлов в минуту.
- [ ] **Step 4:** PASS; `npm test`. **Commit** `feat(claude-wt): монитор, зона и место сессии в файле трекера`.
- [ ] **Step 5: Ранняя живая проверка на nb** — до задач 5–9, на них и на пикер опирается всё дальнейшее.
  - **Зачем.** Проверка "монитор подключён" по живым `getMonitors()` ещё не запускалась ни разу: ssh-проба окон рабочего стола не видит.
  - **Как.** Нужна правка конфига nb из Task 10 (предусловие там же), затем выкатка как в Task 10, шаг 1.
  - **Ожидание.** В `~/.ccfzf/windows/popstas-nb.json` у head `monitor 1, zone 3, slot 1`, у окна на правом мониторе — `monitor 3`, и в логе нет `warn` про отключённые мониторы.
  - **Если не так** — пространство координат не то. Чинить в Task 3 тестом с живыми числами, а не идти дальше.

### Task 5: Поле `zone` в `session-new`

**Files:**
- Modify: `src/claude-wt/session-new-helpers.js`, `src/claude-wt/session-new-helpers.test.js`

**Interfaces:**
- Produces: `parseSessionNewRequest(raw, { projects, newId, headZones = {} })`, успех — `{ ok: true, vars, zone: {monitor, position}|null }`. `vars` не меняется: `zone` не переменная шаблона запуска.

- [ ] **Step 1: Тесты** (`HZ = { 1: [3, 4], 3: [1, 4] }`)

```js
it('zone из headZones проходит', () => {
  expect(parseSessionNewRequest({ ...BODY, zone: { monitor: 1, position: 4 } }, { ...OPTS, headZones: HZ }).zone)
    .toEqual({ monitor: 1, position: 4 });
});
it('без zone — null', () => expect(parseSessionNewRequest(BODY, { ...OPTS, headZones: HZ }).zone).toBeNull());
it.each([
  ['строки', { monitor: '1', position: '4' }],
  ['дробь', { monitor: 1, position: 4.5 }],
  ['не пара headZones', { monitor: 1, position: 1 }],
  ['монитора нет', { monitor: 2, position: 1 }],
  ['массив', [1, 4]],
  ['строка', '1:4'],
])('400 для zone: %s', (_, zone) => {
  expect(parseSessionNewRequest({ ...BODY, zone }, { ...OPTS, headZones: HZ })).toMatchObject({ ok: false, status: 400 });
});
it('zone при пустых headZones — 400 с причиной про headZones', () => {
  const res = parseSessionNewRequest({ ...BODY, zone: { monitor: 1, position: 4 } }, OPTS);
  expect(res).toMatchObject({ ok: false, status: 400 });
  expect(res.reason).toContain('headZones');
});
```

- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Реализация.**
  - **Проверка.** Идёт после проверки `permissionMode`. `null` и `undefined` — нет зоны.
  - **Текст отказа.** `zone must be one of 1:3, 1:4, 3:1, 3:4` — пары через `zoneKey`.
  - **`headId` не обязателен.** Явная зона без `headId` законна: детей нет, `k = 0`, стол текущий.
- [ ] **Step 4:** PASS. **Commit** `feat(claude-wt): session-new принимает zone`.

### Task 6: Планы `stack` и `free` — чистые

**Files:**
- Modify: `src/claude-wt/head-zones-helpers.js`, `src/claude-wt/head-zones-helpers.test.js`

**Interfaces:**
- Consumes: `stackInCell` (`src/claude-layout-helpers.js`), `zoneKey`, `MAX_SLOTS`.
- Produces:
  - `stackPlan({ zone: Rect, own: {id, rect}[] }) -> { moves: {id, pos}[], pos: Rect }`;
  - `overlayPos(zone: Rect, count: number) -> Rect`: место `(count mod 3) + 1` сетки из трёх, никто не двигается;
  - `pickStackZone({ headLoc: Location, headZones }) -> {monitor, position}|null`;
  - `freeCandidates({ headZones, headMonitor, available: ZoneRect[] }) -> ZoneRect[]`: сначала пара монитора head, потом остальные мониторы по возрастанию, внутри пары — её порядок; только зоны из `available`;
  - `pickFreeZone({ candidates: ZoneRect[], occupancy: Map<string,{own:number, foreign:number}> }) -> { zone: ZoneRect, how: 'stack'|'overlay' }|null`.

- [ ] **Step 1: Тесты** (`Z = { x: 892, y: 0, width: 838, height: 1208 }`, у `own[i].rect` разные `y`)
  - `stackPlan` при k = 0: `pos` равен `Z`, `moves` пуст.
  - k = 1: `moves = [{id:'a', pos:{892,0,838,604}}]`, `pos = {892,604,838,604}`.
  - k = 2: свои переставлены по возрастанию `rect.y` на места 1–2. Высоты 402, 402, 404, `pos` — третье место.
  - k = 3: `moves = []`, `pos = {892,0,838,402}`.
  - k = 5: `moves = []`, `pos = {892,804,838,404}`.
  - `overlayPos(Z, 4)` — второе место сетки из трёх.
  - `pickStackZone`:
    - head в 3, пара `[3,4]` → 4;
    - head в 4 → 3;
    - `zone: null` → 4 (вторая пары);
    - монитора нет в `headZones` → `null`;
    - `monitor: null` → `null`.
  - `freeCandidates`: head на мониторе 3, `headZones {1:[3,4],2:[1,2],3:[1,4]}` → порядок `3:1, 3:4, 1:3, 1:4, 2:1, 2:2`. Недоступный `2:2` выпадает.
  - `pickFreeZone`:
    - первая пустая (`own + foreign = 0`) → `how: 'stack'`;
    - пустых нет, есть зоны без чужих → наименьшее `own`, при равенстве — первая по кандидатам, `how: 'stack'`;
    - везде чужие → наименьшее `own + foreign`, `how: 'overlay'`;
    - `candidates` пуст → `null`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Реализация** по сигнатурам выше. Head считается в `foreign` своей зоны: его зона никогда не "свободна" и не делится, пока есть другие варианты.
- [ ] **Step 4:** PASS. **Commit** `feat(claude-wt): планы stack и free для окна ребёнка`.

### Task 7: Окно ребёнка при `session-new`

**Files:**
- Create: `src/claude-wt/child-registry.js`, `src/claude-wt/child-registry.test.js`, `src/claude-wt/child-place.js`, `src/claude-wt/child-place.test.js`
- Modify:
  - `src/claude-wt/session-new.js` (+test) — хвост для детей;
  - `src/claude-wt/project.js` — `focusSpawnedWindow`: ответ `place` вида `{ desktop, focus: false }` значит "фокус не брать", +test в `src/claude-wt/project.test.js`;
  - `AGENTS.md` — пункт про реестр, очередь и стол.

**Interfaces:**
- Consumes: Task 2, 3, 5, 6; `claudeWtSessions({ brief: true })` (`view.js`); `getWindowById`, `getActiveWindowId` (`windows.js`); `virtualDesktop.GetWindowDesktopNumber`; `placeWindow`; `markNoAutoplace` (`no-autoplace.js`); `isTerminalWindow` (`index.js`).
- Produces:
  - `child-registry.js`:
    - `CHILD_TTL_MS = 7 * 24 * 3600 * 1000`;
    - чистые `upsertChild(entries, entry, nowMs)` и `childrenOfHead(entries, headId, nowMs)`;
    - I/O `recordChild({ sessionId, headId, windowId, desktop })` и `readChildren()`.
    - Файл `claude-wt-children.json` лежит рядом с `statePath`, как `no-autoplace.json` (`marksPath`). Без `statePath` реестра нет, и `childrenOfHead` даёт `[]`.
  - `child-place.js` — `placeChildWindow(w, { sessionId, headId, zone, mark, log }, deps = {}) -> Promise<{ desktop: number|null, focus: boolean }|null>`. `null` значит "плана нет, ставь по-старому".

**Почему реестр, а не `~/.ccfzf/children`.** Связь head и ребёнка знает сам `session-new`: `sessionId` и `headId` пришли в просьбе, hwnd находится в хвосте. Реестр местный, поэтому нет чтения по SMB. Нет и гонки, когда брат, открытый секунду назад, ещё не привязан демоном или его файл ещё не виден. Цена одна: дети, открытые до выкатки, в `k` не считаются.

**Порядок внутри `placeChildWindow`:**

1. **Очередь.** Модульная цепочка промисов, и хвосты исполняются строго по одному. Ошибка одного не рвёт цепочку.
2. **Раскладка.** `resolveHeadLayout`; `null` → `warn` и ответ `null`.
3. **Окно head.** `claudeWtSessions({ brief: true })` → открытая сессия `headId`. Из неё — `getWindowById` → `getBounds()` и `headDesktop = session.desktop`.
   - Head не найден или свёрнут: явная `zone` ставится без head (`headDesktop = null`, зона — по просьбе), иначе `warn` и `null`.
4. **Текущий стол** — `GetWindowDesktopNumber(getActiveWindowId()) + 1`, до любых переносов.
5. **Свои дети.** `childrenOfHead` → окна, которые существуют, `isTerminalWindow`, не свёрнуты и стоят на `headDesktop` (если стол известен).
6. **Чужие окна.** Остальные открытые сессии со стола head, плюс сам head.
7. **Целевая зона.**
   - Явная `zone`: `stackPlan` по своим детям в ней.
   - `stack`: `pickStackZone` → `stackPlan`.
   - `free`: `pickFreeZone` → `stackPlan` или `overlayPos`.
   - Зона не в `layout` (монитор отключён): `warn` и `null`.
8. **Расстановка.** `markNoAutoplace(w.id)`, затем `placeWindow({ w: brother, rule: { pos }, isBulk: true })` для каждого `moves`, затем `placeWindow({ w, rule: { pos, ...(headDesktop ? { desktop: headDesktop } : {}) }, isBulk: true })`. Head в `moves` не попадает по построению.
9. **Реестр.** `recordChild(...)` с `desktop: headDesktop ?? current`, если есть `headId`.
10. **Журнал:** `claude-wt session-new <name>: зона 1:4 (stack), место 2 из 2, стол 1`.
11. **Ответ:** `{ desktop: headDesktop, focus: headDesktop == null || headDesktop === current }`.

- [ ] **Step 1: Тесты `child-place.test.js`** (все внешние вызовы — через `deps`; фейковые окна с `getBounds`)
  - `«stack: head в 1:3 — ребёнок в 1:4 целиком, head не двигается»`: `placeWindow` звался один раз, для нового окна, с `pos` равным `1:4`.
  - `«stack: в 1:4 уже двое своих — переставлены на трети, новый третий»`.
  - `«head вне основной зоны — вторая зона пары»`.
  - `«head на мониторе без headZones — null и warn»`.
  - `«free: свободная зона на мониторе head»`.
  - `«free: свободная на другом мониторе»`.
  - `«free: свободных нет — делится зона своих, чужие не двигаются»`.
  - `«free: везде чужие — overlay, moves пуст»`.
  - `«явная zone без headId — целиком в зону, стол не задан»`.
  - `«чужой стол: без фокуса и без подъёма»`: текущий стол 2, стол head 1 → `rule.desktop === 1`, ответ `{ desktop: 1, focus: false }`.
  - `«закрытый ребёнок не занимает место»`: в реестре два ребёнка, у одного `getWindowById` → `undefined`, у другого окно не терминал → `k = 0`.
  - `«второй хвост ждёт первый»`: два вызова подряд, первый `placeWindow` висит на промисе. Второй не читает сессии, пока первый не завершился, и видит первого ребёнка в реестре (`k = 1`).
- [ ] **Step 2: Тесты `child-registry.test.js`.**
  - `upsertChild` заменяет запись того же `sessionId` и выбрасывает записи старше `CHILD_TTL_MS`.
  - `childrenOfHead` отбирает по `headId`.
- [ ] **Step 3: Тесты `session-new.test.js`.**
  - `cfg.headZones` доезжает до `parseSessionNewRequest`. Верная `zone` (`cfg` с `headZones: { 1: [3, 4] }`) доходит до `placeChild` вторым аргументом. Чужая зона — 400, и `spawnProcess` не звался.
  - С `headId` хвост идёт через `focusByTitle` даже при `cursor`, и в нём есть `place`.
  - Без `headId` и без `zone` — как сейчас: оба существующих теста не трогаются.
  - `place` при ответе `null` от `placeChild` зовёт старый `placeSpawnedWindow`.
- [ ] **Step 4: Тест `project.test.js`.** `focusSpawnedWindow` с `place`, вернувшим `{ desktop: 1, focus: false }`, не зовёт `focus` и отвечает `true`. Числовой ответ `place` работает как раньше.
- [ ] **Step 5:** `npx vitest run src/claude-wt/child-place.test.js src/claude-wt/child-registry.test.js src/claude-wt/session-new.test.js src/claude-wt/project.test.js` — FAIL.
- [ ] **Step 6: Реализация.**
  - **`session-new.js`.** `parseSessionNewRequest(body, { projects: cfg.projects, newId, headZones: cfg.headZones })`. Новые `deps.placeChild = placeChildWindow` и `deps.placeOld = placeSpawnedWindow`. При `vars.headId !== '-'` или `zone`: `focusByTitle(vars.name, { mark, cursor, place: (w, t, m, c) => placeChild(w, {...}).then(r => r ?? placeOld(w, t, m, c)) })`.
  - **`project.js`.** В `focusSpawnedWindow` ответ-объект разбирается в одном месте: `focus: false` — `mark('focus:skipped')`, возврат `true`.
- [ ] **Step 7:** PASS; `npm test`. **Commit** `feat(claude-wt): окно ребёнка head встаёт по зоне`.

### Task 8: `claude-place group` — разбор и план

**Files:**
- Modify: `src/claude-layout-helpers.js` (`layoutFromName`, `parseArrangePayload`), `src/claude-layout-helpers.test.js`, `src/claude-wt/head-zones-helpers.js` (+test)

**Interfaces:**
- Produces:
  - `parseArrangePayload` для `group` → `{ mode: 'group', ids: [], groups: string[][], selected: string|null }`. Группа — массив строк, после `normalizeIds` в ней не меньше двух; иное выбрасывается. Голое слово `group` даёт `groups: []`.
  - `pickGroup({ groups, selected, activeId }) -> string[]|null`: **первая** по порядку `groups` группа с `selected`, иначе **первая** с `activeId`. Пикер кладёт группы от самого глубокого head (защита от вложенности, дополнение контракта от head 2026-11-12), поэтому "первая" значит именно первая, а не лучшая.
  - `groupPlan({ first: Rect, second: Rect, n }) -> { head: Rect, children: Rect[] }`: места `min(n, 3)`, ребёнок `i` на место `i mod 3`.

- [ ] **Step 1: Тесты.**
  - `parseArrangePayload` разбирает объект, json-строку и голое `group`.
  - Группа из одного id выбрасывается.
  - `selected` не строка → `null`.
  - `tile` и `cascade` разбираются по-прежнему; `yolo` → `null`.
  - `pickGroup`:
    - `selected` в первой группе;
    - `selected` неизвестен, активное окно — во второй;
    - ни то ни другое → `null`;
    - `selected` важнее активного;
    - `selected` есть в двух группах → первая по порядку; то же для активного.
  - `groupPlan` при n = 1, 3, 4, 7. При n = 4 и 7 у ребёнка 3 место совпадает с ребёнком 0, при n = 7 у ребёнка 6 — тоже.
- [ ] **Step 2:** FAIL. **Step 3:** реализация. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(claude-place): разбор и план режима group`.

### Task 9: `claude-place group` — расстановка

**Files:**
- Create: `src/claude-wt/group-layout.js`, `src/claude-wt/group-layout.test.js`
- Modify:
  - `src/claude-layout.js` — `arrangeClaudeWindows({ mode, ids, groups, selected, log })`: при `mode === 'group'` возвращает `arrangeGroup(...)` до разрешения `tileZones`;
  - `src/commands/claude-commands.js` — передать `groups` и `selected`;
  - `src/index.js` — CLI `place <mode>` передаёт весь `parsed`, описание — `tile | cascade | '<json group>'`;
  - `AGENTS.md`.

**Interfaces:**
- Consumes: Task 2, 3, 8; `claudeWtSessions({ brief: true })`, `getWindowById`, `getActiveWindowId`, `focusWindowById`, `placeWindow`, `virtualDesktop`.
- Produces: `arrangeGroup({ groups, selected, log }, deps = {}) -> Promise<{ ok: true, placed: number } | { ok: false, reason: string }>`.

**Порядок:**

1. **Пустые `groups`** → `{ ok: false, reason: 'claude-place group: группы не переданы' }`. Команда уже пишет `warn` и `notify` — так голое слово с панели отказывает чисто.
2. **Активная сессия.** Снимается `activeBefore = getActiveWindowId()`. Сессии — `claudeWtSessions({ brief: true })`, активная — по `windowId`. Затем `pickGroup`; `null` → отказ `'ни одна группа не содержит выбранную или активную сессию'`.
3. **Окно head** не найдено или свёрнуто → отказ с причиной.
4. **Монитор.** `layout = resolveHeadLayout(...)`, `null` → отказ. Монитор — `locateWindow(head).monitor`; если его нет в `headZones` или в `layout`, берётся наименьший монитор `headZones`, который есть в `layout`, с `warn`.
5. **Дети.** Сессия не открыта или окно свёрнуто — пропуск со строкой журнала, как в `pickWindows`. Стол ребёнка отличается от стола head — `rule.desktop = headDesktop`.
6. **Расстановка.** `groupPlan` → `placeWindow(..., isBulk: true)`: head в первую зону, дети во вторую.
7. **Подъём и фокус.** Подъём и `pickFocusTarget` из `claude-layout-helpers.js` — только если текущий стол равен столу head.
8. **Журнал:** `claude-place group: head <title>, детей <placed> из <в группе>`.

- [ ] **Step 1: Тесты `group-layout.test.js`.**
  - `«4 ребёнка — head в 3:1, дети в 3:4, четвёртый на месте первого»`.
  - `«selected важнее активного окна»`.
  - `«head на мониторе вне headZones — наименьший монитор и warn»`.
  - `«свёрнутый ребёнок пропущен, остальные плотно»`: n считается по видимым.
  - `«ребёнок с другого стола уезжает на стол head»`.
  - `«чужой стол — без подъёма и фокуса»`.
  - `«пустые groups — отказ без единого placeWindow»`.
  - `«окна вне группы не двигаются»`: в сессиях есть третья, чужая, и `placeWindow` для неё не звался.
- [ ] **Step 2: Тест в `src/commands/claude-commands.test.js`**, в `describe('claude-place')`. Объект с `mode: 'group'` доезжает до `arrangeClaudeWindows` с `groups` и `selected`.
- [ ] **Step 3:** FAIL. **Step 4:** реализация. **Step 5:** PASS; `npm test`; `npm run lint`.
- [ ] **Step 6: Commit** `feat(claude-place): раскладка группы head и детей`.

### Task 10: Выкатка и живая проверка на popstas-nb

**Предусловие.** Правка живого конфига nb — только с разрешения Стаса: auto-mode такие правки уже отклонял. Правило проекта: файл целиком через scp, UTF-8 без BOM, рядом бэкап `.bak-2026-11-12-headzones`. Добавить в `claudeWt`:

```yaml
headZones: { 1: [3, 4], 2: [1, 2], 3: [1, 4] }
childPlacement: stack
```

- [ ] **Step 1: Выкатка.** `TARGET_HOST=nb.popstas.pro REPO='C:\projects\js\windows11-manager' ./data/scripts/deploy-pc.sh --no-build`. Смотреть: в логе nb нет нового `warn` про `headZones`, а `curl http://nb.popstas.pro:9722/` отвечает.
- [ ] **Step 2: Трекер.** `jq '{headZones, w: (.windows | map_values({monitor, zone, slot}))}' ~/.ccfzf/windows/popstas-nb.json` на pc-virt. Head (`8be5f386…`) — `monitor 1, zone 3, slot 1`. `session-find` отдаёт те же поля.
- [ ] **Step 3: Пункты 1–3 спеки.**
  - Head в зоне 3 ноутбука; спавнить через `session-spawn`. Три ребёнка встают в `1:4` местами 1-2-3, четвёртый — поверх первого.
  - Перетащить head вне зон: следующий ребёнок встаёт в `1:4`.
  - Закрыть ребёнка: остальные не двигаются.
- [ ] **Step 4: Стол.** Стас на другом столе, head на первом. Ребёнок появляется на столе head; Стаса не переключает, фокус не уходит.
- [ ] **Step 5: `group`.** Хоткея пикера ещё нет, поэтому просьба идёт с pc-virt через `curl -s -X POST http://nb.popstas.pro:9722/claude-wt/place -d '{"mode":"group","groups":[["<head>","<c1>","<c2>","<c3>","<c4>"]],"selected":"<c2>"}'`. Head переезжает в `1:3`, дети стопкой в `1:4`. В логе строка `claude-place group: head …, детей 4 из 4`.
- [ ] **Step 6: Пункт 5 спеки — `free`** (конфиг с `childPlacement: free`, тот же порядок с бэкапом). Дети занимают свободные зоны других мониторов, перекрытие `3:1` и `3:4` не мешает.
- [ ] **Step 7: Старая плитка.** `{"mode":"tile"}` через тот же маршрут работает как раньше.
- [ ] **Step 8: Итог.** Итог head-сессии; при расхождении — новый тест в соответствующей задаче, а не правка вслепую.
