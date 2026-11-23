# Бейджи окон по заголовку внутри проекта — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** окно сессии проекта получает значок на кнопке панели задач по первому совпавшему правилу `claudeWt.projects[].badges` (регэксп по заголовку).

**Architecture:** разбор `badges` — в `normalizeProjects`; выбор значка — чистая функция в `window-icons-helpers.js`, которую зовёт `iconFor`; заголовок окна доезжает до `iconFor` полем `title` из `claudeWtWindowSessions`; служба иконок (`src/mqtt/window-icons.js`) уже умеет ставить overlay — ей добавляется только отпечаток `badges` и warn о кривом регэкспе.

**Tech Stack:** Node ESM, vitest (`npm test` = `vitest run`), YAML-конфиг.

**Spec:** `docs/superpowers/specs/2026-11-23-project-badges-design.md`

## Global Constraints

- Ключ — `claudeWt.projects[].badges: [{ match, icon }]`, порядок значим, срабатывает первое совпавшее.
- Проект по **точному** cwd сессии — тот же поиск, что в `projectIconFor` (`p.cwd === cwd`).
- `match` — `new RegExp(match)` без флагов, проверяется на заголовке после `stripTitleDecoration`.
- head в режиме `badge` → значок head важнее правила; в `headMode: icon` правило работает.
- Кривой регэксп: правило пропускается, warn в журнал один раз на строку регэкспа.
- `badges` не уезжают в файл трекера (`windows-file-helpers.js`, `projects`).
- Комментарии, названия тестов и `expect`-сообщения — по-русски; строки журнала службы — как у соседей (`window icons: …`).
- Ветка `feat/project-badges`, мерж через PR.

## Review Focus

1. Окно head-сессии с заголовком `planfix_bot-tg-…` — значок head остаётся, правило не перебивает (тест в Task 1).
2. Сессия в подкаталоге проекта (`…/ExpertizeMe/sub`) — значка нет, как нет и иконки проекта (тест в Task 1).
3. Правка `badges` в живом конфиге без смены окон — служба переставляет значки на следующем тике, а не через `refreshMs` (тест в Task 2).
4. Кривой регэксп (`'(['`) — тик не падает, остальные правила того же проекта работают, warn ровно один за несколько тиков (тесты в Task 1 и Task 2).
5. Смена типа проекта из пикера (`claude-project-type`) и иконки из окна настроек (`projectIcons`) на записи с `badges` — список остаётся байт в байт (тест в Task 3).

---

### Task 1: разбор `badges` и выбор значка в `iconFor`

**Files:**
- Modify: `src/claude-wt/project-helpers.js` (`normalizeProjects`, ~стр. 69–100)
- Modify: `src/claude-wt/window-icons-helpers.js` (`iconFor`, новые `badgeFor`, `badPatterns`)
- Modify: `config.example.yaml` (блок `# projects:`, после `type: work`, ~стр. 231)
- Test: `src/claude-wt/window-icons-helpers.test.js`, `src/claude-wt/windows-file-helpers.test.js`

**Interfaces:**
- Produces:
  - запись проекта после `normalizeProjects` может нести `badges: Array<{match: string, icon: string}>` — только элементы, где обе строки непустые после `trim`; пустой итог — поля нет. Валидность регэкспа здесь **не** проверяется (разбор без логгера).
  - `badgeFor(title: string, project: object|undefined): string` — `icon` первого правила, чей `new RegExp(match)` совпал с `title`; правило с кривым регэкспом пропускается; нет совпадений / нет `title` / нет проекта — `''`. Скомпилированные регэкспы — в кэше модуля `Map<string, RegExp|null>`.
  - `badPatterns(cfg): string[]` — все `match` из `cfg.projects[].badges`, на которых `new RegExp` кидает; для warn в службе.
  - `iconFor({ sessionId, cwd, title }, { heads, cfg })` — сигнатура прежняя, `title` необязателен; `overlay` у не-head = `badgeFor(title, проект по cwd)`; у head в `badge` — значок head; у head в `icon` — `badgeFor(...)`.
  - оба новых имени экспортируются из `window-icons-helpers.js`.

- [ ] **Step 1: Написать падающие тесты** в `window-icons-helpers.test.js`, отдельный `describe('значки проекта по заголовку')` со своим `cfg` через `mergeClaudeWtConfig`:

```js
const badged = mergeClaudeWtConfig({
  windowIcons: { profiles: {} },
  projects: [
    { name: 'exp', cwd: '/p/exp', icon: 'C:\\ico\\exp.ico', badges: [
      { match: '^planfix_bot-tg-', icon: 'C:\\ico\\planfix.ico' },
      { match: '-tg-', icon: 'C:\\ico\\telegram.ico' },
    ] },
    { name: 'home', cwd: '/p/home', badges: [{ match: '([', icon: 'C:\\ico\\bad.ico' }, { match: '^srb-', icon: 'C:\\ico\\serbia.ico' }] },
  ],
});
const none = new Set();
// 'первое совпавшее правило: planfix раньше tg'
expect(iconFor({ sessionId: 's', cwd: '/p/exp', title: 'planfix_bot-tg-42' }, { heads: none, cfg: badged }))
  .toEqual({ icon: 'C:\\ico\\exp.ico', overlay: 'C:\\ico\\planfix.ico' });
// 'второе правило, если первое не совпало'
expect(iconFor({ sessionId: 's', cwd: '/p/exp', title: 'foo-tg-bar' }, { heads: none, cfg: badged }).overlay).toBe('C:\\ico\\telegram.ico');
// 'не совпало ничего — без значка'
expect(iconFor({ sessionId: 's', cwd: '/p/exp', title: 'daily' }, { heads: none, cfg: badged }).overlay).toBe('');
// 'правила чужого проекта не действуют'
expect(iconFor({ sessionId: 's', cwd: '/p/home', title: 'foo-tg-bar' }, { heads: none, cfg: badged }).overlay).toBe('');
// 'подкаталог проекта — не проект, как у иконки'
expect(iconFor({ sessionId: 's', cwd: '/p/exp/sub', title: 'foo-tg-bar' }, { heads: none, cfg: badged }).overlay).toBe('');
// 'кривой регэксп пропускается, следующее правило работает'
expect(iconFor({ sessionId: 's', cwd: '/p/home', title: 'srb-visa' }, { heads: none, cfg: badged }).overlay).toBe('C:\\ico\\serbia.ico');
// 'head в режиме badge — значок head главнее правила'
expect(iconFor({ sessionId: 'h', cwd: '/p/exp', title: 'planfix_bot-tg-1' }, { heads: new Set(['h']), cfg: badged }).overlay).toBe(BUILTIN_HEAD_ICON);
// 'head в режиме icon — слот свободен, правило работает'
const badgedIcon = { ...badged, windowIcons: { ...badged.windowIcons, headMode: 'icon' } };
expect(iconFor({ sessionId: 'h', cwd: '/p/exp', title: 'planfix_bot-tg-1' }, { heads: new Set(['h']), cfg: badgedIcon }).overlay).toBe('C:\\ico\\planfix.ico');
// 'без заголовка — без значка'
expect(iconFor({ sessionId: 's', cwd: '/p/exp' }, { heads: none, cfg: badged }).overlay).toBe('');
// 'badPatterns называет кривые регэкспы'
expect(badPatterns(badged)).toEqual(['([']);
// 'мусорные элементы badges отбрасываются при разборе'
expect(mergeClaudeWtConfig({ projects: [{ name: 'x', cwd: '/x', badges: [{ match: '', icon: 'a' }, { match: 'a' }, 'str', null] }] }).projects[0]).not.toHaveProperty('badges');
```

И в `windows-file-helpers.test.js` — `badges` не уезжают в файл трекера: запись проекта с `badges` на входе `buildWindowsFile` → `expect(out.projects[0]).not.toHaveProperty('badges')`.

- [ ] **Step 2: Запустить — падают**

Run: `npx vitest run src/claude-wt/window-icons-helpers.test.js src/claude-wt/windows-file-helpers.test.js`
Expected: FAIL — `badPatterns is not a function` / `overlay` пустой; тест файла трекера проходит сразу (белый список уже есть) — это нормально, он сторож.

- [ ] **Step 3: Разбор `badges` в `normalizeProjects`** — по образцу соседнего `profiles`: массив, элементы-объекты со строковыми `match`/`icon`, непустыми после `trim`.

- [ ] **Step 4: `badgeFor`, `badPatterns`, ветка overlay в `iconFor`** в `window-icons-helpers.js`. Проект ищется так же, как в `projectIconFor` (`cfg.projects.find(p => p.cwd === cwd)`) — вынести поиск в общую `projectFor(cwd, cfg)`, чтобы два места не разошлись. Дополнить JSDoc модуля абзацем про значок проекта (решение Стаса 23.11).

- [ ] **Step 5: Образец в `config.example.yaml`** — после `type: work` в блоке `# projects:`:

```yaml
  #     # Значок на кнопке панели задач по заголовку окна (регэксп), первое
  #     # совпавшее правило. Только для сессий ровно в cwd проекта; у head
  #     # значок head главнее. Правится руками.
  #     badges:
  #       - { match: '^planfix_bot-tg-', icon: 'C:\\images\\ico\\planfix.ico' }
  #       - { match: '-tg-', icon: 'C:\\images\\ico\\telegram.ico' }
```

- [ ] **Step 6: Запустить — проходят**

Run: `npx vitest run src/claude-wt/`
Expected: PASS, остальные тесты каталога не сломаны.

- [ ] **Step 7: Коммит**

```bash
git add src/claude-wt/project-helpers.js src/claude-wt/window-icons-helpers.js src/claude-wt/window-icons-helpers.test.js src/claude-wt/windows-file-helpers.test.js config.example.yaml
git commit -m "feat(claude-wt): значок окна по заголовку из claudeWt.projects[].badges"
```

---

### Task 2: заголовок до `iconFor`, отпечаток и warn в службе иконок

**Files:**
- Modify: `src/claude-wt/view.js:103-117` (`claudeWtWindowSessions`)
- Modify: `src/mqtt/window-icons.js` (`tick`, ~стр. 174–210)
- Test: `src/mqtt/window-icons.test.js`

**Interfaces:**
- Consumes: `iconFor`, `badPatterns` из Task 1.
- Produces: элемент `claudeWtWindowSessions` — `{ id, sessionId, cwd, focusedAt, title }`, где `title` — `stripTitleDecoration(w.title)` (то же значение, по которому ищется сессия).

- [ ] **Step 1: Падающие тесты** в `window-icons.test.js` (мир фикстуры: `world.sessions[id]` уже раскладывается в результат мока `claudeWtWindowSessions` — дать сессии `title` и `cwd`, а `getClaudeWtConfig` вернуть проект с `badges`):
  - `'окно с совпавшим заголовком получает значок проекта'` — после первого тика `overlays` содержит `[<id>, 'C:\\ico\\telegram.ico', <описание>]`.
  - `'правка badges без смены окон переставляет значок на следующем тике'` — сменить `icon` правила в конфиге, `tick` (таймер фикстуры) до истечения `refreshMs` → в `overlays` новый путь.
  - `'кривой регэксп — один warn за несколько тиков, тик не падает'` — правило `'(['` в конфиге, три тика → в журнале ровно одна строка `window icons: кривой регэксп в badges: ([`, уровень `warn`; значки остальных окон ставятся.

- [ ] **Step 2: Запустить — падают**

Run: `npx vitest run src/mqtt/window-icons.test.js`
Expected: FAIL на трёх новых тестах.

- [ ] **Step 3: `title` в `claudeWtWindowSessions`** — посчитать `stripTitleDecoration(w.title)` один раз, отдать и в `resolveSession`, и в результат.

- [ ] **Step 4: Служба** — в отпечаток `print` добавить `p.badges ?? []` к каждой записи проекта; после проверки `enabled` пройти `badPatterns(cfg)` и для ещё не названных (свой `Set` в замыкании, рядом с `failed`) писать `log(\`window icons: кривой регэксп в badges: ${m}\`, 'warn')`. `iconFor(s, …)` получает `s.title` сам — сессия уже несёт поле.

- [ ] **Step 5: Запустить всё**

Run: `npm test`
Expected: PASS целиком.

- [ ] **Step 6: Коммит**

```bash
git add src/claude-wt/view.js src/mqtt/window-icons.js src/mqtt/window-icons.test.js
git commit -m "feat(window-icons): заголовок окна до iconFor, отпечаток badges, warn о кривом регэкспе"
```

---

### Task 3: правки конфига не трогают `badges`

**Files:**
- Test: `src/commands/claude-config-commands.test.js`
- Modify (только если тест упал): `src/commands/claude-config-commands.js`

**Interfaces:**
- Consumes: `setProjectType(payload, { filePath })`, `writeClaudeConfig({ projectIcons })` — как есть.

- [ ] **Step 1: Тесты-сторожа** в существующих `describe` (по образцу соседних — временный файл конфига):
  - `'тип проекта ставится, badges той же записи остаются байт в байт'` — запись с `type: work` и двумя `badges` в block-стиле; `setProjectType({ cwd, type: 'home' })` → `ok: true`, в тексте поменялась одна строка `type`, блок `badges:` совпадает со входом подстрокой.
  - `'снятие типа не уносит badges'` — `type: null` на той же записи → `badges` целы в разобранном YAML.
  - `'иконка из окна настроек не трогает badges'` — `writeClaudeConfig({ projectIcons: { [cwd]: 'C:\\x.ico' } })` → `badges` целы.

- [ ] **Step 2: Запустить**

Run: `npx vitest run src/commands/claude-config-commands.test.js`
Expected: PASS (ожидаемо — правки точечные, `patchProjectType` сверяет разобранное). Если FAIL — чинить в `claude-config-commands.js` так, чтобы правка поля не задевала соседний список, и прогнать снова.

- [ ] **Step 3: Коммит**

```bash
git add src/commands/claude-config-commands.test.js
git commit -m "test(config): правки типа и иконки проекта не трогают badges"
```

---

### Task 4: PR, ресурсы на nb, живой конфиг, выкатка

Popstas-pc и мак не трогать (см. скилл claude-wt). Всё на `nb.popstas.pro`.

- [ ] **Step 1: Пуш и PR**

```bash
git push -u origin feat/project-badges
gh pr create --title "feat(claude-wt): значки окон по заголовку внутри проекта" --body "<спека, план, что проверено>"
```

- [ ] **Step 2: Иконки на nb** — готовые файлы из скретчпада этой сессии:
  `/tmp/claude-1000/-home-popstas-projects-js-ccfzf-picker/ad5519dc-50a7-405f-b625-b33ccb919a86/scratchpad/tg/telegram.ico` и `/tmp/claude-1000/-home-popstas-projects-js-ccfzf-picker/ad5519dc-50a7-405f-b625-b33ccb919a86/scratchpad/flag/serbia.ico` (если скретчпад очищен — пересобрать: `telegram.ico` из `C:\Users\popstas\AppData\Roaming\Telegram Desktop\Telegram.exe` первой группой RT_GROUP_ICON, `serbia.ico` из Twemoji 14.0.2 `1f1f7-1f1f8.svg`, кадры 16/20/24/32/48/256).
  Сначала `ssh nb.popstas.pro "dir C:\images\ico\telegram.ico C:\images\ico\serbia.ico"` — файлов быть не должно (не перезаписывать), затем `scp` каждого в `nb.popstas.pro:C:/images/ico/` и `cmp` скачанного обратно.

- [ ] **Step 3: Выкатка кода** — `BRANCH=feat/project-badges ./data/scripts/deploy-pc.sh --no-build`. Перед этим проверить `ssh nb.popstas.pro "cd /d C:\projects\js\windows11-manager && git branch --show-current"`: если там чужая ветка под ревью — не сносить, а собрать сборную `deploy/<a>-<b>` (память «выкатка ветки снимает чужую»). Ожидается `== готово` и `tasklist` с `windows11-manager-tray.exe` в сессии `Console`.

- [ ] **Step 4: Живой конфиг** `C:\Users\popstas\AppData\Roaming\windows-mqtt\windows11-manager.config.yaml`:
  `scp` локально → копия `.bak-2026-11-23-badges` рядом на nb (`ssh … copy`) → дописать `badges` записям `expertizeme` (planfix, затем tg) и `home` (srb) ровно в форме спеки → `scp` обратно → `cmp` с локальной правкой. Правка после выкатки кода: старый код ключ проигнорирует, новый подхватит по mtime без перезапуска.

- [ ] **Step 5: Проверка, что доехало** — `ssh nb.popstas.pro "findstr /C:\"значок C:\images\ico\" C:\projects\js\windows11-manager\data\windows11-manager.log"` (или `type` хвоста): есть строки `window icons: <hwnd> значок C:\images\ico\telegram.ico` / `planfix.ico` при открытых окнах `…-tg-…` / `planfix_bot-tg-…`, и нет строки `кривой регэксп`. Если таких окон сейчас нет — сказать прямо, что значок не проверен живьём, а не выдавать отсутствие ошибок за успех.

- [ ] **Step 6: Мерж** — только по слову Стаса; после мержа переключить nb обратно на `master` (`deploy-pc.sh --no-build` с умолчанием `BRANCH`).

- [ ] **Step 7: Скилл claude-wt** — в `~/.claude/skills/claude-wt/SKILL.md` поправить имя живого конфига (`windows11-manager.config.yaml`, не `.js`) в разделе «Живой конфиг node-части…» и дописать абзац про `badges` рядом с абзацем «Иконки окон проектов лежат в `C:\images\ico`».
