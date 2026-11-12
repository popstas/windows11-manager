# Spawn по проекту head, режим deck и описания в трее: план менеджера

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /claude-wt/session-new` пускает ребёнка head в каталог под `claudeWt.childCwdRoot`, `claudeWt.childPlacement` получает третий режим `deck`, а вкладка Claude в трее показывает описание и схему выбранного режима.

**Architecture:**
- Правило каталога — чистые функции в `src/claude-wt/session-new-helpers.js`. Это второй проход рядом со старым, старый не меняется. Живость head приходит снаружи функцией.
- Корень уходит обёртке `claude-wt-new` переменной окружения `CCFZF_CHILD_CWD_ROOT` через новый плейсхолдер `{childCwdRoot}` (договорено с исполнителем ccfzf 2026-11-12).
- `deck` — ещё одна ветка в `child-place.js` и `group-layout.js` и в планировщиках `head-zones-helpers.js`.
- Подсказки в трее — статичная разметка на каждый режим и маленький модуль `tauri-app/src/placement-help.js`, который их переключает.

**Tech Stack:** Node.js ESM, vitest, Tauri v2 (frontend — статичные `tauri-app/src/*`, вшиваются в exe при сборке).

**Spec:** `docs/superpowers/specs/2026-11-12-head-hierarchy-and-spawn-cwd-design.md` (части 1 и 3, раздел «Менеджер: реестр детей»). Опирается на `docs/superpowers/specs/2026-11-11-claude-wt-head-zones-design.md`.

## Global Constraints

- **Старый проход не меняется.** `cwd`, который точным совпадением есть в `claudeWt.projects`, проходит как сейчас: с `headId` или без, с окном head на этой машине или без.
- **Условия нового прохода** (`cwd` не в списке), все три сразу:
  - `headId` есть, и у этой сессии есть окно на этой машине;
  - `headCwd` есть в `claudeWt.projects` точным совпадением или лежит строго под `childCwdRoot`;
  - `cwd` — абсолютный POSIX-путь строго под `childCwdRoot` после `path.posix.normalize` и снятия хвостового `/`. Сам корень не годится.
- **Отказы:**
  - без `headId` с `cwd` вне списка — 403, как сейчас;
  - нет окна head, `headCwd` ни в списке, ни под корнем, `cwd` вне корня или равен корню — 403 с причиной;
  - относительный путь — 400;
  - символы `UNSAFE` и управляющие — 400, как сейчас. Проверка распространяется на `headCwd` и `profileCwd`.
- **Нет ключа `childCwdRoot`** (пусто) — нового прохода нет вовсе, всё как сейчас.
- **Сравнение префикса** — только с `root + '/'`: `/home/popstas/projectsX/a` не под `/home/popstas/projects`.
- **Профиль терминала:**
  - свой `cwd` в `claudeWt.projects` — от своего;
  - иначе `profileCwd` из запроса, если он в списке;
  - иначе глобальный `cfg.profile` (то, что `profileForTerminal` уже делает для каталога не из списка).
- **Контракт с обёрткой** (исполнитель ccfzf, 2026-11-12):
  - шаблон: `exec env CCFZF_CHILD_CWD_ROOT='{childCwdRoot}' ~/bin/claude-wt-new '{cwd}' '{name}' '{sessionId}' '{promptFile}' '{permissionMode}' '{head}' '{headId}'`;
  - `{childCwdRoot}` — нормализованный `claudeWt.childCwdRoot` **только когда `cwd` прошёл по правилу корня**. При проходе точным совпадением с `claudeWt.projects` — пустая строка. Иначе проект из белого списка вне `~/projects` (или с путём-симлинком наружу) получил бы exit 3 от обёртки: она проверяет ровно то, что ей передали. Уточнение исполнителя ccfzf 2026-11-12. Экранирование как у остальных;
  - семь позиционных аргументов не меняются, пустое значение — «проверки нет»;
  - `cwd` уходит обёртке нормализованным.
- **`deck` при открытии ребёнка:**
  - зона та же, что у `stack` (`pickStackZone`), ребёнок занимает её целиком, `moves` пуст — братья не двигаются;
  - при явной `zone` и режиме `deck` — тоже вся зона целиком (решение этого плана, см. «Вопросы»);
  - правило «до трёх мест» в `deck` не действует, `slot` в трекере — 1 (верхняя кромка зоны).
- **`deck` в раскладке группы:**
  - head в первую зону пары, все дети во вторую целиком;
  - выбранная сессия сверху, если она ребёнок; иначе порядок детей по глубине не трогать.
  - Режим раскладки менеджер берёт из своего `claudeWt.childPlacement`. Контракт `claude-place` не меняется.
- **Тексты трея** — дословно из спеки, по-русски:
  - **stack** — «ребёнок во второй зоне монитора head; зона делится по вертикали, до трёх мест, четвёртый ложится поверх первого.»
  - **free** — «ребёнок в свободную основную зону любого монитора; свободных нет — делит зону со своими, затем поверх.»
  - **deck** — «все дети во второй зоне целиком, друг на друге; видно верхнего, остальные через пикер.»
  - Строкой ниже, общей для всех: «Ctrl+Win+F10 раскладывает группу по этому же режиму».
- **Живые конфиги машин** (`childCwdRoot`, шаблон `launchSession`, `childPlacement: deck` на nb) правятся только с разрешения Стаса: scp целиком, бэкап `.bak-<дата>` рядом.
- **Коммиты.** Conventional commits, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Ветка `feat/head-spawn-cwd` от текущего master: на нём уже коммиты спеки `7a3febcd` и `c8f4128d`. Пуш не делать — пушит Стас.

## Review Focus

1. **Пути-ловушки.** Ребёнку отказ, наружу корня не пускает ни один путь:
   - `/home/popstas/projects/../.ssh` → 403 (после нормализации вне корня);
   - `/home/popstas/projectsX/a` → 403;
   - `/home/popstas/projects` и `/home/popstas/projects/` → 403;
   - `projects/js/a` → 400;
   - `/home/popstas/projects//js/a/` проходит как `/home/popstas/projects/js/a`.

   Тест — Task 1, `«пути-ловушки»`.
2. **Выдуманный, но корректный uuid `headId`.** 403 «нет окна», и функция живости зовётся ровно с этим id. Тест — Task 2, `«выдуманный headId — 403»`.
3. **Старый проход.** `childCwdRoot` задан, head не жив или `headId` нет, а `cwd` из списка — проходит как раньше. Функция живости при этом не зовётся: это лишний `claudeWtSessions`. Корень обёртке не передаётся, иначе проект из списка вне корня получил бы exit 3. Тест — Task 2, `«старый проход не спрашивает живость и не передаёт корень»`.
4. **`headCwd`, равный корню или подставленный мимо.** `headCwd: /home/popstas/projects` (сам корень) и `headCwd`, которого нет нигде, дают 403. `headCwd` с `UNSAFE` даёт 400. Тест — Task 2, `«headCwd: корень, чужой, мусор»`.
5. **`deck` с четырьмя и больше детьми.** Пятый ребёнок — вся зона целиком, никто не двигается, перехода по кругу 1-2-3 нет. Тест — Task 4, `«deck: пятый ребёнок — вся зона»`.

---

## Файлы

| Файл | Что |
|---|---|
| `src/claude-wt/session-new-helpers.js` (+test) | `normalizeChildCwdRoot`, `childCwdUnderRoot`, второй проход в `parseSessionNewRequest`, `profileCwd` в ответе, `vars.childCwdRoot`. |
| `src/claude-wt/daemon-helpers.js` (+test) | Умолчание `childCwdRoot: ''` и его нормализация в `mergeClaudeWtConfig`. |
| `src/claude-wt/session-new.js` (+test) | Живость head через `claudeWtSessions`, профиль по `profileCwd`. |
| `src/claude-wt/project-helpers.js` (+test) | Плейсхолдер `{childCwdRoot}` в `planWtLaunch`. |
| `src/claude-wt/head-zones-helpers.js` (+test) | `CHILD_PLACEMENTS` с `deck`, `groupPlan({ ..., mode })`. |
| `src/claude-wt/child-place.js` (+test) | Ветка `deck`. |
| `src/claude-wt/group-layout.js` (+test) | `deck` в раскладке, порядок подъёма. |
| `tauri-app/src/index.html`, `tauri-app/src/placement-help.js` (новый), `tauri-app/src/settings.js` | Третья опция, подсказки и схемы, переключение. |
| `src/commands/claude-config-fields.test.js`, `src/commands/placement-help.test.js` (новый) | Сверка разметки и тест переключателя. |
| `config.example.yaml`, `AGENTS.md` | `childCwdRoot`, шаблон `launchSession`, `deck`. |

---

### Task 1: Корень каталогов детей и проверка пути

**Files:**
- Modify: `src/claude-wt/session-new-helpers.js`, `src/claude-wt/session-new-helpers.test.js`, `src/claude-wt/daemon-helpers.js` (`CLAUDE_WT_DEFAULTS`, `mergeClaudeWtConfig`), `src/claude-wt/daemon-helpers.test.js`

**Interfaces:**
- Produces:
  - `normalizeChildCwdRoot(raw) -> string`: `''` для не-строки, пустого или относительного пути; иначе `path.posix.normalize` без хвостового `/`. `'/'` даёт `''`: корнем всей машины ключ не бывает.
  - `childCwdUnderRoot(cwd, root) -> { ok: true, path } | { ok: false, status: 400|403, reason }`.
  - `cfg.childCwdRoot` после `mergeClaudeWtConfig` — уже нормализован.

- [ ] **Step 1: Тесты** (`ROOT = '/home/popstas/projects'`)

```js
it.each([
  ['/home/popstas/projects', '/home/popstas/projects'],
  ['/home/popstas/projects/', '/home/popstas/projects'],
  [' /home/popstas//projects ', '/home/popstas/projects'],
  ['projects', ''], ['/', ''], ['', ''], [undefined, ''],
])('normalizeChildCwdRoot(%j) -> %j', (raw, want) => expect(normalizeChildCwdRoot(raw)).toBe(want));

it('путь под корнем проходит нормализованным', () => {
  expect(childCwdUnderRoot('/home/popstas/projects//js/a/', ROOT)).toEqual({ ok: true, path: '/home/popstas/projects/js/a' });
});

it('пути-ловушки', () => {
  expect(childCwdUnderRoot('/home/popstas/projects/../.ssh', ROOT)).toMatchObject({ ok: false, status: 403 });
  expect(childCwdUnderRoot('/home/popstas/projectsX/a', ROOT)).toMatchObject({ ok: false, status: 403 });
  expect(childCwdUnderRoot('/home/popstas/projects', ROOT)).toMatchObject({ ok: false, status: 403 });
  expect(childCwdUnderRoot('/home/popstas/projects/', ROOT)).toMatchObject({ ok: false, status: 403 });
  expect(childCwdUnderRoot('projects/js/a', ROOT)).toMatchObject({ ok: false, status: 400 });
  expect(childCwdUnderRoot('/etc', ROOT).reason).toContain('claudeWt.childCwdRoot');
});

it('mergeClaudeWtConfig нормализует childCwdRoot, умолчание пусто', () => {
  expect(mergeClaudeWtConfig({}).childCwdRoot).toBe('');
  expect(mergeClaudeWtConfig({ childCwdRoot: '/home/popstas/projects/' }).childCwdRoot).toBe('/home/popstas/projects');
});
```

- [ ] **Step 2:** `npx vitest run src/claude-wt/session-new-helpers.test.js src/claude-wt/daemon-helpers.test.js` — FAIL.
- [ ] **Step 3: Реализация.**
  - `childCwdUnderRoot`: не начинается с `/` — 400 `cwd must be an absolute path`. Затем `path.posix.normalize` и снятие хвостового `/`. Вне корня или равно корню — 403 `cwd <path> is not under claudeWt.childCwdRoot <root>`.
  - В `CLAUDE_WT_DEFAULTS` — `childCwdRoot: ''` с комментарием: корень каталогов детей на стороне ssh, пусто — ребёнок только из `projects`.
  - Тест умолчаний `mergeClaudeWtConfig(undefined)` в `daemon-helpers.test.js` берёт новое поле из `CLAUDE_WT_DEFAULTS` сам, менять его не нужно.
- [ ] **Step 4:** PASS. **Commit** `feat(claude-wt): ключ childCwdRoot и проверка каталога ребёнка`.

### Task 2: Второй проход в `parseSessionNewRequest`

**Files:**
- Modify: `src/claude-wt/session-new-helpers.js`, `src/claude-wt/session-new-helpers.test.js`

**Interfaces:**
- Consumes: `childCwdUnderRoot` (Task 1).
- Produces:
  - `parseSessionNewRequest(raw, { projects, newId, headZones, childCwdRoot = '', isLiveHead = () => false })`;
  - успех — `{ ok: true, vars, zone, profileCwd }`;
  - `vars` получает `childCwdRoot`: корень, если `cwd` прошёл по правилу корня, иначе `''`, в том числе при старом проходе с заданным корнем;
  - `vars.cwd` — нормализованный путь (при старом проходе — как пришёл);
  - `profileCwd` — каталог, по которому берётся профиль: свой `cwd` из списка, иначе `body.profileCwd` из списка, иначе свой `cwd`.

- [ ] **Step 1: Тесты** (`ROOT` как в Task 1; `PROJ = [{ cwd: '/vault' }, { cwd: '/home/popstas/projects/text/obsidian/ExpertizeMe' }]`; `HEAD = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'`; `live = vi.fn(id => id === HEAD)`; `CHILD = { ...BODY, cwd: '/home/popstas/projects/js/amnezia-shared-panel', headId: HEAD, headCwd: '/home/popstas/projects/text/obsidian/ExpertizeMe' }`)
  - `«ребёнок head под корнем проходит»`: `ok: true`, `vars.cwd` — каталог amnezia, `vars.childCwdRoot === ROOT`, `live` вызван с `HEAD`.
  - `«profileCwd: свой из списка, иначе присланный из списка, иначе свой»`:
    - тело с `profileCwd: '/vault'` → `profileCwd === '/vault'`;
    - тело с `profileCwd: '/nope'` → каталог amnezia;
    - старый проход с `cwd: '/vault'` → `'/vault'`.
  - `«выдуманный headId — 403»`: uuid `11111111-…`, не живой → 403, причина содержит `no window`, `live` вызван с ним.
  - `«без headId вне списка — 403 как раньше»`: причина `cwd … is not in claudeWt.projects`.
  - `«без childCwdRoot нового прохода нет»`: тот же `CHILD`, но `childCwdRoot: ''` → 403, `live` не вызывался.
  - `«старый проход не спрашивает живость и не передаёт корень»`: `cwd: '/vault'`, `headId: HEAD`, `live = vi.fn(() => false)` → `ok: true`, `live` не вызывался, `vars.childCwdRoot === ''`.
  - `«headCwd: корень, чужой, мусор»`:
    - `headCwd: ROOT` → 403;
    - `headCwd: '/opt/x'` → 403;
    - нет `headCwd` → 403 с причиной про `headCwd`;
    - `headCwd: '/home/popstas/projects/a;b'` → 400.
  - `«headCwd под корнем годится»`: внук — `headCwd: '/home/popstas/projects/js/amnezia-shared-panel'`, `cwd` — другой каталог под корнем → `ok: true`.
  - `«пути-ловушки через запрос»`: `cwd: '/home/popstas/projects/../.ssh'` → 403; `cwd: 'js/a'` → 400.
  - Существующий тест `«fills the optional values …»` получает `childCwdRoot: ''` в `vars` и `profileCwd: '/vault'`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Реализация.**
  - `headCwd` и `profileCwd` входят в `values` (обрезка и сито `UNSAFE`/управляющих). Обязательными они не становятся.
  - После проверок полей:
    - `cwd` в списке — старый проход;
    - иначе без `headId` — прежний 403;
    - иначе без корня — 403 `cwd <cwd> is not in claudeWt.projects, and claudeWt.childCwdRoot is not set`;
    - иначе по порядку: `childCwdUnderRoot(cwd)`, затем `headCwd` (обязателен; в списке или `childCwdUnderRoot(headCwd).ok`), затем последним `isLiveHead(headId)` — 403 `head <headId> has no window on this machine`.
  - Живость последней: она стоит чтения сессий.
- [ ] **Step 4:** PASS. **Commit** `feat(claude-wt): session-new пускает ребёнка head под childCwdRoot`.

### Task 3: Запуск — живость head, профиль, плейсхолдер `{childCwdRoot}`

**Files:**
- Modify:
  - `src/claude-wt/session-new.js`, `src/claude-wt/session-new.test.js`;
  - `src/claude-wt/project-helpers.js` (`planWtLaunch`), `src/claude-wt/project-helpers.test.js`;
  - `config.example.yaml` (шаблон `launchSession` и ключ `childCwdRoot`);
  - `AGENTS.md` (раздел «Окна head и детей по зонам» или рядом — пункт про второй проход и корень).

**Interfaces:**
- Consumes: Task 2 (`profileCwd`, `vars.childCwdRoot`).
- Produces:
  - `openNewSession` deps: `liveHeadIds = () => Set<string>`, по умолчанию — id открытых сессий с окном из `claudeWtSessions({ brief: true })` (`ok: false` — пустое множество);
  - `planWtLaunch` подставляет `{childCwdRoot}` с экранированием `escapeForSingleQuoted`.

- [ ] **Step 1: Тесты.**
  - `project-helpers.test.js`, `«{childCwdRoot} подставляется и экранируется»`: шаблон `exec env CCFZF_CHILD_CWD_ROOT='{childCwdRoot}' x`. С `vars.childCwdRoot = "/home/popstas/projects"` в аргументе стоит этот путь, при пустом — `CCFZF_CHILD_CWD_ROOT=''`.
  - `session-new.test.js` (`cfg` с `childCwdRoot: '/home/popstas/projects'` и `projects` из `/vault` с профилем `Expertize`):
    - `«ребёнок под корнем — профиль от profileCwd и корень в команде»`: тело с `profileCwd: '/vault'`, `headCwd: '/vault'`, `liveHeadIds: () => new Set([HEAD])` → `spawned[0].args` содержат `-p Expertize` и `CCFZF_CHILD_CWD_ROOT='/home/popstas/projects'`;
    - `«head без окна — 403 и spawn не звался»`: `liveHeadIds: () => new Set()`;
    - `«liveHeadIds не зовётся для каталога из списка»`; в команде при этом `CCFZF_CHILD_CWD_ROOT=''`, хотя `childCwdRoot` в конфиге задан.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Реализация.**
  - `parseSessionNewRequest(body, { projects: cfg.projects, newId, headZones: cfg.headZones, childCwdRoot: cfg.childCwdRoot, isLiveHead: id => liveHeadIds().has(id) })`.
  - `profileForTerminal(parsed.profileCwd, chosen.name, cfg)`.
  - В `planWtLaunch` к `sessionVars` добавляется ключ `childCwdRoot`, регулярка подстановки расширяется на него.
  - `config.example.yaml`:
    - шаблон `launchSession` — дословно из Global Constraints;
    - закомментированный `childCwdRoot: /home/popstas/projects` с пояснением: путь на стороне ssh, обёртка перепроверяет по `pwd -P`.
- [ ] **Step 4:** PASS; `npm test`. **Commit** `feat(claude-wt): корень детей в команду обёртки, профиль по проекту head`.

### Task 4: Режим `deck` при открытии ребёнка

**Files:**
- Modify: `src/claude-wt/head-zones-helpers.js` (`CHILD_PLACEMENTS`), `src/claude-wt/head-zones-helpers.test.js`, `src/claude-wt/child-place.js`, `src/claude-wt/child-place.test.js`

**Interfaces:**
- Produces: `CHILD_PLACEMENTS = ['stack', 'free', 'deck']`. `normalizeChildPlacement('deck') === 'deck'`.

- [ ] **Step 1: Тесты.**
  - `head-zones-helpers.test.js`: `normalizeChildPlacement` для `deck` / `DECK ` → `deck`. Существующая проверка `CHILD_PLACEMENTS` в `claude-config-fields.test.js` получает `['stack', 'free', 'deck']`.
  - `child-place.test.js` (`childPlacement: 'deck'`, head в `1:3`):
    - `«deck: ребёнок в 1:4 целиком, братья не двигаются»`: в 1:4 двое своих на половинах → `placed` = только новое окно, `pos` равен `R['1:4']`, `desktop: 1`;
    - `«deck: пятый ребёнок — вся зона»`: четверо своих в 1:4 → `pos` равен `R['1:4']`;
    - `«deck: head вне основной зоны — вторая зона пары»`;
    - `«deck с явной zone — вся зона»`: `zone: { monitor: 3, position: 4 }`, свой ребёнок уже в 3:4 → `pos` равен `R['3:4']`, `moves` пуст;
    - лог содержит `(deck), место 1 из 1`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Реализация.**
  - Зона при `deck` выбирается как у `stack` (`pickStackZone`), при явной `zone` — она.
  - План при `deck`: `{ moves: [], pos: target.rect }`, `slot = 1`, `places = 1`.
  - Режим в логе — `deck`, а для явной зоны `zone` (как сейчас).
- [ ] **Step 4:** PASS. **Commit** `feat(claude-wt): режим deck — ребёнок во второй зоне целиком`.

### Task 5: `deck` в раскладке группы

**Files:**
- Modify: `src/claude-wt/head-zones-helpers.js` (`groupPlan`), `src/claude-wt/head-zones-helpers.test.js`, `src/claude-wt/group-layout.js`, `src/claude-wt/group-layout.test.js`

**Interfaces:**
- Consumes: `CHILD_PLACEMENTS` (Task 4).
- Produces: `groupPlan({ first, second, n, mode = 'stack' })`. При `mode === 'deck'` `children` — `n` копий `second`. Для остальных режимов — как сейчас.

- [ ] **Step 1: Тесты.**
  - `head-zones-helpers.test.js`: `groupPlan({ …, n: 4, mode: 'deck' }).children` — четыре раза `SECOND`; без `mode` — как раньше.
  - `group-layout.test.js`, `cfg` с `childPlacement: 'deck'`:
    - `«deck: дети во второй зоне целиком»`: 4 ребёнка → все `pos` равны `R['3:4']`;
    - `«deck: выбранный ребёнок поднят последним»`: `selected: 'c1'` → порядок `bringToTop` — head, затем окно `c1`; остальные дети не поднимаются; фокус на `c1`;
    - `«deck: выбран head — дети не поднимаются»`: `bringToTop` только у head;
    - `«stack: раскладка прежняя»` — существующий тест на 4 ребёнка остаётся зелёным.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Реализация.**
  - `arrangeGroup` берёт режим из `cfg.childPlacement` и передаёт его в `groupPlan`.
  - Подъём при `deck` (только на столе head, как сейчас): head, затем выбранный, если он ребёнок группы.
  - Фокус: `pickFocusTarget` по этому же списку окон и `activeBefore`.
  - При `stack` и `free` — без изменений.
- [ ] **Step 4:** PASS; `npm test`. **Commit** `feat(claude-place): deck в раскладке группы, выбранный сверху`.

### Task 6: Трей — третья опция, описания и схемы

**Files:**
- Create: `tauri-app/src/placement-help.js`, `src/commands/placement-help.test.js`
- Modify: `tauri-app/src/index.html` (селект `cfg_claude_wt_child_placement` и блок подсказок под ним), `tauri-app/src/settings.js` (импорт и вызов при заполнении и на `change`), `src/commands/claude-config-fields.test.js`, `AGENTS.md`

**Interfaces:**
- Produces: `tauri-app/src/placement-help.js` — ES-модуль без `window`:
  - `placementHelpMode(value) -> 'stack'|'free'|'deck'` (пусто и незнакомое — `stack`, умолчание);
  - `syncPlacementHelp(root, value)`: каждому узлу `root.querySelectorAll('[data-placement-help]')` ставит `hidden = node.dataset.placementHelp !== mode`.

- [ ] **Step 1: Тесты.**
  - `placement-help.test.js`, импорт `../../tauri-app/src/placement-help.js`:
    - `«пусто и мусор — stack»`;
    - `«syncPlacementHelp показывает ровно один блок»`: фейковый `root` с тремя `{ dataset: { placementHelp }, hidden }` → после `deck` видим только блок `deck`.
  - `claude-config-fields.test.js`, `«у каждого режима childPlacement — блок подсказки с текстом из спеки»`: для каждого из `CHILD_PLACEMENTS` в `index.html` есть `data-placement-help="<mode>"` с текстом режима дословно из Global Constraints. Строка «Ctrl+Win+F10 раскладывает группу по этому же режиму» есть один раз.
  - Сверка `select` с `choices` из прошлой фичи требует опцию `deck`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Разметка.**
  - Опции селекта:
    - `(default — stack)`;
    - `stack — стопкой во второй зоне`;
    - `free — в свободные зоны`;
    - `deck — колодой во второй зоне`.
  - Под селектом — `<div class="placement-help" data-placement-help="<mode>">` на каждый режим. В блоке `<pre class="schema">` со схемой из спеки (своя часть на режим) и `<p>` с текстом. Схемы:

```
stack:            free:                       deck:
┌────┬────┐       ┌────┬────┐                 ┌────┬────┐
│ H  │ c1 │       │ H  │ c1 │                 │ H  │ c3 │
│    ├────┤       │    │    │                 │    │(c2)│
│    │ c2 │       └────┴────┘                 │    │(c1)│
│    ├────┤       c2, c3 — в свободные зоны   └────┴────┘
│    │ c3 │       других мониторов
└────┴────┘
```

  - Под блоками — `<small>` со строкой про Ctrl+Win+F10.
  - `pre.schema` — моноширинный шрифт и `line-height: 1.1`, в `style.css`.
- [ ] **Step 4: Поведение.** `settings.js`: `syncPlacementHelp(document, select.value)` после `fillClaudeConfig` и на событии `change` селекта.
- [ ] **Step 5:** PASS; `npm test`; `npm run lint`. **Commit** `feat(tray): режим deck и описания режимов childPlacement`.

### Task 7: Выкатка и живая проверка на nb

**Предусловие.** Разрешение Стаса на правку живого конфига nb, бэкап `.bak-<дата>` рядом:
- `childCwdRoot: /home/popstas/projects`;
- шаблон `launchSession.args` в форме env.

Без разрешения выкатывается код и проверяется только то, что не требует ключа.

- [ ] **Step 1: Выкатка.** Ветка `feat/head-spawn-cwd` → nb git-бандлом (memory `windows-ssh-delivery`), затем `deploy-pc.sh --no-pull`: со сборкой, разметка вшита в exe.
- [ ] **Step 2: Без ключа.** `POST /claude-wt/session-new` с `cwd` вне списка и любым `headId` → 403 `…childCwdRoot is not set`. `cwd` из списка — сообщение отказа прежнее.
- [ ] **Step 3: С ключом** (после разрешения). `cwd: '/etc'`, `'/home/popstas/projects/../.ssh'`, `'/home/popstas/projects'` → 403; выдуманный `headId` → 403 `no window`. Это просьбы без spawn.
- [ ] **Step 4: Spawn — head-сессии** (только head может звать spawn.mjs): пункты 1, 2, 9 спеки. `deck` включает Стас во вкладке Claude.
- [ ] **Step 5: Трей.** `claude-wt config get` показывает текущий режим; смена селекта меняет подсказку — глазами Стаса.

## Вопросы к Стасу

1. Разрешение на правку живого конфига nb (и popstas-pc, когда он понадобится): `childCwdRoot: /home/popstas/projects` и шаблон `launchSession` в форме `exec env CCFZF_CHILD_CWD_ROOT='{childCwdRoot}' …`. Без шаблона обёртка не перепроверяет симлинки, без ключа нового прохода нет.
2. `deck` с явной `--zone`: план кладёт ребёнка в названную зону целиком (так же, как без зоны). Если нужно «явная зона всегда делится стопкой», сказать.
3. Раздел «Менеджер: реестр детей» не делается. Привязанные окна не в реестре, и следующий spawn может лечь на место привязанного до Ctrl+Win+F10. Спека это допускает, а честный подсчёт потребовал бы читать `~/.ccfzf/children` по SMB, от чего ушли 11.11. Сделать позже, если будет мешать.
