# Явная иконка и значок окна сессии из claude-wt CLI — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** агент командой `claude-wt window icon|badge <session> <имя>|--clear` ставит окну своей сессии иконку и значок из папки иконок машины окна, и явное перебивает всю автоматику.

**Architecture:** в службе менеджера (`node src/index.js mqtt`) — хранилище заданного по `sessionId` (JSON в `data/`), общее для http-маршрутов и службы иконок; служба накладывает заданное поверх `iconFor` и отвечает маршрутам, встало ли. CLI в ccfzf — по образцу `session unread/seen`: свои сессии, менеджер по машине окна, http.

**Tech Stack:** Node ESM; менеджер — vitest (`npm test`); CLI — `node --test tests/cli/*.test.mjs` в `~/projects/shell/ccfzf`.

**Spec:** `docs/superpowers/specs/2026-11-23-session-icon-design.md`

## Global Constraints

- Приоритет: иконка — явная > значок head в `headMode: icon` > проект/профиль; значок — явный > значок head > первое правило `badges`.
- Имена — только `.ico` из `claudeWt.windowIcons.dir`, плоско, без учёта регистра; имя, которого нет в списке, — отказ `unknown icon <имя>; see claude-wt window icons`.
- Нет `windowIcons.dir` и ставится имя — отказ `icons dir not configured (claudeWt.windowIcons.dir)`; `--clear` папки не требует.
- Поставить нельзя — сохранить, `ok: true`, `applied: false`, `reason` ∈ `no window` | `icons disabled` | `no overlay support` | `no icon service` | `not applied (see tray log)`.
- Хранилище: `data/session-icons.json` от `process.cwd()` службы, `{ [sessionId]: { icon?, badge?, at } }`, атомарно (`writeFileAtomic`); `at` освежается, пока окно на экране, на диск — не чаще раза в сутки; записи с `at` старше 30 дней удаляются при записи.
- Маршруты только http: `/claude-wt/window-icon`, `/claude-wt/window-badge`, `/claude-wt/window-icons`.
- CLI: только свои сессии; видимые человеку строки — по-английски; комментарии и названия тестов — по-русски.
- Ветки `feat/session-icon` в обоих репо, PR в каждом, мерж по слову Стаса; выкатка менеджера — только nb.

## Review Focus

1. Явная иконка у head в `headMode: icon` — встаёт явная, а не значок head (тест в Task 2).
2. Явный значок, потом `--clear` — значок возвращается к автоматике (head / `badges`), а не остаётся пустым (тест в Task 2).
3. Перезапуск службы — заданное читается из файла и встаёт без повторной команды (тест в Task 1 и Task 2).
4. Имя с путём или `..` (`../secret`, `C:\x`) — отказ «unknown icon», файл вне папки не ставится (тест в Task 1).
5. Окна сессии на двух машинах — команда ставит на обеих, код — худший из исходов (тест в Task 4).

---

### Task 1: хранилище и имена иконок

**Files:**
- Create: `src/claude-wt/session-icons.js`
- Modify: `src/claude-wt/daemon-helpers.js` (умолчание `windowIcons.dir: ''`)
- Test: `src/claude-wt/session-icons.test.js`

**Interfaces:**
- Produces:
  - `listIcons(dir: string): string[]` — имена `.ico` (без расширения, исходный регистр), отсортированы; нет папки — бросает.
  - `resolveIcon(name: string, dir: string): string | null` — абсолютный путь (`path.join(dir, file)`) файла, чьё имя без учёта регистра равно `name`; иначе `null`.
  - `createSessionIconStore({ file: string, now?: () => number }): Store`, где `Store`:
    - `get(id): { icon?: string, badge?: string } | undefined`
    - `set(id, kind: 'icon'|'badge', path: string|null): void` — `null` снимает поле; запись без полей удаляется; `at = now()`; пишет файл сразу.
    - `touch(ids: Iterable<string>): void` — `at = now()` у существующих записей; на диск — только если у какой-то из них записанный `at` старше суток.
    - `version: number` — растёт на каждом изменении содержимого (`set`; `touch` не меняет).
  - при любой записи на диск — удаление записей с `at` старше 30 дней; константы `DAY_MS`, `KEEP_MS` экспортируются.

- [ ] **Step 1: Падающие тесты** (временный каталог через `fs.mkdtempSync`):
  - `'listIcons — только .ico, без расширения, по алфавиту'` — файлы `telegram.ico`, `Planfix.ICO`, `home assistant.png`, подкаталог `sub/` → `['Planfix', 'telegram']`.
  - `'resolveIcon — без учёта регистра'` — `resolveIcon('planfix', dir)` → `path.join(dir, 'Planfix.ICO')`.
  - `'resolveIcon — путь и .. не проходят'` — `'../x'`, `'sub/telegram'`, `path.join(dir, 'telegram.ico')`, `'telegram.ico'` → `null`.
  - `'set и get, снятие поля, пустая запись удаляется'`.
  - `'заданное переживает перезапуск'` — новый `createSessionIconStore` на том же файле видит запись.
  - `'touch пишет на диск не чаще раза в сутки'` — `now` +1 ч → mtime/содержимое файла не изменилось; +25 ч → `at` в файле новый.
  - `'запись старше 30 дней удаляется при записи'` — запись A с `at` = 0, `now` = 31 сут, `set('B', …)` → в файле нет A.
  - `'битый файл — пустое хранилище, а не падение'`.

- [ ] **Step 2: Запустить — падают.** Run: `npx vitest run src/claude-wt/session-icons.test.js` Expected: FAIL (модуля нет).

- [ ] **Step 3: Реализовать** `session-icons.js`; файл читается один раз в `createSessionIconStore`, дальше память — писатель один (процесс службы). Умолчание `dir: ''` в `CLAUDE_WT_DEFAULTS.windowIcons`.

- [ ] **Step 4: Запустить.** Run: `npx vitest run src/claude-wt/` Expected: PASS.

- [ ] **Step 5: Коммит** `feat(claude-wt): хранилище явных иконок сессий и имена из папки иконок`.

---

### Task 2: служба иконок накладывает заданное

**Files:**
- Modify: `src/mqtt/window-icons.js`
- Test: `src/mqtt/window-icons.test.js`

**Interfaces:**
- Consumes: `Store` из Task 1.
- Produces:
  - `startWindowIcons({ ..., store })` — `store` необязателен (нет — явного нет).
  - у возвращаемого объекта `statusOf(sessionId: string, kind: 'icon'|'badge'): { applied: boolean, reason?: string }`; у объекта-заглушки (аддон без `setWindowIcon`) — `{ applied: false, reason: 'no icon service' }`.

- [ ] **Step 1: Падающие тесты** (фикстура `setup` получает `store` — настоящий из Task 1 на временном файле):
  - `'явная иконка перебивает иконку проекта и попадает демону'` — `store.set('c','icon','C:\\ico\\tg.ico')` до старта → `calls` `[2,'C:\\ico\\tg.ico']`, `published` несёт её у `c`.
  - `'явная иконка у head в режиме icon — явная, не значок head'`.
  - `'явный значок перебивает значок head и правило badges'`.
  - `'снятие явного значка возвращает автоматику'` — после `set(...,null)` и `tick()` → у head снова `icons/head-badge.ico`.
  - `'правка хранилища замечается на следующем тике, не через refreshMs'`.
  - `'statusOf: applied у окна на экране; no window без окна; icons disabled при enabled: false; no overlay support у badge без SetOverlayIcon'`.
  - `'statusOf: not applied, если setOverlayIcon вернул false'`.
  - `'touch зовётся с sessionId окон на экране'` — шпион на `store.touch`.

- [ ] **Step 2: Запустить — падают.** Run: `npx vitest run src/mqtt/window-icons.test.js`

- [ ] **Step 3: Реализовать.** В `tick`: `store.version` — в отпечаток `print`; `wanted` = `iconFor(...)`, затем `{ icon: e.icon || want.icon, overlay: e.badge || want.overlay }` из `store.get(s.sessionId)`, затем прежнее обнуление overlay без `canOverlay`; `store.touch(sessionIds)`. Для `statusOf` запомнить с последнего тика `enabled`, `sessions` (sessionId → hwnd) и `applied`; `applied: true`, когда у окна этой сессии поставленное (`applied.get(hwnd).icon|overlay`) равно заданному (для снятого — окно на экране).

- [ ] **Step 4: Запустить всё.** Run: `npm test` Expected: PASS.

- [ ] **Step 5: Коммит** `feat(window-icons): явная иконка и значок сессии поверх автоматики`.

---

### Task 3: команды и маршруты менеджера

**Files:**
- Create: `src/commands/session-icon-commands.js`
- Modify: `src/commands/build.js` (регистрация), `src/http-server.js` (`ROUTES`), `src/mqtt/service.js` (одно хранилище на маршруты и службу), `config.example.yaml` (`windowIcons.dir`)
- Test: `src/commands/session-icon-commands.test.js`, `src/http-server.test.js`

**Interfaces:**
- Consumes: `listIcons`, `resolveIcon`, `Store` (Task 1); `statusOf`, `tick` (Task 2).
- Produces: `sessionIconCommands({ store, icons: () => service|null, getCfg: () => cfg, log })` → `{ 'claude-window-icon', 'claude-window-badge', 'claude-window-icons' }`:
  - `claude-window-icon({ id, icon: string|null })` → `{ ok: true, id, icon: path|null, applied, reason? }` | `{ ok: false, reason }`;
  - `claude-window-badge({ id, badge })` — то же с полем `badge`;
  - `claude-window-icons({})` → `{ ok: true, dir, names }` | `{ ok: false, reason }`.
  - тело — объект или JSON-строка (как `parseIdPayload`); нет `id` — `{ ok: false, reason: 'no id' }`.
  - после `store.set` — `icons()?.tick()`, затем `icons()?.statusOf(...) ?? { applied: false, reason: 'no icon service' }`.

- [ ] **Step 1: Падающие тесты:**
  - `'ставит по имени, путь из папки, statusOf в ответе'` — фейковый `icons` с `tick`/`statusOf` (шпионы).
  - `'неизвестное имя — отказ, хранилище не тронуто'` — `reason` ровно `unknown icon nope; see claude-wt window icons`.
  - `'нет windowIcons.dir — отказ на имя, снятие работает'`.
  - `'службы нет — сохранено, applied: false, no icon service'`.
  - `'window-icons — список имён и dir; нет dir — отказ'`.
  - в `http-server.test.js`: три новых пути → `claude-window-icon`, `claude-window-badge`, `claude-window-icons`.

- [ ] **Step 2: Запустить — падают.** Run: `npx vitest run src/commands/session-icon-commands.test.js src/http-server.test.js`

- [ ] **Step 3: Реализовать.** В `service.js` хранилище создаётся до `createRouter` (`file: path.resolve(process.cwd(), 'data', 'session-icons.json')`), в `buildCommandMap` уходит `sessionIcons: { store, icons: () => windowIcons }` (замыкание читает `windowIcons` уже после её создания), в `startWindowIcons` — тот же `store`. Строки журнала: `claude-wt window icon <id>: <путь|снята> (<applied|reason>)`. В `config.example.yaml` у блока `windowIcons` — строка `# dir: 'C:\\images\\ico'  # папка иконок для claude-wt window icon/badge`.

- [ ] **Step 4: Запустить всё.** Run: `npm test` Expected: PASS.

- [ ] **Step 5: Коммит** `feat(claude-wt): маршруты window-icon, window-badge, window-icons`.

---

### Task 4: команды CLI (репо ccfzf)

**Где работать:** основной клон `~/projects/shell/ccfzf` — живой CLI всех
агентов (симлинк `~/bin/claude-wt`), ветку в нём не переключать. Работа — в
отдельном worktree: `git -C ~/projects/shell/ccfzf worktree add
~/projects/shell/ccfzf-session-icon -b feat/session-icon main`; все пути и
команды задачи — от него.

**Files:**
- Create: `cli/lib/commands/window-icon.mjs` (экспорт `icon`, `badge`), `cli/lib/commands/window-icons.mjs`
- Modify: `cli/claude-wt.mjs` (`USAGE`, `COMMANDS`, булев флаг `--clear`), `docs/claude-wt.md`
- Test: `tests/cli/window-icon.test.mjs`, `tests/cli/help.test.mjs`

**Interfaces:**
- Consumes: маршруты Task 3; `context`, `ownTarget`, `manager` из `cli/lib/act.mjs`; `post`, `answer`, `timeoutMs` из `cli/lib/manager.mjs`.
- Produces:
  - `claude-wt window icon <session> <name>|--clear`, `claude-wt window badge <session> <name>|--clear` — тело `{ id, icon|badge: name|null }`; машины — все машины окон сессии (как `windowHosts` в `session-mark.mjs` — вынести в общий модуль, не копировать); `--machine`/`--url` — одна названная; окон нет и машина не названа — код 2 `no window`; итог `{ id, title, code, results: [{ host, url, code, icon|badge, applied, reason? }] }`, код — худший; текст: `set <kind> <name> for <title> on <hosts>` или `saved <kind> …, not applied on <host>: <reason>`.
  - имя и `--clear` вместе или ни одного — отказ `need <name> or --clear`.
  - `claude-wt window icons` — машина первого окна своей сессии (`CLAUDE_CODE_SESSION_ID`); с `--machine`/`--url` вызывающий не нужен; вывод — имена по одному в строке, `--json` — `{ host, dir, names }`.

- [ ] **Step 1: Падающие тесты** по образцу `session-mark.test.mjs` (`mockManager`, `world`):
  - `'icon: POST /claude-wt/window-icon {id, icon}'`, `'badge --clear шлёт null'`.
  - `'applied: false — код 0, причина в тексте'`.
  - `'отказ менеджера (unknown icon) — код 1, причина в error'`.
  - `'чужая сессия — отказ до запроса'`.
  - `'окна на двух машинах — запрос на обе, худший код'`.
  - `'нет имени и нет --clear — отказ'`.
  - `'window icons — имена построчно и --json'`.
  - в `help.test.mjs`: `window icon <session>`, `window badge <session>`, `window icons` в справке.

- [ ] **Step 2: Запустить — падают.** Run (в `~/projects/shell/ccfzf`): `node --test tests/cli/window-icon.test.mjs tests/cli/help.test.mjs`

- [ ] **Step 3: Реализовать**, затем строку о командах в `docs/claude-wt.md`.

- [ ] **Step 4: Запустить всё.** Run: `node --test tests/cli/*.test.mjs` Expected: PASS.

- [ ] **Step 5: Коммит** `feat(cli): claude-wt window icon, window badge, window icons`.

---

### Task 5: скиллы

**Files:**
- Create: `~/.claude/skills/set-icon/SKILL.md`, `~/.claude/skills/set-badge/SKILL.md`
- Modify: `~/.claude/skills/claude-wt-cli/SKILL.md` (три строки в блоке команд, пункт в «Что можно без спроса»), `~/.claude/skills/claude-wt/SKILL.md` (абзац рядом с `badges`)

- [ ] **Step 1:** Скиллы — frontmatter `name`/`description` (когда звать: «поставь иконку/значок …», выделить свою сессию или ребёнка среди однотипных; не для иконки проекта — та в конфиге), тело: узнать имена (`claude-wt window icons`), поставить, снять (`--clear`), что явное перебивает правила и значок head, что `applied: false` — сохранено и встанет само, коды выхода. Ставить без спроса — да: окно не поднимается и ввод не уводится (*решение исполнителя плана; Стас может отменить*).
- [ ] **Step 2: Проверка:** `grep -l "window icon" ~/.claude/skills/*/SKILL.md` — четыре файла.

---

### Task 6: PR, выкатка, живая проверка

- [ ] **Step 1:** пуш обеих веток, PR в каждом репо (ссылки друг на друга).
- [ ] **Step 2:** nb: проверить ветку на nb (чужая под ревью — сборная `deploy/<a>-<b>`), `BRANCH=feat/session-icon ./data/scripts/deploy-pc.sh --no-build`; ожидается `== готово` и PID в `Console`.
- [ ] **Step 3:** живой конфиг nb: `windowIcons.dir: 'C:\images\ico'` в блок `windowIcons`, бэкап `.bak-2026-11-23-session-icon`, `cmp` после заливки.
- [ ] **Step 4:** CLI на pc-virt: основной клон ccfzf не трогать до мержа; живая проверка — `node ~/projects/shell/ccfzf-session-icon/cli/claude-wt.mjs …` из этой сессии.
- [ ] **Step 5:** живьём: `window icons` → список с `telegram`; `window badge <своя сессия> telegram` → `applied: true` и строка `значок C:\images\ico\telegram.ico` в журнале трея; `--clear` → значок вернулся к автоматике. Не удалось — сказать прямо.
- [ ] **Step 6:** мерж — по слову Стаса; затем nb на `master`, `git pull` основного клона ccfzf на `main`, worktree убрать.
