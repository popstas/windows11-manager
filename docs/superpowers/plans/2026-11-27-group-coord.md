# Раскладка группы head с coord — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** при раскладке группы (Ctrl+Win+F10, `claude-place group`) прямой ребёнок head, у которого есть своя группа (coord `co-…`), встаёт в первую зону вместе с head под ним, а его дети (внуки head) — в стопку второй зоны вместе с прямыми детьми head.

**Architecture:** состав раскладки (кто coord, кто в стопке) считает новая чистая функция `groupMembers` в `head-zones-helpers.js` рядом с `pickGroup`/`groupPlan`; `arrangeGroup` в `group-layout.js` берёт из неё списки и ставит coord прямоугольником первой зоны, подъём — coord раньше head. Протокол `claude-place` и выбор группы (`pickGroup`) не меняются.

**Tech Stack:** Node ESM, vitest (`npm test` = `vitest run`).

**Spec:** `/home/popstas/projects/text/obsidian/home/Notes/2026/11/claude-wt автокомпакт и usage в пикере.md`, «Часть 4. Раскладка Ctrl+Win+F10 с coord».

## Global Constraints

- Протокол не меняется: `{"mode": "group", "groups": [...], "selected": id|null}`, группы от самого глубокого head к корню; группа coord — в `groups`, его id первым.
- coord — прямой ребёнок выбранной группы, для которого в `groups` есть группа `g` с `g[0] === id`. Глубина — один уровень: внук со своей группой идёт в стопку обычным окном, его дети в раскладку не попадают.
- `pickGroup` не меняется: нажатие из окна coord раскладывает группу coord.
- Первая зона: head и coord в одном прямоугольнике `plan.head`; head сверху.
- Стопка второй зоны: сначала прямые дети head (не coord) в порядке группы, затем внуки по порядку coord и их групп; без повторов, без head и самих coord.
- Подъём (stack): `[...coords, head, ...стопка]`; deck: `[...coords, head, выбранный ребёнок колоды?]`. Фокус — прежнее правило: выбранный ребёнок колоды, иначе `pickFocusTarget([head, ...coords, ...стопка], активное)` — по умолчанию head.
- coord и внуки с другого стола едут на стол head, свёрнутые/не открытые пропускаются с записью в журнал (свёрнутый coord — внуки всё равно в стопку).
- Строка итога в журнале без coord — байт в байт прежняя: `claude-place group: head <title>, детей N из M`. С coord: `claude-place group: head <title>, coord <title>[, <title>], детей N из M`; `M` — длина стопки (прямые дети + внуки), в `coord …` — только поставленные.
- Режима group на маке нет (`macos-windows-manager` — только tile/cascade), правка «меняйте и там» из AGENTS.md («Раскладки claude-place») сюда не относится.
- Комментарии, названия тестов — по-русски. Ветка `feat/group-coord`, мерж через PR только после команды coord.

## Review Focus

1. Активное окно — coord, а `selected` — head (CLI/HTTP или пикер с подсвеченным head): прежнее правило фокуса отдаёт фокус coord, и он всплывает над head. По дизайну так и остаётся — тест в Task 2 фиксирует фокус на coord.
2. Нажатие из окна coord (`selected: null`, активен coord) — раскладывается группа coord, head не трогается (тест в Task 2).
3. Цепочка h → x → y → z: y в стопке, z не двигается (тест в Task 1 и Task 2).
4. coord свёрнут: пропущен, внуки в стопке (тест в Task 2).
5. Человек на другом столе: подъёма нет, порядок coord/head по глубине не гарантирован — ограничение, не чинится (существующий тест «чужой стол» + запись в AGENTS.md).

---

### Task 1: `groupMembers` — состав раскладки

**Files:**
- Modify: `src/claude-wt/head-zones-helpers.js` (после `pickGroup`, ~стр. 297; экспорт)
- Test: `src/claude-wt/head-zones-helpers.test.js`

**Interfaces:**
- Produces: `groupMembers({ group: string[], groups: string[][] }) → { head: string, coords: string[], stack: string[] }`.

- [x] **Step 1: Падающие тесты** — `describe('groupMembers')`:
  - без вложенных групп: `groupMembers({ group: ['h','a','b'], groups: [['h','a','b']] })` → `{ head: 'h', coords: [], stack: ['a','b'] }`;
  - coord с двумя исполнителями и прямой ребёнок: groups `[['co','e1','e2'], ['h','co','d']]`, group = второй → `{ head: 'h', coords: ['co'], stack: ['d','e1','e2'] }`;
  - цепочка: groups `[['y','z'], ['x','y'], ['h','x']]`, group `['h','x']` → `{ coords: ['x'], stack: ['y'] }` (z нет);
  - повтор и head во внуках не дублируются: groups `[['co','d','h','e1'], ['h','co','d']]` → `stack: ['d','e1']`;
  - группа самого head среди groups (`[['h','a'], ['h','a']]`) coord не делает: `coords: []`.

- [x] **Step 2:** `npx vitest run src/claude-wt/head-zones-helpers.test.js` — FAIL (`groupMembers` не экспортирован).
- [x] **Step 3:** реализовать `groupMembers`, экспортировать.
- [x] **Step 4:** тот же прогон — PASS.
- [x] **Step 5:** коммит `feat(claude-wt): groupMembers — coord и внуки в раскладке группы`.

### Task 2: `arrangeGroup` ставит coord в первую зону

**Files:**
- Modify: `src/claude-wt/group-layout.js` (шапка-комментарий, `arrangeGroup`)
- Modify: `AGENTS.md` (пункты `claude-place group` и `deck` в «Окна head и детей по зонам»)
- Test: `src/claude-wt/group-layout.test.js`

**Interfaces:**
- Consumes: `groupMembers` из Task 1.

- [x] **Step 1: Падающие тесты** — `describe('coord в группе')` со своей обвязкой: head `h` (окно 1, в 3:4), coord `co` (окно 20), исполнители `e1`, `e2` (21, 22), прямой ребёнок `d` (10); `groups: [['co','e1','e2'], ['h','co','d']]`; у всех окон `bringToTop` пишет id в `raised`.
  - `selected: 'h'` → `placed` = `[{id:20,pos:R['3:1']}, {id:1,pos:R['3:1']}, {id:10,pos:third(Z,0)}, {id:21,pos:third(Z,1)}, {id:22,pos:third(Z,2)}]`; `raised` = `[20, 1, 10, 21, 22]`; `focus` ← 1; журнал `claude-place group: head head-session, coord co-x, детей 3 из 3`;
  - активен `co`, `selected: null` → раскладывается группа `co`: `placed[0].id === 20`, окна 1 и 10 не двигаются;
  - активен `co`, `selected: 'h'` → фокус 20 (Review Focus 1);
  - coord свёрнут → `placed` без 20, внуки 21 и 22 в стопке, журнал содержит `co … пропущено` и итог без `coord`;
  - coord на столе 2 → `placed` для 20 с `desktop: 1`;
  - цепочка `[['y','z'], ['x','y'], ['h','x']]` → z (окно своё) не в `placed`;
  - deck: дети и внуки во второй зоне целиком, `raised` = `[20, 1, <выбранный>]` при `selected: 'd'` (ид 10) и фокус 10; при `selected: 'h'` `raised` = `[20, 1]`. Внук выбранным в группе head не бывает: он есть только в группе coord, и `pickGroup` раскладывает её.
- [x] **Step 2:** `npx vitest run src/claude-wt/group-layout.test.js` — новые FAIL, старые PASS.
- [x] **Step 3:** в `arrangeGroup` заменить `const [headId, ...kidIds] = group` на `groupMembers({ group, groups })`; окна coord собирать тем же циклом, что детей (общий хелпер «открытое несвёрнутое окно или запись в журнал»); расставлять coord, head, стопку; подъём и фокус — по Global Constraints. Шапку файла дополнить абзацем про coord.
- [x] **Step 4:** `npm test` — всё PASS.
- [x] **Step 5:** AGENTS.md: в пункт `claude-place group` — coord в первой зоне под head, внуки в стопке, глубина 1, ограничение «на чужом столе подъёма нет»; в пункт `deck` — внуки в колоду. Коммит `feat(claude-wt): раскладка группы — coord в первой зоне под head`.

### Task 3: прогон на дереве из `claude-wt tree`

**Files:**
- Test: `src/claude-wt/group-layout.test.js`, `describe('живое дерево head → coord → исполнители')`: форма дерева снята `claude-wt tree --json` (head → coord → два исполнителя), id и имена нейтральные (`head-a`, `coord-a`, `kid-1`, `kid-2`), плюс синтетический прямой ребёнок `kid-direct`; окна — синтетические прямоугольники (в дереве геометрии нет). Ожидание записано таблицей `окно → зона → y` и порядком подъёма — она же идёт в отчёт.

- [x] **Step 1:** снять `claude-wt tree --json`, собрать фикстуру, группы — как `place_order::group_ids` (от глубокого к корню).
- [x] **Step 2:** тест: head и coord в 3:1, coord поднят раньше head, три окна в 3:4.
- [x] **Step 3:** `npm test` — PASS; таблицу плана расстановки — в отчёт coord.
- [x] **Step 4:** коммит, пуш `feat/group-coord`, PR в master.

### Task 4: Деплой (только по команде coord)

- Выкатывается: node-часть windows11-manager, `src/claude-wt/` (демон не меняется, раскладку зовёт служба — `node src/index.js mqtt`).
- Команда (делает coord): `BRANCH=feat/group-coord ./data/scripts/deploy-pc.sh --no-build` на nb. Мак пропущен, недоступен; popstas-pc исключён.
- Живые зоны nb (`claudeWt.headZones: { 1: [1, 2], 2: [3, 4], 3: [5, 6] }`, `childPlacement` не задан — stack): `wt-autocompact-head` стоит в 2:3 → он и `co-autocompact` в 2:3, исполнители стопкой в 2:4.
- Проверка: на nb Ctrl+Win+F10 из окна head `wt-autocompact-head` — `co-autocompact` в первой зоне под head, исполнители стопкой во второй; в логе трея `claude-place group: head wt-autocompact-head, coord co-autocompact, детей N из N`. CLI `claude-wt window layout` (ccfzf) шлёт одну плоскую группу всех потомков — coord с этой дороги не распознаётся и идёт в стопку, как раньше. Из окна coord — раскладывается группа coord, head на месте.
- После проверки: мерж PR, на nb `git checkout master && git pull --ff-only` в `C:\projects\js\windows11-manager`.
