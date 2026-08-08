# Picker: mark unread, session info, PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать человеку вернуть сессию в непрочитанное, посмотреть все её поля и открыть сделанный ею PR — прямо из пикера.

**Architecture:** `windows11-manager` получает экспорт `markSessionUnread(id)`, который отматывает `focusedAt` слота назад и одноразово подавляет следующий переход фокуса (иначе закрытие пикера само вернуло бы «прочитано»). Хук `wt-progress.sh` на pc-virt узнаёт ветку и ищет ссылку на PR в том же хвосте транскрипта, что читает ради сводки, кладёт пару в карту `<cwd>#<branch>` → url и отдаёт в состояние сессии готовые `branch` и `pr_url`. `windows-mqtt` рисует по этим полям метку в строке, пункты `Mark unread` / `Session info` / `Open PR #N` в Ctrl+K и оверлей со всеми полями сессии.

**Tech Stack:** windows11-manager — ESM, vitest (`npm test`). windows-mqtt — CommonJS, `node --test` (`npm test`), фронтенд пикера без сборщика (UMD-шим в `frontend-src/*.js`, копирование в `scripts/prepare-frontend.js`). Хук — bash + jq на pc-virt, с Windows виден как `V:\.claude\hooks\wt-progress.sh`.

## Global Constraints

- Спека: `docs/specs/2026-08-03-picker-unread-info-pr-design.md`.
- Имя поля — ровно `pr_url` (так записано в задаче), хотя соседние поля хука camelCase. Имя одно и то же во всей цепочке: `state.json` → `normalizeProgress()` → `buildSessionList()` → строка пикера → пункт меню.
- Метка «непрочитано» — это `focusedAt = updated - 1`, **не ноль**: ноль выкидывает слот из порядка `project-helpers.js`, по которому Ctrl+F11/F12 выбирает последнюю сессию проекта.
- TTL подавления фокуса — 15 000 мс, одноразовое: первый же пойманный фокус пометку снимает.
- Бюджет опроса демона не трогаем: ни `getWindows()`, ни чтений с `V:` в тике. `loadProgress()` вызывается только по действию человека.
- Регулярка PR одна на всех: `^https://github\.com/[^/]+/[^/]+/pull/\d+$` для проверки целой строки, `/pull/(\d+)` для номера.
- Комментарии в обоих репозиториях — по-русски, объясняют «почему», а не «что». Английские комментарии в существующих файлах не переписываем.
- Пикер после `Mark unread` не закрывается. После `Open PR` и остальных действий — закрывается, как сейчас.
- Ручной приоритет, pin и произвольные статусы сессии — вне скоупа.

---

## File Structure

**windows11-manager (ESM, vitest):**
- Modify: `src/claude-wt/daemon-helpers.js` — `sameTitleSessionIds`, `suppressFocus`, `applyFocusSuppression`, `unreadFocusedAt`, константа `FOCUS_SUPPRESS_MS`; `focusedSessionIds()` переезжает на общий помощник близнецов.
- Modify: `src/claude-wt/daemon-helpers.test.js` — тесты к ним.
- Modify: `src/claude-wt/index.js` — модульная карта подавления, её применение в тике, экспорт `markSessionUnread`.
- Modify: `src/claude-wt/progress-helpers.js` — `branch` и `pr_url` в `normalizeProgress()`.
- Modify: `src/claude-wt/progress-helpers.test.js` — тесты к ним.
- Modify: `src/claude-wt/view-helpers.js` — `branch` и `pr_url` в строке сессии.
- Modify: `src/claude-wt/view-helpers.test.js` — тест к ним.

**windows-mqtt (CommonJS, node --test):**
- Modify: `frontend-src/session-glyph.js` — `prNumber`, `prBadgeHtml`.
- Modify: `test/session-glyph.test.js`.
- Create: `frontend-src/session-info.js` — `buildSessionInfoRows`.
- Create: `test/session-info.test.js`.
- Modify: `scripts/prepare-frontend.js` — копировать новый файл.
- Modify: `src/picker/session-open-helpers.js` — пункты `unread`, `info`, `pr` в `availableActions()`.
- Modify: `test/session-open-helpers.test.js`.
- Modify: `src/modules/windows.js` — команда `windows/claude-session-unread`, ветка `pr` в `claudeSessionOpen`, `pr_url` в payload меню.
- Modify: `sessions.html` — метка PR в строке, Shift+клик, Ctrl+I, оверлей Session info, спецслучай `unread` в меню.

**pc-virt (bash, через `V:`):**
- Modify: `V:\.claude\hooks\wt-progress.sh` — `pr_from_transcript`, `git_branch`, карта `prs.json`, поля `branch` и `pr_url` в состоянии.

---

### Task 1: Чистые функции пометки и подавления фокуса

**Files:**
- Modify: `src/claude-wt/daemon-helpers.js`
- Test: `src/claude-wt/daemon-helpers.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `FOCUS_SUPPRESS_MS = 15000`
  - `sameTitleSessionIds(slots: object, sessionId: string): string[]`
  - `unreadFocusedAt(updated: number): number`
  - `suppressFocus(marks: Record<string, number>, ids: string[], nowMs: number): Record<string, number>`
  - `applyFocusSuppression({ marks, ids, nowMs }): { ids: string[], marks: Record<string, number> }`

- [ ] **Step 1: Написать падающие тесты**

Дописать в конец `src/claude-wt/daemon-helpers.test.js`:

```js
describe('sameTitleSessionIds', () => {
  const slots = {
    alpha: { titles: ['work'] },
    'alpha-old': { titles: ['work'] },
    beta: { titles: ['other'] },
    nameless: { titles: [] },
  };

  it('returns every slot sharing the first title', () => {
    expect(sameTitleSessionIds(slots, 'alpha').sort()).toEqual(['alpha', 'alpha-old']);
  });

  it('returns the session itself when it has no title', () => {
    expect(sameTitleSessionIds(slots, 'nameless')).toEqual(['nameless']);
    expect(sameTitleSessionIds(slots, 'missing')).toEqual(['missing']);
  });
});

describe('unreadFocusedAt', () => {
  it('is one second before the agent record, so the session reads as unseen', () => {
    expect(unreadFocusedAt(1000)).toBe(999);
  });

  it('is zero without an agent record', () => {
    expect(unreadFocusedAt(0)).toBe(0);
  });
});

describe('focus suppression', () => {
  it('swallows the first focus after a mark and forgets it', () => {
    const marks = suppressFocus({}, ['alpha'], 1000);
    expect(marks.alpha).toBe(1000 + FOCUS_SUPPRESS_MS);

    const first = applyFocusSuppression({ marks, ids: ['alpha'], nowMs: 2000 });
    expect(first.ids).toEqual([]);
    expect(first.marks).toEqual({});

    // Пометка одноразовая: следующий переход в окно — уже осознанный.
    const second = applyFocusSuppression({ marks: first.marks, ids: ['alpha'], nowMs: 3000 });
    expect(second.ids).toEqual(['alpha']);
  });

  it('lets through sessions that were never marked', () => {
    const marks = suppressFocus({}, ['alpha'], 1000);
    const out = applyFocusSuppression({ marks, ids: ['beta'], nowMs: 2000 });
    expect(out.ids).toEqual(['beta']);
    expect(out.marks.alpha).toBe(1000 + FOCUS_SUPPRESS_MS);
  });

  it('drops marks that outlived the TTL', () => {
    const marks = suppressFocus({}, ['alpha'], 1000);
    const out = applyFocusSuppression({
      marks, ids: ['alpha'], nowMs: 1000 + FOCUS_SUPPRESS_MS + 1,
    });
    expect(out.ids).toEqual(['alpha']);
    expect(out.marks).toEqual({});
  });

  it('survives being called with nothing at all', () => {
    expect(applyFocusSuppression({ nowMs: 5 })).toEqual({ ids: [], marks: {} });
  });
});
```

Дописать новые имена в импорт наверху файла:

```js
import {
  CLAUDE_WT_DEFAULTS,
  mergeClaudeWtConfig,
  isTerminalPath,
  desktopOnlyActions,
  layoutFingerprint,
  focusedSessionIds,
  unresolvedTitles,
  emptyTickStats,
  recordTick,
  claudeWtHealth,
  isStaleTick,
  FOCUS_SUPPRESS_MS,
  sameTitleSessionIds,
  unreadFocusedAt,
  suppressFocus,
  applyFocusSuppression,
} from './daemon-helpers.js';
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/claude-wt/daemon-helpers.test.js`
Expected: FAIL — `sameTitleSessionIds is not a function` и соседние.

- [ ] **Step 3: Реализовать помощники**

В `src/claude-wt/daemon-helpers.js` добавить перед `focusedSessionIds`:

```js
// Сколько держится пометка «следующий фокус не считать». Пикер — окно поверх, и
// на Esc фокус возвращается тому окну, из которого пришли: без этого только что
// поставленная пометка гасла бы через секунду после закрытия списка. Пятнадцать
// секунд хватает, чтобы дочитать список и закрыть его; дольше держать нельзя —
// запись переживёт настоящий, осознанный переход в окно.
const FOCUS_SUPPRESS_MS = 15000;

/**
 * Слоты, которые делят с этим первый заголовок.
 *
 * Одна и та же работа, переоткрытая заново, оставляет слот на каждый id, но
 * окно с таким названием на экране одно. Всё, что делает фокус или пометка,
 * должно относиться ко всем близнецам сразу — иначе в списке горит один, а
 * гаснет другой.
 */
function sameTitleSessionIds(slots, sessionId) {
  const title = slots?.[sessionId]?.titles?.[0];
  if (!title) return [sessionId];
  const sameTitle = Object.keys(slots).filter(id => slots[id]?.titles?.[0] === title);
  return sameTitle.includes(sessionId) ? sameTitle : [sessionId, ...sameTitle];
}

/**
 * Какую метку фокуса писать, чтобы сессия снова стала непрочитанной.
 *
 * Секунда до записи агента, а не ноль: `seenSinceUpdate()` сравнивает эти два
 * числа и вернёт `false` в обоих случаях, но ноль выкидывает слот из порядка
 * `project-helpers.js`, по которому хоткей проекта выбирает последнюю сессию.
 * Пометка непрочитанным не должна перекладывать Ctrl+F11.
 */
function unreadFocusedAt(updated) {
  return updated > 0 ? updated - 1 : 0;
}

/** Поставить пометку «пропустить следующий фокус» на каждый id. */
function suppressFocus(marks, ids, nowMs) {
  const next = { ...marks };
  for (const id of ids) next[id] = nowMs + FOCUS_SUPPRESS_MS;
  return next;
}

/**
 * Отсеять из пойманного фокуса то, что только что пометили непрочитанным.
 *
 * Пометка одноразовая и сгорает при первом же переходе: второй раз подряд в то
 * же окно человек заходит уже осознанно, и это настоящий просмотр. Просроченные
 * записи выбрасываются здесь же — отдельной чистки нет, потому что эта функция
 * вызывается каждый тик.
 */
function applyFocusSuppression({ marks = {}, ids = [], nowMs }) {
  const nextMarks = {};
  for (const [id, until] of Object.entries(marks)) {
    if (until > nowMs && !ids.includes(id)) nextMarks[id] = until;
  }
  return {
    ids: ids.filter(id => !((marks[id] ?? 0) > nowMs)),
    marks: nextMarks,
  };
}
```

Заменить хвост `focusedSessionIds` (строки с поиском близнецов) на вызов помощника:

```js
function focusedSessionIds({ activeWindowId, prevActiveWindowId, windows = [], slots = {} }) {
  if (!activeWindowId || activeWindowId === prevActiveWindowId) return [];
  const sessionId = windows.find(w => w.id === activeWindowId)?.sessionId;
  if (!sessionId) return [];
  return sameTitleSessionIds(slots, sessionId);
}
```

Комментарий про близнецов, который сейчас стоит внутри `focusedSessionIds`, переехал в `sameTitleSessionIds` — дублировать его не надо.

Добавить новые имена в `export { ... }` в конце файла.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run src/claude-wt/daemon-helpers.test.js`
Expected: PASS, включая старые тесты `focusedSessionIds` (`marks every slot that shares the focused title`).

- [ ] **Step 5: Коммит**

```bash
git add src/claude-wt/daemon-helpers.js src/claude-wt/daemon-helpers.test.js
git commit -m "feat(claude-wt): чистые функции пометки непрочитанным"
```

---

### Task 2: `markSessionUnread()` в демоне

**Files:**
- Modify: `src/claude-wt/index.js`
- Test: ручная проверка в Task 11 (функция ходит в конфиг, на диск и в сеть — юнит-тестами закрыты её чистые части из Task 1)

**Interfaces:**
- Consumes: `FOCUS_SUPPRESS_MS`, `sameTitleSessionIds`, `unreadFocusedAt`, `suppressFocus`, `applyFocusSuppression` из `daemon-helpers.js`; `activeAgent` из `view-helpers.js`; `loadBackgroundAgents` из `sessions.js`; `loadProgress` из `progress.js`.
- Produces: `markSessionUnread(id: string): { ok: boolean, reason?: string, ids?: string[] }` — экспортируется наружу автоматически через `src/lib/index.js` (`export * from '../claude-wt/index.js'`).

- [ ] **Step 1: Завести карту подавления и применить её в тике**

В `src/claude-wt/index.js` дописать импорты:

```js
import {
  // …существующие…
  sameTitleSessionIds,
  unreadFocusedAt,
  suppressFocus,
  applyFocusSuppression,
} from './daemon-helpers.js';
import { loadSessionIndex, loadBackgroundAgents } from './sessions.js';
import { loadProgress } from './progress.js';
import { activeAgent } from './view-helpers.js';
```

(`loadSessionIndex` уже импортирован — дописать рядом `loadBackgroundAgents`.)

Рядом с остальными модульными переменными:

```js
// Сессии, чей следующий переход фокуса не считается просмотром. Живёт в памяти
// демона: пометка нужна ровно на те секунды, что человек закрывает пикер, а
// переживший перезапуск демон и так начинает с чистого экрана.
let focusMarks = {};
```

В `claudeWtTick`, в блоке отметки фокуса, пропустить пойманное через подавление:

```js
  const activeWindowId = getActiveWindowId();
  const caught = focusedSessionIds({
    activeWindowId, prevActiveWindowId, windows: nextWindows, slots: nextState.slots,
  });
  const { ids: focused, marks } = applyFocusSuppression({
    marks: focusMarks, ids: caught, nowMs: Date.now(),
  });
  focusMarks = marks;
  if (focused.length) {
    const seenAt = Math.floor(Date.now() / 1000);
    for (const id of focused) {
      if (nextState.slots[id]) nextState.slots[id] = upsertSlot(nextState.slots[id], { focusedAt: seenAt });
    }
  }
  prevActiveWindowId = activeWindowId;
```

- [ ] **Step 2: Написать `markSessionUnread`**

В том же файле, рядом с `claudeWtStatus`:

```js
/**
 * Вернуть сессию в непрочитанное.
 *
 * Живёт здесь, а не во view-слое, потому что состояние демона — это `liveState`
 * в памяти этого модуля: правка файла снаружи была бы затёрта следующим тиком.
 * Файл при этом пишется сразу — пикер читает состояние с диска, а ждать
 * следующего изменения расклада значило бы ждать неизвестно сколько.
 *
 * Запись агента берётся та же, по которой пикер рисует кружок: у сессии, чью
 * работу увёл фоновый агент, это запись форка, и отматывать надо относительно
 * неё.
 */
function markSessionUnread(id) {
  const cfg = getClaudeWtConfig();
  if (!cfg.enabled) return { ok: false, reason: 'claudeWt.enabled is false in config' };
  if (!cfg.statePath) return { ok: false, reason: 'claudeWt.statePath is not set in config' };
  if (!liveState) liveState = readState(cfg.statePath);
  if (!liveState.slots[id]) return { ok: false, reason: `unknown session ${id}` };

  const agents = loadBackgroundAgents(cfg.sessionsFile, cfg.progressDir);
  const childIds = (agents[id] ?? []).map(child => child.id);
  const progress = loadProgress(cfg.progressDir, [id, ...childIds]);
  const updated = activeAgent(id, progress, agents).agent?.updated ?? 0;
  // Без записи хука сессия и так не «прочитана»: гасить нечего.
  if (!updated) return { ok: false, reason: 'no agent record yet' };

  const ids = sameTitleSessionIds(liveState.slots, id).filter(x => liveState.slots[x]);
  for (const sid of ids) {
    liveState.slots[sid] = upsertSlot(liveState.slots[sid], { focusedAt: unreadFocusedAt(updated) });
  }
  focusMarks = suppressFocus(focusMarks, ids, Date.now());
  writeState(cfg.statePath, liveState);
  lastWritten = layoutFingerprint(liveState);
  return { ok: true, ids };
}
```

Дописать `markSessionUnread` в `export { ... }` в конце файла.

- [ ] **Step 3: Прогнать весь набор тестов библиотеки**

Run: `npm test`
Expected: PASS. Тик изменился, поэтому смотрим не только `daemon-helpers`.

- [ ] **Step 4: Проверить, что функция видна снаружи**

Run:

```bash
node --input-type=module -e "import * as m from './src/lib/index.js'; console.log(typeof m.markSessionUnread)"
```

Expected: `function`

- [ ] **Step 5: Коммит**

```bash
git add src/claude-wt/index.js
git commit -m "feat(claude-wt): markSessionUnread и подавление возвратного фокуса"
```

---

### Task 3: Команда и пункт меню «Mark unread» в windows-mqtt

Работа в `D:/projects/js/windows-mqtt`.

**Files:**
- Modify: `src/picker/session-open-helpers.js`
- Modify: `src/modules/windows.js`
- Test: `test/session-open-helpers.test.js`

**Interfaces:**
- Consumes: `markSessionUnread(id)` из `windows11-manager` (Task 2).
- Produces:
  - `availableActions({ cwd, cursorRunning, canMarkUnread }, opts): Array<{id, label}>` — прежние три пункта плюс `{ id: 'unread', label: 'Mark unread' }`.
  - IPC-действие `windows/claude-session-unread` с payload `{ id }`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `test/session-open-helpers.test.js`:

```js
test('availableActions offers mark-unread when the session has an agent record', () => {
  const actions = availableActions({
    cwd: '/home/popstas/projects/x', cursorRunning: false, canMarkUnread: true,
  });
  assert.deepStrictEqual(
    actions.map(a => a.id),
    ['explorer', 'terminal', 'unread'],
  );
  assert.strictEqual(actions.find(a => a.id === 'unread').label, 'Mark unread');
});

test('availableActions omits mark-unread without an agent record', () => {
  const actions = availableActions({
    cwd: '/home/popstas/projects/x', cursorRunning: false, canMarkUnread: false,
  });
  assert.deepStrictEqual(actions.map(a => a.id), ['explorer', 'terminal']);
});

test('availableActions still offers mark-unread when cwd cannot be mapped to Windows', () => {
  // Пометка не открывает папку: путь ей не нужен, и сессия вне V: не должна
  // оставаться без единственного действия, которое ей доступно.
  const actions = availableActions({ cwd: '/opt/elsewhere', canMarkUnread: true });
  assert.deepStrictEqual(actions.map(a => a.id), ['unread']);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — сейчас `availableActions` возвращает `[]` для непереводимого пути и не знает про `unread`.

- [ ] **Step 3: Переписать `availableActions`**

В `src/picker/session-open-helpers.js` заменить `ACTION_DEFS` и `availableActions`:

```js
// Пункты, которым нужен путь на диске Windows. Всё остальное меню от него не
// зависит и живёт по своим условиям.
const PATH_ACTION_DEFS = [
  { id: 'explorer', label: 'Open in Explorer' },
  { id: 'cursor', label: 'Open in Cursor' },
  { id: 'terminal', label: 'Open in Terminal' },
];

/**
 * Действия, которые пикер может предложить для сессии.
 *
 * Cursor — только когда он запущен: пункт, открывающий несуществующее
 * приложение, хуже отсутствующего. Путь нужен лишь первым трём, поэтому сессия
 * вне V: остаётся с пометкой непрочитанным, а не с пустым меню.
 */
function availableActions({ cwd, cursorRunning, canMarkUnread = false }, opts = {}) {
  const actions = toWindowsPath(cwd, opts) === null
    ? []
    : PATH_ACTION_DEFS.filter(a => a.id !== 'cursor' || cursorRunning);
  if (canMarkUnread) actions.push({ id: 'unread', label: 'Mark unread' });
  return actions;
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, включая прежние тесты `availableActions`.

- [ ] **Step 5: Прокинуть признак и команду в `src/modules/windows.js`**

В `claudeSessionActions` передать признак (сессия с записью хука — та, у которой `agentState` не пуст либо есть `lastActivity` из хука; надёжный признак один — `session.agentState !== null`):

```js
    const actions = availableActions(
      {
        cwd: session.cwd,
        cursorRunning: !!cursorExe,
        canMarkUnread: !!session.agentState,
      },
      opts,
    );
```

Рядом с `claudeSessionOpen` добавить обработчик:

```js
  // Вернуть сессию в непрочитанное. Пикер при этом остаётся открытым: список
  // перерисовывается раз в секунду, и кружок перекрашивается на глазах.
  async function claudeSessionUnread(payload) {
    const id = payload?.id;
    if (!id) return;
    let res;
    try {
      res = winMan.markSessionUnread(id);
    } catch (e) {
      log(`claude-wt mark unread failed: ${e.message}`, 'error');
      notifyPicker(`claude-wt: ${e.message}`);
      return;
    }
    if (!res.ok) {
      log(`claude-wt mark unread: ${res.reason}`, 'warn');
      notifyPicker(`claude-wt: ${res.reason}`);
      return;
    }
    log(`claude-wt marked unread: ${res.ids.join(', ')}`);
    scheduleHaRefresh();
  }
```

Зарегистрировать в карте действий рядом с `windows/claude-session-open`:

```js
    'windows/claude-session-unread': (payload) => claudeSessionUnread(payload),
```

- [ ] **Step 6: Прогнать тесты**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add src/picker/session-open-helpers.js test/session-open-helpers.test.js src/modules/windows.js
git commit -m "feat(picker): пункт и команда mark unread"
```

---

### Task 4: Mark unread в интерфейсе пикера

Работа в `D:/projects/js/windows-mqtt`.

**Files:**
- Modify: `sessions.html`
- Test: `test/picker-action-consistency.test.js` (уже существует и покроет новое действие сам)

**Interfaces:**
- Consumes: действие `windows/claude-session-unread` (Task 3).
- Produces: Shift+клик по строке и пункт `unread` в меню, оба не закрывают пикер.

- [ ] **Step 1: Научить меню не закрывать пикер на `unread`**

В `sessions.html` заменить `runMenuAction`:

```js
  async function runMenuAction() {
    const action = menuActions[menuActive];
    if (!action || !menuSessionId) return;
    const id = menuSessionId;
    const actionId = action.id;
    closeMenu();
    // Пометка непрочитанным — единственное действие, после которого смотреть
    // надо на этот же список: кружок перекрашивается в ближайшую секунду, и
    // сессий за раз помечают несколько.
    if (actionId === 'unread') {
      await invoke('picker_send', {
        action: 'windows/claude-session-unread',
        payload: { id },
      });
      return;
    }
    await invoke('hide_picker');
    await invoke('picker_send', {
      action: 'windows/claude-session-open',
      payload: { id, action: actionId },
    });
  }
```

- [ ] **Step 2: Добавить Shift+клик по строке**

Заменить обработчик кликов по списку:

```js
  list.addEventListener('click', (e) => {
    if (menuOpen) return;
    const row = e.target.closest('.row');
    if (!row) return;
    active = Number(row.dataset.index);
    // Shift+клик помечает непрочитанным вместо открытия. Промах по Shift не
    // должен превращаться в открытие сессии, поэтому строка без записи агента
    // (снимки, сессия без хука) просто ничего не делает.
    if (e.shiftKey) {
      if (window.PickerSnapshots.isSnapshotsCommand(search.value)) return;
      const session = rows[active];
      if (!session || !session.agentState) return;
      invoke('picker_send', {
        action: 'windows/claude-session-unread',
        payload: { id: session.id },
      });
      return;
    }
    choose();
  });
```

- [ ] **Step 3: Прогнать тесты**

Run: `npm test`
Expected: PASS — `picker-action-consistency` найдёт `windows/claude-session-unread` в обоих файлах.

- [ ] **Step 4: Коммит**

```bash
git add sessions.html
git commit -m "feat(picker): shift+клик и пункт меню помечают сессию непрочитанной"
```

---

### Task 5: `buildSessionInfoRows` — таблица полей сессии

Работа в `D:/projects/js/windows-mqtt`.

**Files:**
- Create: `frontend-src/session-info.js`
- Create: `test/session-info.test.js`
- Modify: `scripts/prepare-frontend.js`

**Interfaces:**
- Consumes: ничего (чистый модуль).
- Produces: `buildSessionInfoRows(session: object, nowSec: number): Array<{ label: string, value: string }>` — глобал `window.SessionInfo` в браузере, `module.exports` в тестах.

- [ ] **Step 1: Написать падающие тесты**

Создать `test/session-info.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildSessionInfoRows } = require('../frontend-src/session-info');

const session = {
  id: 'abc-123',
  label: 'ccfzf',
  cwd: '/home/popstas/projects/shell/ccfzf',
  open: true,
  windowId: 42,
  desktop: 2,
  monitor: 1,
  bounds: { x: 0, y: 0, width: 1600, height: 900 },
  agentState: 'review',
  agentEvent: 'stop',
  agentMessage: '',
  agentPrompt: 'почини сборку',
  agentDescription: 'Готово — сборка зелёная',
  agentCostUsd: 3,
  agentContextPct: 41,
  agentStarted: 1000,
  agentBackground: false,
  agentSessionId: 'abc-123',
  lastActivity: 3400,
  focusedAt: 3000,
  agentSeen: false,
  branch: 'feat/x',
  pr_url: 'https://github.com/popstas/ccfzf/pull/3',
};

function valueOf(rows, label) {
  return rows.find(r => r.label === label)?.value;
}

test('buildSessionInfoRows shows the fields a row cannot fit', () => {
  const rows = buildSessionInfoRows(session, 3460);
  assert.strictEqual(valueOf(rows, 'id'), 'abc-123');
  assert.strictEqual(valueOf(rows, 'desktop'), '2');
  assert.strictEqual(valueOf(rows, 'monitor'), '1');
  assert.strictEqual(valueOf(rows, 'bounds'), '1600×900 @ 0,0');
  assert.strictEqual(valueOf(rows, 'event'), 'stop');
  assert.strictEqual(valueOf(rows, 'branch'), 'feat/x');
  assert.strictEqual(valueOf(rows, 'pr_url'), 'https://github.com/popstas/ccfzf/pull/3');
});

test('buildSessionInfoRows prints timestamps as clock plus age', () => {
  const rows = buildSessionInfoRows(session, 3460);
  // 3400 — минута назад относительно 3460.
  assert.match(valueOf(rows, 'last activity'), /^\d{2}:\d{2} · 1m$/);
});

test('buildSessionInfoRows skips fields the session does not have', () => {
  const rows = buildSessionInfoRows(
    { id: 'x', label: 'x', cwd: '', open: false },
    100,
  );
  const labels = rows.map(r => r.label);
  assert.ok(!labels.includes('pr_url'));
  assert.ok(!labels.includes('branch'));
  assert.ok(!labels.includes('bounds'));
  assert.ok(labels.includes('id'));
});

test('buildSessionInfoRows names the background agent that answers for the session', () => {
  const rows = buildSessionInfoRows(
    { ...session, agentBackground: true, agentSessionId: 'fork-9' },
    3460,
  );
  assert.strictEqual(valueOf(rows, 'agent'), 'background · fork-9');
});

test('buildSessionInfoRows reports whether the state was seen', () => {
  assert.strictEqual(valueOf(buildSessionInfoRows(session, 3460), 'seen'), 'no');
  assert.strictEqual(
    valueOf(buildSessionInfoRows({ ...session, agentSeen: true }, 3460), 'seen'),
    'yes',
  );
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `Cannot find module '../frontend-src/session-info'`.

- [ ] **Step 3: Написать модуль**

Создать `frontend-src/session-info.js`:

```js
// Loaded twice: as a <script> in sessions.html and as a module in the tests.
// The project has no bundler, and duplicating this logic to make it testable
// would be worse than this shim.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SessionInfo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /** Возраст в том же виде, что в правой колонке списка: 45s, 12m, 3h, 2d. */
  function age(sec) {
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
    return `${Math.floor(sec / 86400)}d`;
  }

  /**
   * Отметка времени — часы плюс возраст: «14:32 · 5m».
   *
   * Одних часов мало (вчерашние 14:32 выглядят как сегодняшние), одного
   * возраста тоже (по нему не сопоставить с историей терминала).
   */
  function stamp(epochSec, nowSec) {
    if (!epochSec) return '';
    const d = new Date(epochSec * 1000);
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())} · ${age(Math.max(0, nowSec - epochSec))}`;
  }

  /**
   * Все поля сессии, которые есть в строке списка, — таблицей.
   *
   * Пустые пропускаются: пустая строка в таблице выглядит как поломка, а не как
   * «данных нет». Порядок — от опознания сессии к подробностям агента.
   */
  function buildSessionInfoRows(session, nowSec) {
    const s = session ?? {};
    const b = s.bounds;
    const rows = [
      ['id', s.id ?? ''],
      ['name', s.label ?? ''],
      ['cwd', s.cwd ?? ''],
      ['window', s.open ? `open · hwnd ${s.windowId ?? '—'}` : 'closed'],
      ['desktop', Number.isFinite(s.desktop) ? String(s.desktop) : ''],
      ['monitor', Number.isFinite(s.monitor) ? String(s.monitor) : ''],
      ['bounds', b ? `${b.width}×${b.height} @ ${b.x},${b.y}` : ''],
      ['state', s.agentState ?? ''],
      ['event', s.agentEvent ?? ''],
      ['message', s.agentMessage ?? ''],
      ['seen', s.agentState ? (s.agentSeen ? 'yes' : 'no') : ''],
      ['prompt', s.agentPrompt ?? ''],
      ['summary', s.agentDescription ?? ''],
      ['cost', s.agentCostUsd ? `$${s.agentCostUsd}` : ''],
      ['context', s.agentContextPct ? `${s.agentContextPct}%` : ''],
      ['branch', s.branch ?? ''],
      ['pr_url', s.pr_url ?? ''],
      ['agent', s.agentBackground ? `background · ${s.agentSessionId ?? ''}` : ''],
      ['started', stamp(s.agentStarted ?? 0, nowSec)],
      ['last activity', stamp(s.lastActivity ?? 0, nowSec)],
      ['focused', stamp(s.focusedAt ?? 0, nowSec)],
    ];
    return rows
      .filter(([, value]) => value !== '' && value !== null && value !== undefined)
      .map(([label, value]) => ({ label, value: String(value) }));
  }

  return { buildSessionInfoRows };
});
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Копировать файл во фронтенд**

В `scripts/prepare-frontend.js` дописать строку:

```js
fs.copyFileSync('frontend-src/session-info.js', 'frontend/session-info.js');
```

- [ ] **Step 6: Коммит**

```bash
git add frontend-src/session-info.js test/session-info.test.js scripts/prepare-frontend.js
git commit -m "feat(picker): таблица полей сессии для Session info"
```

---

### Task 6: Оверлей Session info

Работа в `D:/projects/js/windows-mqtt`.

**Files:**
- Modify: `sessions.html`
- Modify: `src/picker/session-open-helpers.js`
- Modify: `src/modules/windows.js`
- Test: `test/session-open-helpers.test.js`

**Interfaces:**
- Consumes: `buildSessionInfoRows` (Task 5), `availableActions` (Task 3).
- Produces: пункт `{ id: 'info', label: 'Session info' }` в меню; оверлей `#info-backdrop`; клавиша Ctrl+I.

- [ ] **Step 1: Поправить тесты, которые сверяют меню целиком**

Пункт `info` появляется у каждой сессии, поэтому четыре существующих теста с
`deepStrictEqual` по всему списку перестают быть верными. Их ожидания —
не случайность, а описание меню, и обновляются вместе с ним.

В `test/session-open-helpers.test.js` заменить:

```js
test('availableActions always includes explorer and terminal when cwd maps', () => {
  const actions = availableActions({ cwd: '/home/popstas/p', cursorRunning: false });
  assert.deepStrictEqual(actions.map(a => a.id), ['explorer', 'terminal', 'info']);
});

test('availableActions puts explorer first, then cursor when Cursor is running', () => {
  const actions = availableActions({ cwd: '/home/popstas/p', cursorRunning: true });
  assert.deepStrictEqual(actions.map(a => a.id), ['explorer', 'cursor', 'terminal', 'info']);
  assert.strictEqual(actions[0].label, 'Open in Explorer');
  assert.strictEqual(actions[1].label, 'Open in Cursor');
  assert.strictEqual(actions[2].label, 'Open in Terminal');
});

test('availableActions offers only session info when cwd cannot be mapped', () => {
  // Информация о сессии не открывает ничего на диске: путь ей не нужен, и
  // пустое меню у такой сессии было бы просто тупиком.
  assert.deepStrictEqual(
    availableActions({ cwd: '/opt/x', cursorRunning: true }).map(a => a.id),
    ['info'],
  );
  assert.deepStrictEqual(
    availableActions({ cwd: '', cursorRunning: true }).map(a => a.id),
    ['info'],
  );
});
```

И два теста из Task 3 — списки в них дописываются тем же пунктом:

```js
test('availableActions offers mark-unread when the session has an agent record', () => {
  const actions = availableActions({
    cwd: '/home/popstas/projects/x', cursorRunning: false, canMarkUnread: true,
  });
  assert.deepStrictEqual(
    actions.map(a => a.id),
    ['explorer', 'terminal', 'unread', 'info'],
  );
  assert.strictEqual(actions.find(a => a.id === 'unread').label, 'Mark unread');
});

test('availableActions omits mark-unread without an agent record', () => {
  const actions = availableActions({
    cwd: '/home/popstas/projects/x', cursorRunning: false, canMarkUnread: false,
  });
  assert.deepStrictEqual(actions.map(a => a.id), ['explorer', 'terminal', 'info']);
});

test('availableActions still offers mark-unread when cwd cannot be mapped', () => {
  const actions = availableActions({ cwd: '/opt/elsewhere', canMarkUnread: true });
  assert.deepStrictEqual(actions.map(a => a.id), ['unread', 'info']);
});
```

Дописать новый тест на подпись:

```js
test('availableActions labels the session info entry', () => {
  assert.strictEqual(
    availableActions({ cwd: '/home/popstas/x' }).find(a => a.id === 'info').label,
    'Session info',
  );
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — пункта `info` нет ни в одном списке.

- [ ] **Step 3: Добавить пункт**

В `availableActions` перед `return actions`:

```js
  // Информация о сессии есть всегда: она рисуется из той же строки списка и
  // ничего не запрашивает.
  actions.push({ id: 'info', label: 'Session info' });
```

Run: `npm test` → PASS.

- [ ] **Step 4: Нарисовать оверлей**

В `sessions.html`, в `<style>` рядом с правилами `#actions-*`:

```css
        /* Session info — тот же модал, что и меню действий: разные только
           содержимое и ширина. */
        #info-backdrop {
            display: none; position: absolute; inset: 0; z-index: 10;
            background: rgba(0, 0, 0, .45);
            align-items: center; justify-content: center; padding: 24px;
        }
        #info-backdrop.open { display: flex; }
        #info-card {
            width: min(560px, 100%); max-height: 100%; overflow-y: auto;
            background: #25262a; border: 1px solid #3a3d42; border-radius: 10px;
            box-shadow: 0 12px 40px rgba(0, 0, 0, .45);
        }
        #info-title {
            padding: 12px 16px 8px; font-size: 11px; color: #7d838c;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            border-bottom: 1px solid #3a3d42;
        }
        #info-rows { padding: 8px 0; }
        .info-row { display: flex; gap: 12px; padding: 3px 16px; font-size: 12px; }
        .info-row .k { flex: 0 0 96px; color: #7d838c; }
        .info-row .v { min-width: 0; word-break: break-word; }
```

В разметку после `#actions-backdrop`:

```html
<div id="info-backdrop" aria-hidden="true">
  <div id="info-card" role="dialog">
    <div id="info-title"></div>
    <div id="info-rows"></div>
  </div>
</div>
```

К списку скриптов:

```html
<script src="session-info.js"></script>
```

- [ ] **Step 5: Подключить оверлей в скрипте**

Рядом с остальными переменными состояния:

```js
  let infoOpen = false;
```

Рядом с прочими `document.getElementById`:

```js
  const infoBackdrop = document.getElementById('info-backdrop');
  const infoTitle = document.getElementById('info-title');
  const infoRows = document.getElementById('info-rows');
```

Функции рядом с `closeMenu`:

```js
  function closeInfo() {
    infoOpen = false;
    infoBackdrop.classList.remove('open');
    infoBackdrop.setAttribute('aria-hidden', 'true');
    search.focus();
  }

  function openInfo(session) {
    if (!session) return;
    const nowSec = Math.floor(Date.now() / 1000);
    infoTitle.textContent = `${session.label || session.id} — ${shortPath(session.cwd || '')}`;
    infoRows.innerHTML = window.SessionInfo.buildSessionInfoRows(session, nowSec)
      .map(row => `<div class="info-row"><span class="k">${escapeHtml(row.label)}</span>`
        + `<span class="v">${escapeHtml(row.value)}</span></div>`)
      .join('');
    infoOpen = true;
    infoBackdrop.classList.add('open');
    infoBackdrop.setAttribute('aria-hidden', 'false');
    search.blur();
  }
```

В `runMenuAction`, рядом со спецслучаем `unread`:

```js
    if (actionId === 'info') {
      openInfo(rows[active]);
      return;
    }
```

В обработчик клавиш, первым блоком — чтобы Esc закрывал именно оверлей:

```js
    if (infoOpen) {
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); closeInfo(); }
      else if (!(e.ctrlKey || e.metaKey || e.altKey)) { e.preventDefault(); }
      return;
    }
```

И рядом с обработчиком Ctrl+K:

```js
    if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      if (window.PickerSnapshots.isSnapshotsCommand(search.value)) return;
      openInfo(rows[active]);
      return;
    }
```

Закрытие кликом по фону:

```js
  infoBackdrop.addEventListener('click', (e) => {
    if (e.target === infoBackdrop) closeInfo();
  });
```

В `beginShow`, рядом с `closeMenu()`:

```js
    closeInfo();
```

И в слушателе `picker-hidden` — тоже `closeInfo();` рядом с `closeMenu();`.

- [ ] **Step 6: Прогнать тесты**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add sessions.html src/picker/session-open-helpers.js test/session-open-helpers.test.js
git commit -m "feat(picker): оверлей Session info по Ctrl+I и из меню"
```

---

### Task 7: Хук на pc-virt запоминает PR по ветке

Работа на сетевом диске: файл `V:\.claude\hooks\wt-progress.sh` (тот же файл на pc-virt — `~/.claude/hooks/wt-progress.sh`). Репозитория у него нет, коммита в этой задаче нет.

**Files:**
- Modify: `V:\.claude\hooks\wt-progress.sh`

**Interfaces:**
- Consumes: ничего.
- Produces: поля `branch` и `pr_url` в `<id>.state.json`; файл-карта `$state_dir/prs.json` вида `{"<cwd>#<branch>": {"url": "https://…/pull/3", "updated": 1754251200}}`.

- [ ] **Step 1: Добавить функции поиска PR и ветки**

Вставить после `prompt_from_transcript`:

```bash
# Ссылка на PR из хвоста транскрипта. Ищется тем же чтением, что и сводка, и
# только там же: PR агент называет в ответе, а ответы — в хвосте. Берётся
# последняя, потому что сессия за день может открыть второй PR.
pr_from_transcript() {
  local file="$1" size
  [ -n "$file" ] && [ -f "$file" ] || return 0
  size="$(stat -c %s "$file" 2>/dev/null || echo 0)"
  if [ "$size" -gt 262144 ]; then
    tail -c 262144 "$file" 2>/dev/null
  else
    cat "$file" 2>/dev/null
  fi | grep -oE 'https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/pull/[0-9]+' \
     | tail -n 1
  return 0
}

# Текущая ветка проекта. PR принадлежит ветке, а не сессии: сессия
# перезапускается под новым id, ветка остаётся, и вторая сессия на той же ветке
# должна видеть тот же PR.
git_branch() {
  local dir="$1"
  [ -n "$dir" ] && [ -d "$dir" ] || return 0
  git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || true
}

# Карта «<cwd>#<branch> → PR». Общий файл на все сессии, запись атомарная, как у
# состояний. Потеря карты не страшна: следующий ответ с ссылкой её восстановит.
pr_map_get() {
  local key="$1" map="$state_dir/prs.json"
  [ -n "$key" ] && [ -f "$map" ] || return 0
  jq -r --arg k "$key" '.[$k].url // empty' "$map" 2>/dev/null || true
}

pr_map_put() {
  local key="$1" url="$2" now="$3" map="$state_dir/prs.json" tmp
  [ -n "$key" ] && [ -n "$url" ] || return 0
  tmp="$map.$$"
  if [ -f "$map" ]; then
    jq -c --arg k "$key" --arg u "$url" --argjson t "$now" \
      '.[$k] = {url: $u, updated: $t}' "$map" >"$tmp" 2>/dev/null || { rm -f "$tmp"; return 0; }
  else
    jq -nc --arg k "$key" --arg u "$url" --argjson t "$now" \
      '{($k): {url: $u, updated: $t}}' >"$tmp" 2>/dev/null || { rm -f "$tmp"; return 0; }
  fi
  mv -f "$tmp" "$map" 2>/dev/null || rm -f "$tmp" 2>/dev/null || true
  return 0
}
```

- [ ] **Step 2: Считать PR там же, где считается сводка**

В `save_state` завести флаг рядом с объявлением `local summary=""…`:

```bash
  local summary="" last_summary="" prompt="" summary_at=0 prev_at=0 rescan=0
```

В ветке `stop|fail|attention` дописать `rescan=1` после `prompt=…`; в ветке `tool-start | tool-done` — внутри `if [ "$((now - prev_at))" -ge "$SUMMARY_TTL" ]`, рядом с `summary_at="$now"`, тоже `rescan=1`.

После блока переноса прошлой сводки (`if [ -n "$summary" ]; then … fi`) вставить:

```bash
  # Ветка и PR стоят столько же, сколько чтение хвоста, поэтому считаются ровно
  # там, где хвост уже прочитан. В остальное время переносятся из прошлой
  # записи — как сводка.
  local branch="" pr_url="" found_pr=""
  if [ "$rescan" = "1" ]; then
    branch="$(git_branch "$cwd")"
    found_pr="$(pr_from_transcript "$transcript")"
    if [ -n "$found_pr" ] && [ -n "$branch" ]; then
      pr_map_put "$cwd#$branch" "$found_pr" "$now"
    fi
    pr_url="$found_pr"
    [ -n "$pr_url" ] || pr_url="$(pr_map_get "$cwd#$branch")"
  elif [ -f "$target" ]; then
    branch="$(jq -r '.branch // empty' "$target" 2>/dev/null || true)"
    pr_url="$(jq -r '.pr_url // empty' "$target" 2>/dev/null || true)"
  fi
```

- [ ] **Step 3: Положить поля в состояние**

В вызов `jq -nc` дописать два аргумента и два ключа:

```bash
      --arg branch "$branch" \
      --arg pr_url "$pr_url" \
```

```bash
        prompt: $prompt, branch: $branch, pr_url: $pr_url,
```

- [ ] **Step 4: Проверить на живой сессии**

Run (из Git Bash на Windows):

```bash
bash -n /v/.claude/hooks/wt-progress.sh
```

Expected: тишина (синтаксис цел).

Затем в любой сессии Claude на pc-virt дождаться следующего `stop` и посмотреть:

```bash
jq '{branch, pr_url, summary}' /v/.claude/claude-wt/*.state.json | head -40
```

Expected: у сессий в git-репозиториях появилось непустое `branch`; у той, где агент называл PR, — `pr_url`.

- [ ] **Step 5: Проверить карту**

Run:

```bash
jq . /v/.claude/claude-wt/prs.json
```

Expected: объект с ключом вида `/home/popstas/projects/js/windows11-manager#feat/…` и полем `url`.

---

### Task 8: `branch` и `pr_url` в библиотеке

Работа в `D:/projects/js/windows11-manager`.

**Files:**
- Modify: `src/claude-wt/progress-helpers.js`
- Modify: `src/claude-wt/view-helpers.js`
- Test: `src/claude-wt/progress-helpers.test.js`, `src/claude-wt/view-helpers.test.js`

**Interfaces:**
- Consumes: поля `branch` / `pr_url` из `<id>.state.json` (Task 7).
- Produces: те же два поля в объекте сессии из `buildSessionList()`; невалидный URL превращается в пустую строку ещё в `normalizeProgress()`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `src/claude-wt/progress-helpers.test.js`:

```js
describe('normalizeProgress with a PR', () => {
  it('keeps a github pull request url and the branch', () => {
    const out = normalizeProgress({
      state: 'idle', updated: 5,
      branch: 'feat/x', pr_url: 'https://github.com/popstas/ccfzf/pull/3',
    });
    expect(out.branch).toBe('feat/x');
    expect(out.pr_url).toBe('https://github.com/popstas/ccfzf/pull/3');
  });

  it('drops anything that is not a github pull request url', () => {
    // Строку пишет чужой процесс на другой машине, а уходит она в аргумент
    // `start`. Ворота одни — здесь.
    for (const bad of [
      'http://github.com/a/b/pull/1',
      'https://github.com.evil.tld/a/b/pull/1',
      'https://github.com/a/b/issues/1',
      'https://github.com/a/b/pull/1 && calc.exe',
      42,
    ]) {
      expect(normalizeProgress({ state: 'idle', updated: 5, pr_url: bad }).pr_url).toBe('');
    }
  });

  it('defaults both fields to empty strings', () => {
    const out = normalizeProgress({ state: 'idle', updated: 5 });
    expect(out.branch).toBe('');
    expect(out.pr_url).toBe('');
  });
});
```

Дописать в `src/claude-wt/view-helpers.test.js`:

```js
describe('buildSessionList with a PR', () => {
  it('passes the branch and the pull request url through to the row', () => {
    const [row] = buildSessionList({
      slots: { a: { titles: ['x'], bounds: { x: 0, y: 0, width: 10, height: 10 } } },
      openMap: new Map(),
      mons: [],
      progress: {
        a: {
          state: 'idle', updated: 5,
          branch: 'feat/x', pr_url: 'https://github.com/popstas/ccfzf/pull/3',
        },
      },
    });
    expect(row.branch).toBe('feat/x');
    expect(row.pr_url).toBe('https://github.com/popstas/ccfzf/pull/3');
  });

  it('gives empty strings when the hook knows no branch', () => {
    const [row] = buildSessionList({
      slots: { a: { titles: ['x'], bounds: { x: 0, y: 0, width: 10, height: 10 } } },
      openMap: new Map(),
      mons: [],
      progress: { a: { state: 'idle', updated: 5 } },
    });
    expect(row.branch).toBe('');
    expect(row.pr_url).toBe('');
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/claude-wt/progress-helpers.test.js src/claude-wt/view-helpers.test.js`
Expected: FAIL — `undefined` вместо строк.

- [ ] **Step 3: Пропустить поля через `normalizeProgress`**

В `src/claude-wt/progress-helpers.js` перед `normalizeProgress` добавить:

```js
// Единственная форма ссылки, которую мы согласны показать и тем более отдать в
// аргумент `start`: строку пишет хук на другой машине из текста, который
// сочинил агент. Проверка целой строки, а не поиск подстроки — «…/pull/1 &&
// calc.exe» тоже содержит валидный префикс.
const PR_URL_RE = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;
```

В возвращаемый объект `normalizeProgress`, после `contextPct`:

```js
    // Ветка проекта и PR, который сессия сделала. Считает хук: ветку он берёт
    // у git, ссылку — из хвоста транскрипта, и держит карту «ветка → PR», так
    // что поле переживает и рестарт сессии под новым id.
    branch: typeof raw.branch === 'string' ? raw.branch : '',
    pr_url: typeof raw.pr_url === 'string' && PR_URL_RE.test(raw.pr_url) ? raw.pr_url : '',
```

- [ ] **Step 4: Пропустить поля в строку сессии**

В `src/claude-wt/view-helpers.js`, в объект `buildSessionList` после `agentContextPct`:

```js
      // Ветка и PR. Имя `pr_url` держится одинаковым во всей цепочке — от
      // файла хука до пункта меню, — чтобы поле искалось по одному слову.
      branch: agent?.branch ?? '',
      pr_url: agent?.pr_url ?? '',
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add src/claude-wt/progress-helpers.js src/claude-wt/progress-helpers.test.js src/claude-wt/view-helpers.js src/claude-wt/view-helpers.test.js
git commit -m "feat(claude-wt): ветка и pr_url в строке сессии"
```

---

### Task 9: Метка PR в строке списка

Работа в `D:/projects/js/windows-mqtt`.

**Files:**
- Modify: `frontend-src/session-glyph.js`
- Modify: `sessions.html`
- Test: `test/session-glyph.test.js`

**Interfaces:**
- Consumes: поле `pr_url` строки сессии (Task 8).
- Produces:
  - `prNumber(url: string): string` — `'3'` или `''`.
  - `prBadgeHtml(session: object): string` — `<span class="pr">↗ #3</span>` или `''`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `test/session-glyph.test.js` (и добавить `prNumber, prBadgeHtml` в список импортируемых имён наверху файла):

```js
test('prNumber takes the number from the tail of a pull request url', () => {
  assert.strictEqual(prNumber('https://github.com/popstas/ccfzf/pull/3'), '3');
  assert.strictEqual(prNumber('https://github.com/popstas/ccfzf/pull/128'), '128');
});

test('prNumber returns an empty string for anything else', () => {
  assert.strictEqual(prNumber('https://github.com/popstas/ccfzf/issues/3'), '');
  assert.strictEqual(prNumber(''), '');
  assert.strictEqual(prNumber(undefined), '');
});

test('prBadgeHtml renders the badge only for sessions with a pull request', () => {
  assert.strictEqual(
    prBadgeHtml({ pr_url: 'https://github.com/popstas/ccfzf/pull/3' }),
    '<span class="pr">↗ #3</span>',
  );
  assert.strictEqual(prBadgeHtml({ pr_url: '' }), '');
  assert.strictEqual(prBadgeHtml({}), '');
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `prNumber is not a function`.

- [ ] **Step 3: Написать помощники**

В `frontend-src/session-glyph.js`, внутри фабрики:

```js
  // Номер PR берётся из хвоста ссылки, отдельного поля для него нет: ссылка и
  // так проверена на форму в windows11-manager, и второе поле означало бы два
  // источника правды об одном и том же.
  function prNumber(url) {
    const m = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)$/.exec(url ?? '');
    return m ? m[1] : '';
  }

  /**
   * Метка PR в строке: «↗ #3».
   *
   * Текстом, а не картинкой: ассетов у пикера нет вовсе, а стрелка есть в Segoe
   * UI, которым он и набран.
   */
  function prBadgeHtml(session) {
    const num = prNumber(session?.pr_url);
    return num ? `<span class="pr">↗ #${num}</span>` : '';
  }
```

Добавить оба имени в возвращаемый объект модуля.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Показать метку в строке**

В `sessions.html`, в `<style>` рядом с `.name .hotkey`:

```css
        /* Метка PR — той же тусклостью, что и подпись хоткея: опознают строку
           по имени и пути, это подсказка рядом. */
        .name .pr { margin-left: 6px; font-size: 11px; color: #7d838c; font-weight: normal; }
```

В деструктуризацию `window.SessionGlyph` дописать `prBadgeHtml`.

В `render()`, в сборке строки, сразу после блока с `hotkey`:

```js
          `${prBadgeHtml(session)}` +
```

- [ ] **Step 6: Прогнать тесты**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add frontend-src/session-glyph.js test/session-glyph.test.js sessions.html
git commit -m "feat(picker): метка PR в строке сессии"
```

---

### Task 10: `Open PR #N` в Ctrl+K

Работа в `D:/projects/js/windows-mqtt`.

**Files:**
- Modify: `src/picker/session-open-helpers.js`
- Modify: `src/modules/windows.js`
- Test: `test/session-open-helpers.test.js`

**Interfaces:**
- Consumes: `prNumber` из `frontend-src/session-glyph.js`; поле `pr_url` сессии (Task 8).
- Produces: пункт `{ id: 'pr', label: 'Open PR #3' }`; ветка `pr` в `claudeSessionOpen`, открывающая ссылку через `cmd /c start "" <url>`; `buildOpenCommands({ action: 'pr', prUrl })`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `test/session-open-helpers.test.js`:

```js
test('availableActions offers Open PR with the number in the label', () => {
  const actions = availableActions({
    cwd: '/home/popstas/projects/x',
    prUrl: 'https://github.com/popstas/ccfzf/pull/3',
  });
  assert.strictEqual(actions.find(a => a.id === 'pr').label, 'Open PR #3');
});

test('availableActions omits Open PR without a pull request url', () => {
  const actions = availableActions({ cwd: '/home/popstas/projects/x' });
  assert.ok(!actions.some(a => a.id === 'pr'));
});

test('buildOpenCommands opens a pull request url through cmd start', () => {
  assert.deepStrictEqual(
    buildOpenCommands({ action: 'pr', prUrl: 'https://github.com/popstas/ccfzf/pull/3' }),
    { kind: 'spawn', file: 'cmd.exe', args: ['/c', 'start', '', 'https://github.com/popstas/ccfzf/pull/3'] },
  );
});

test('buildOpenCommands refuses a pull request url of the wrong shape', () => {
  // Строка пришла из транскрипта агента и уходит в аргумент `start`: вторые
  // ворота после normalizeProgress, потому что вызвать эту функцию может кто
  // угодно.
  for (const bad of ['', undefined, 'https://evil.tld/a/b/pull/1', 'https://github.com/a/b/pull/1 && calc']) {
    assert.strictEqual(buildOpenCommands({ action: 'pr', prUrl: bad }), null);
  }
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Реализовать пункт и команду**

В `src/picker/session-open-helpers.js` наверху:

```js
// Номер PR считает тот же модуль, что рисует метку в строке: правило одно, и
// разъехаться ему негде. Файл фронтенда грузится и как <script>, и как модуль —
// require здесь пользуется вторым.
const { prNumber } = require('../../frontend-src/session-glyph');
```

В `availableActions`, перед пунктом `info`:

```js
  const prNum = prNumber(prUrl);
  if (prNum) actions.push({ id: 'pr', label: `Open PR #${prNum}` });
```

и добавить `prUrl` в разбор аргумента:

```js
function availableActions({ cwd, cursorRunning, canMarkUnread = false, prUrl = '' }, opts = {}) {
```

В `buildOpenCommands` — до проверки `if (!winPath) return null;`, потому что PR путь на диске не нужен:

```js
  if (action === 'pr') {
    // Проверка формы здесь вторая: первая стоит в normalizeProgress. Эта
    // функция чистая и вызывается кем угодно, а результат уходит в аргумент
    // командной строки.
    if (!prNumber(prUrl)) return null;
    return { kind: 'spawn', file: 'cmd.exe', args: ['/c', 'start', '', prUrl] };
  }
```

Дописать `prUrl` в JSDoc-параметры и в деструктуризацию аргумента `buildOpenCommands`.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Прокинуть в `src/modules/windows.js`**

В `claudeSessionActions` дописать поле:

```js
    const actions = availableActions(
      {
        cwd: session.cwd,
        cursorRunning: !!cursorExe,
        canMarkUnread: !!session.agentState,
        prUrl: session.pr_url,
      },
      opts,
    );
```

В `claudeSessionOpen`, сразу после ветки `terminal` (до того, как понадобится `winPath`):

```js
    if (action === 'pr') {
      const cmd = buildOpenCommands({action, prUrl: session.pr_url});
      if (!cmd) {
        notifyPicker('claude-wt: no pull request for this session');
        return;
      }
      try {
        await runOpenCommand(cmd, {});
        log(`claude-wt open pr: ${session.pr_url}`);
      } catch (e) {
        log(`claude-wt open pr failed: ${e.message}`, 'error');
        notifyPicker(`claude-wt: open PR failed — ${e.message}`);
      }
      return;
    }
```

- [ ] **Step 6: Прогнать тесты**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add src/picker/session-open-helpers.js test/session-open-helpers.test.js src/modules/windows.js
git commit -m "feat(picker): Open PR в меню действий"
```

---

### Task 11: Деплой и проверка руками

**Files:** ничего не меняется, если проверка прошла.

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: работающая связка на живой машине.

- [ ] **Step 1: Прогнать оба набора тестов**

Run в `D:/projects/js/windows11-manager`: `npm test`
Run в `D:/projects/js/windows-mqtt`: `npm test`
Expected: PASS в обоих.

- [ ] **Step 2: Собрать и поставить приложение**

Правки затронули `sessions.html` и `frontend-src/`, поэтому быстрый путь не годится — `deploy-fast` откажется сам.

Run в `D:/projects/js/windows-mqtt`: `npm run deploy-local`
Expected: сборка и установка проходят. Команда висит долго; ждать до семи минут.

- [ ] **Step 3: Проверить mark unread из окна самой сессии**

Открыть терминал сессии, дождаться серого кружка (значит, просмотрено), нажать Ctrl+Space (пикер), Ctrl+K, `Mark unread`, затем Esc.
Expected: кружок стал оранжевым и **остался** оранжевым после закрытия пикера, когда фокус вернулся в то же окно. Это и есть проверка подавления из Task 2 — без него он потемнеет в ближайшую секунду.

- [ ] **Step 4: Проверить Shift+клик**

В пикере Shift+кликнуть по другой просмотренной сессии.
Expected: кружок перекрасился, пикер остался открытым.

- [ ] **Step 5: Проверить Session info**

Стрелками встать на строку, нажать Ctrl+I.
Expected: оверлей со всеми полями; у сессии в git-репозитории видна `branch`; Esc закрывает оверлей и возвращает фокус в поиск.

- [ ] **Step 6: Проверить PR**

Найти сессию, которая называла PR в ответе (или сказать какой-нибудь сессии открыть PR и дождаться `stop`).
Expected: в строке видна метка `↗ #N`; в Ctrl+K есть пункт `Open PR #N`; он открывает страницу PR в браузере.

- [ ] **Step 7: Проверить, что хоткеи проектов не переложило**

Нажать Ctrl+F11 и Ctrl+F12.
Expected: открываются те же сессии, что и раньше, — в том числе после того, как одна из них была помечена непрочитанной (проверка `unreadFocusedAt`, который поэтому и не ноль).

---

## Self-Review

**Покрытие спеки:**

| Требование спеки | Задача |
|---|---|
| `markSessionUnread()` в `index.js`, правка `liveState` + запись файла | 2 |
| `focusedAt = updated - 1`, не ноль | 1 (чистая функция), 2 (применение), 11 шаг 7 (проверка) |
| Подавление возвратного фокуса, TTL 15 с, одноразовое | 1, 2, 11 шаг 3 |
| Пометка распространяется на близнецов по заголовку | 1 (`sameTitleSessionIds`), 2 |
| Сессия без записи хука не помечается | 2 (`no agent record yet`), 3 (пункт не показывается), 4 (Shift+клик молчит) |
| Пункт `Mark unread` в Ctrl+K и Shift+клик, пикер не закрывается | 3, 4 |
| Оверлей Session info, Ctrl+I, данные без новых запросов | 5, 6 |
| Приоритета в полях нет | 5 (список полей) |
| Хук: ветка, поиск PR, карта `prs.json`, поля в состоянии | 7 |
| `branch` / `pr_url` через `normalizeProgress` и `buildSessionList` | 8 |
| Метка `↗ #N` в строке | 9 |
| `Open PR #N` в Ctrl+K, `cmd /c start`, проверка формы URL | 10 |
| Проверка тестами и руками, деплой | 11 |

**Тесты, которые меняются дважды:** три существующих теста `availableActions` и два новых из Task 3 сверяют меню целиком, а Task 6 добавляет пункт `info` в каждое меню. Их обновление — первый шаг Task 6, с готовым текстом. Больше ни один тест плана не переписывается позже.

**Согласованность имён:** `pr_url` — везде (хук, `normalizeProgress`, строка сессии, `session.pr_url` в windows-mqtt); аргумент помощников — `prUrl` (camelCase внутри JS-функций, как и `canMarkUnread`). `prNumber` объявлен один раз в `frontend-src/session-glyph.js` (Task 9) и оттуда же импортируется сервером (Task 10) — поэтому Task 9 идёт раньше Task 10.
