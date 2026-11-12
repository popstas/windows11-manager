# Окна входящих из Telegram в фоне — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** окно сессии на входящий файл из Telegram открывается и ставится на место без фокуса; пауза очереди 1000 мс; `gapMs` и `background` правятся во вкладке Claude окна настроек.

**Architecture:** флаг `focus` в `focusSpawnedWindow` (та же ветка, что у ребёнка head с `placed.focus === false`), `background` из `telegramInbox` доходит до него через `openInboxSession`. Поля вкладки Claude учатся ключам третьего уровня: `section` может быть путём через точку.

**Tech Stack:** Node.js ESM, vitest, `yaml` (parseDocument/getIn), Tauri v2 (HTML формы без изменений Rust).

**Spec:** `docs/superpowers/specs/2026-11-13-inbox-background-window-design.md`

## Global Constraints

- Не возвращать фокус окну, активному до запуска. Никакой дополнительной постановки (назад, свернуть, мигание).
- `claudeWt.telegramInbox.background` по умолчанию `true`; `false` — старое поведение (фокус + переключение стола).
- `claudeWt.telegramInbox.gapMs` по умолчанию `1000` (было 3000).
- Проектные хоткеи, `session-new`, restore — поведение фокуса без изменений.
- Конфиг правится точечно: байты вне значения не меняются (контракт `patchConfigScalar`).
- Нет блока `telegramInbox` в конфиге → отказ с понятным текстом, файл не тронут; вложенную секцию не создавать.
- Живой конфиг nb: scp целиком, UTF-8 без BOM, бэкап `windows11-manager.config.yaml.bak-2026-11-13` рядом.
- Комментарии в коде — по-русски, в стиле соседних.

## Review Focus

1. Конфиг без блока `claudeWt.telegramInbox`, человек меняет `gapMs` в форме → читаемый отказ «допишите блок вручную», файл не тронут (Task 3).
2. `telegramInbox: { enabled: true, ... }` во flow-стиле → тот же отказ, что у flow-секции второго уровня (Task 3).
3. Ключ `gapMs` (или `background`) есть и на уровне `claudeWt`, и в `telegramInbox` → правится только вложенный (Task 3).
4. Пустое поле формы при существующем вложенном ключе → строка вырезана, соседи и отступы целы; ключа нет → текст без изменений (Task 3).
5. `background: false` → `focus` зовётся как раньше; двухуровневые поля работают как до правки (существующие тесты зелёные) (Task 1, Task 3).

---

### Task 1: фон в `focusSpawnedWindow` и `openInboxSession`

**Files:**
- Modify: `src/claude-wt/project.js:181-222` (`focusSpawnedWindow`, doc-комментарий)
- Modify: `src/claude-wt/inbox.js` (`openInboxSession`, шапка)
- Test: `src/claude-wt/project.test.js`, `src/claude-wt/inbox.test.js`

**Interfaces:**
- Produces: `focusSpawnedWindow(title, deps)` — `deps.focus` занят функцией фокуса, поэтому флаг называется `deps.raise: boolean = true`. При `raise === false`: ждёт окно, `settleMs`, `place(...)`, затем `mark('focus:skipped')`, `return true`. Окно не найдено — `false`, как раньше.
- Produces: `openInboxSession({ file, name, cwd, script, terminal, background = false }, deps)` → зовёт `focusByTitle(name, { mark, raise: !background })`. Результат прежней формы; `focused` = «окно нашлось» (в фоне — без фокуса).

- [ ] **Step 1: Write the failing tests**

`project.test.js`, в `describe('focusSpawnedWindow')`:
```js
it('raise: false — ставит на место, но не поднимает', async () => {
  const h = harness();
  expect(await focusSpawnedWindow('skill-do', { ...h.deps, raise: false })).toBe(true);
  expect(h.calls).toEqual(['find:skill-do', 'wait:4000', 'place:77:skill-do']);
});
```
`inbox.test.js`:
```js
it('background: true — окно без фокуса', async () => {
  const { focusByTitle } = await run({ ...REQ, background: true });
  expect(focusByTitle).toHaveBeenCalledWith('tg-2026-11-05-msg', expect.objectContaining({ raise: false }));
});
it('без background — фокус как раньше', async () => {
  const { focusByTitle } = await run();
  expect(focusByTitle).toHaveBeenCalledWith('tg-2026-11-05-msg', expect.objectContaining({ raise: true }));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/claude-wt/project.test.js src/claude-wt/inbox.test.js`
Expected: FAIL — `focus:77` в журнале; `raise` нет в аргументах.

- [ ] **Step 3: Implement** `raise` в `focusSpawnedWindow` (проверка после `place`, до ветки `placed.focus`) и `background` в `openInboxSession`. В doc-комментарии `focusSpawnedWindow` одной фразой: фон — для входящих из Telegram, где окно приходит само, без просьбы человека.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/claude-wt/`
Expected: PASS, включая старые тесты `focusSpawnedWindow`.

- [ ] **Step 5: Commit**

```bash
git add src/claude-wt/project.js src/claude-wt/project.test.js src/claude-wt/inbox.js src/claude-wt/inbox.test.js
git commit -m "feat(claude-wt): окно сессии без фокуса по флагу raise"
```

### Task 2: `telegramInbox.background` и `gapMs` 1000 в наблюдателе

**Files:**
- Modify: `src/claude-wt/telegram-inbox-helpers.js:121-140` (`normalizeInboxConfig`)
- Modify: `src/mqtt/telegram-inbox.js:134-137` (`openOne` передаёт `background`), шапка файла (строка про `gapMs`)
- Modify: `config.example.yaml` (блок `telegramInbox`: `background: true` с комментарием, `gapMs: 1000`), `README.md` (раздел «Telegram inbox»), `AGENTS.md:174-191` (абзац про очередь: окна в фоне, фокус не берут; пауза — чтобы окна не появлялись пачкой)
- Test: `src/claude-wt/telegram-inbox-helpers.test.js`, `src/mqtt/telegram-inbox.test.js`

**Interfaces:**
- Consumes: `openInboxSession({..., background})` из Task 1.
- Produces: `normalizeInboxConfig(raw).cfg.background: boolean` (`raw.background !== false`), `cfg.gapMs` по умолчанию `1000`. Task 3 сверяет с ними умолчания полей формы.

- [ ] **Step 1: Write the failing tests**

`telegram-inbox-helpers.test.js`, в `describe('normalizeInboxConfig')`:
```js
it('background по умолчанию включён, выключается только false', () => {
  expect(normalizeInboxConfig({}).cfg.background).toBe(true);
  expect(normalizeInboxConfig({ background: 'no' }).cfg.background).toBe(true);
  expect(normalizeInboxConfig({ background: false }).cfg.background).toBe(false);
});
it('gapMs по умолчанию 1000', () => {
  expect(normalizeInboxConfig({}).cfg.gapMs).toBe(1000);
});
```
`telegram-inbox.test.js`: в тесте `'opens each new file once, ...'` (строка ~69) ожидаемый объект получает `background: true`; новый тест — `setup({ inbox: { background: false } })` → `opened[0].background === false`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/claude-wt/telegram-inbox-helpers.test.js src/mqtt/telegram-inbox.test.js`
Expected: FAIL — `background` undefined, `gapMs` 3000.

- [ ] **Step 3: Implement** нормализацию и передачу `background: cfg.background` в `openInboxSession`; поправить доки из списка Files.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/claude-wt/ src/mqtt/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/claude-wt/telegram-inbox-helpers.js src/claude-wt/telegram-inbox-helpers.test.js src/mqtt/telegram-inbox.js src/mqtt/telegram-inbox.test.js config.example.yaml README.md AGENTS.md
git commit -m "feat(telegram-inbox): окна в фоне, пауза очереди 1000 мс"
```

### Task 3: поля третьего уровня во вкладке Claude (node)

**Files:**
- Modify: `src/commands/config-scalar-patch.js` (`findTarget`, `verifyPatch`, `patchConfigScalar`, шапка: «второго уровня» → «путь секции через точку»)
- Modify: `src/commands/claude-config-commands.js:32-41` (`readClaudeConfig` по пути)
- Modify: `src/commands/claude-config-fields.js` (два поля + шапка: скаляры `telegramInbox` теперь на форме)
- Test: `src/commands/config-scalar-patch.test.js`, `src/commands/claude-config-fields.test.js`, `src/commands/claude-config-commands.test.js`

**Interfaces:**
- Consumes: `normalizeInboxConfig` из Task 2 (умолчания).
- Produces: `patchConfigScalar(raw, section, key, value)` — сигнатура прежняя, `section` может быть `'claudeWt.telegramInbox'` (путь = `section.split('.')`). Поля:
  ```js
  { name: 'claudeWt.telegramInbox.gapMs', section: 'claudeWt.telegramInbox', key: 'gapMs', type: 'number', default: 1000 },
  { name: 'claudeWt.telegramInbox.background', section: 'claudeWt.telegramInbox', key: 'background', type: 'boolean', default: true },
  ```
  Task 4 ссылается на эти имена в `data-cfg`.

Правила `findTarget` для пути длиной > 1: узел ищется `doc.getIn(path, true)`; нет узла → `throw` с текстом, содержащим `claudeWt.telegramInbox` и «допишите блок вручную»; `append-section` — только для пути длины 1. Пустая флоу-карта на вложенном уровне (`telegramInbox: {}`) — пара ищется в родительской карте, отступ вставки = отступ ключа секции + 2. Остальные ветки (replace, insert-key, удаление, flow-отказ) работают как есть. `verifyPatch` читает значение по `[...path, key]`.

- [ ] **Step 1: Write the failing tests**

`config-scalar-patch.test.js`, новый `describe('patchConfigScalar: вложенная секция')`, в `SAMPLE`-подобной строке `NESTED` есть `claudeWt.gapMs: 5` и блок `telegramInbox:` (с отступом 2, поля с отступом 4, комментарий над `sessionName`):
```js
it('меняет вложенный ключ, не трогая одноимённый уровнем выше', () => {
  const out = patchConfigScalar(NESTED, 'claudeWt.telegramInbox', 'gapMs', 1000);
  expect(parse(out).claudeWt.telegramInbox.gapMs).toBe(1000);
  expect(parse(out).claudeWt.gapMs).toBe(5);
});
it('дописывает вложенный ключ с отступом блока', () => {
  const out = patchConfigScalar(NESTED_NO_GAP, 'claudeWt.telegramInbox', 'gapMs', 1000);
  expect(out).toContain('\n    gapMs: 1000\n');
});
it('убирает вложенный ключ строкой целиком', () => {
  const out = patchConfigScalar(NESTED, 'claudeWt.telegramInbox', 'gapMs', undefined);
  expect(parse(out).claudeWt.telegramInbox).not.toHaveProperty('gapMs');
  expect(out).toBe(NESTED.replace(/^    gapMs: .*\n/m, ''));
});
it('отказывается, когда блока telegramInbox нет', () => {
  expect(() => patchConfigScalar(SAMPLE, 'claudeWt.telegramInbox', 'gapMs', 1000)).toThrow(/claudeWt\.telegramInbox.*вручную/);
});
it('отказывается вставлять в непустую флоу-карту вложенного блока', () => {
  const raw = 'claudeWt:\n  telegramInbox: { enabled: true }\n';
  expect(() => patchConfigScalar(raw, 'claudeWt.telegramInbox', 'gapMs', 1000)).toThrow(/flow/);
});
it('наполняет пустую вложенную флоу-карту', () => {
  const out = patchConfigScalar('claudeWt:\n  telegramInbox: {}\n', 'claudeWt.telegramInbox', 'gapMs', 1000);
  expect(parse(out).claudeWt.telegramInbox.gapMs).toBe(1000);
});
```
`claude-config-fields.test.js`:
```js
it('умолчания claudeWt.telegramInbox совпадают с normalizeInboxConfig', () => {
  const { cfg } = normalizeInboxConfig({});
  const fields = CLAUDE_CONFIG_FIELDS.filter((f) => f.section === 'claudeWt.telegramInbox');
  expect(fields.map((f) => f.key).sort()).toEqual(['background', 'gapMs']);
  for (const f of fields) expect(f.default).toBe(cfg[f.key]);
});
```
`claude-config-commands.test.js` (по образцу соседнего `free меняет...`): `readClaudeConfig()` отдаёт `'claudeWt.telegramInbox.gapMs'` из файла фикстуры (или `null`, если ключа нет); `writeClaudeConfig({ 'claudeWt.telegramInbox.gapMs': '1000' })` → `['claudeWt.telegramInbox.gapMs']`, в файле `gapMs: 1000` внутри блока. Фикстуре теста при надобности добавить блок `telegramInbox`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/commands/`
Expected: FAIL — поля неизвестны, патчер ищет секцию `'claudeWt.telegramInbox'` на верхнем уровне.

- [ ] **Step 3: Implement** путь в `findTarget`/`verifyPatch`/`readClaudeConfig` и два поля в `CLAUDE_CONFIG_FIELDS` (после `childPlacement`, комментарием «Входящие из Telegram»).

- [ ] **Step 4: Run to verify they pass**

Run: `npm test && npm run lint`
Expected: всё PASS, lint без ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/commands/
git commit -m "feat(settings): поля claudeWt.telegramInbox.gapMs и background во вкладке Claude"
```

### Task 4: группа «Telegram inbox» в окне настроек

**Files:**
- Modify: `tauri-app/src/index.html` — новая `<h3 class="group">Telegram inbox</h3>` между группой «Head session children» и «Session slots on the Home Assistant panel»

**Interfaces:**
- Consumes: имена полей из Task 3.

- [ ] **Step 1: Add markup** по образцу соседних полей:
  - `<input type="number" id="cfg_tg_inbox_gap_ms" data-cfg="claudeWt.telegramInbox.gapMs" data-cfg-default="1000" data-cfg-type="number" min="0" placeholder="1000">`, label `claudeWt.telegramInbox.gapMs (ms)`, small: «Pause between two inbox windows when several files arrive at once.»
  - чекбокс `id="cfg_tg_inbox_background" data-cfg="claudeWt.telegramInbox.background" data-cfg-default="true" data-cfg-type="boolean"`, текст «claudeWt.telegramInbox.background — open windows without taking focus», small: «Off: the new window is raised and its virtual desktop is switched to, as before. Needs the telegramInbox block in the YAML config.»

- [ ] **Step 2: Verify build**

Run: `. "$HOME/.cargo/env" && cd tauri-app/src-tauri && rtk proxy cargo build 2>&1 | tail -5`
Expected: `Finished`, без новых warning.

- [ ] **Step 3: Commit**

```bash
git add tauri-app/src/index.html
git commit -m "feat(tray): группа Telegram inbox на вкладке Claude"
```

### Task 5: выкатка на nb и живой конфиг

Не код — выполняет главная сессия, не субагент.

- [ ] **Step 1: Бэкап и правка конфига nb.** scp `%APPDATA%\windows-mqtt\windows11-manager.config.yaml` с `nb.popstas.pro` в scratchpad; на nb рядом копия `.bak-2026-11-13`; в блок `claudeWt.telegramInbox` после `sessionName` строка `    gapMs: 1000`; залить обратно (UTF-8 без BOM — проверить первые байты `head -c3 | xxd`).
- [ ] **Step 2: Доставка ветки.** master не запушен → `git bundle` по `memory/windows-ssh-delivery.md`, на nb `git fetch <bundle> master` + `git merge --ff-only FETCH_HEAD`.
- [ ] **Step 3: Деплой.** `TARGET_HOST=nb.popstas.pro REPO='C:\projects\js\windows11-manager' ./data/scripts/deploy-pc.sh --no-pull` (сборка нужна — менялся HTML трея).
- [ ] **Step 4: Проверка.** В `C:\projects\js\windows11-manager\data\windows11-manager.log` после следующего входящего — строка `[telegram-inbox] open ...` без `window did not show up`; визуально окно не забирает фокус — проверяет Стас. В окне настроек на вкладке Claude видна группа Telegram inbox со значением 1000.
