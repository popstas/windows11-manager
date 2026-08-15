# Переезд управления окнами и claude-wt из windows-mqtt — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `windows11-manager` забирает себе весь MQTT — подписку и публикацию — вместе с оконными командами, командами claude-wt и экспортом сессий в Home Assistant; `windows-mqtt` остаётся без окон и без зависимости от менеджера.

**Architecture:** В `windows11-manager` появляется одна карта `команда → обработчик` (`src/commands/router.js`), поверх которой работают два транспорта — MQTT (новый node-клиент) и HTTP (существующий сервер). Мост `MQTT → Rust → WS → Node` удаляется целиком: раз Node всё равно заводит клиент ради публикации в Home Assistant, он же и слушает. `windows-mqtt` гасит свой модуль `windows` флагом и теряет `file:../windows11-manager`. `ccfzf-picker` получает ветку открытия сессии через менеджер.

**Tech Stack:** Node 22+ ESM, `commander`, npm-пакет `mqtt` ^5, vitest (`src/**/*.test.js`); Rust/Tauri 2 (только удаление кода); в `windows-mqtt` — CommonJS и `node --test`; в `ccfzf-picker` — ванильный JS-фронтенд и Rust/Tauri 2.

Спека: `docs/specs/2026-08-08-mqtt-ownership-design.md`.

## Global Constraints

- **Префикс топиков не меняется.** База — `home/room/pc/windows`, из настроек. Отправителей (плата openHASP, Node-RED, `ccfzf-picker`) править нельзя.
- **`windows11-manager` — ESM** (`"type": "module"`). Всё переносимое из `windows-mqtt` конвертируется из CommonJS: `require(x)` → `import … from 'x'` (с расширением `.js` в относительных путях), `module.exports = {a, b}` → `export { a, b }`.
- **Тесты `windows11-manager` — vitest, файлы рядом с кодом**, маска `src/**/*.test.js` (`vitest.config.js`). Переносимые тесты конвертируются из `node --test`: `import test from 'node:test'` + `assert` → `import { describe, it, expect } from 'vitest'`, `assert.deepEqual(a, b)` → `expect(a).toEqual(b)`, `assert.equal(a, b)` → `expect(a).toBe(b)`, `assert.ok(x)` → `expect(x).toBeTruthy()`.
- **Пароль брокера не передаётся аргументами.** Только переменные окружения — `argv` виден в списке процессов.
- **Бюджет опроса.** Ни `getWindows()`, ни чтения номера рабочего стола в цикле; `loadProgress()` зовётся только из view-слоя. Правила из `.claude/skills/claude-wt/SKILL.md` действуют и после переезда.
- **HTTP-сервер и MQTT-клиент живут отдельными процессами от демона.** Поднятый внутри процесса демона http-сервер вешал событийный цикл через две-три минуты (`src/lib/index.js:15-18`). MQTT-процесс запускается так же — своей командой.
- **Каталоги.** `windows11-manager` — `/home/popstas/projects/js/windows11-manager`; `windows-mqtt` — `/home/popstas/projects/js/windows-mqtt`; `ccfzf-picker` — `/home/popstas/projects/js/ccfzf-picker`. Каждая задача явно называет свой репозиторий.
- **Проверка на Windows.** Ни один тест здесь не поднимает окна и не ходит в брокер. Всё, что связано с реальными окнами и платой, проверяется вручную по чеклисту в конце.

---

## Фаза 1 — windows11-manager: роутер, MQTT, Home Assistant

### Task 1: Карта команд (роутер)

**Репозиторий:** `windows11-manager`

**Files:**
- Create: `src/commands/router.js`
- Test: `src/commands/router.test.js`

**Interfaces:**
- Produces: `createRouter(handlers) → { dispatch(command, payload), has(command), commands() }`. `handlers` — объект `{ [command: string]: (payload: any) => any | Promise<any> }`. `dispatch` возвращает `Promise<{ok: true, result}>` либо `Promise<{ok: false, error: string}>` и **никогда не бросает**: транспорт не должен падать от кривой полезной нагрузки.

- [ ] **Step 1: Написать падающий тест**

Создать `src/commands/router.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { createRouter } from './router.js';

describe('createRouter', () => {
  it('разрешает известную команду в её обработчик', async () => {
    const store = vi.fn().mockResolvedValue('stored');
    const router = createRouter({ store });
    expect(await router.dispatch('store', { a: 1 })).toEqual({ ok: true, result: 'stored' });
    expect(store).toHaveBeenCalledWith({ a: 1 });
  });

  it('на неизвестной команде возвращает ошибку, а не бросает', async () => {
    const router = createRouter({ store: () => {} });
    expect(await router.dispatch('nope')).toEqual({ ok: false, error: 'unknown command: nope' });
  });

  it('ловит исключение обработчика', async () => {
    const router = createRouter({ boom: () => { throw new Error('нет окна'); } });
    expect(await router.dispatch('boom')).toEqual({ ok: false, error: 'нет окна' });
  });

  it('ловит отказ промиса обработчика', async () => {
    const router = createRouter({ boom: () => Promise.reject(new Error('таймаут')) });
    expect(await router.dispatch('boom')).toEqual({ ok: false, error: 'таймаут' });
  });

  it('has и commands рассказывают о карте', () => {
    const router = createRouter({ store: () => {}, restore: () => {} });
    expect(router.has('store')).toBe(true);
    expect(router.has('nope')).toBe(false);
    expect(router.commands().sort()).toEqual(['restore', 'store']);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/commands/router.test.js
```

Ожидается: FAIL — `Failed to resolve import "./router.js"`.

- [ ] **Step 3: Написать роутер**

Создать `src/commands/router.js`:

```js
/**
 * Единственный список команд в проекте.
 *
 * До него `switch` по командам был продублирован в http-server.js и
 * ws-client.js; при пяти командах списки уже разъезжались, а после переезда из
 * windows-mqtt их стало двадцать. MQTT и HTTP — транспорты поверх этой карты,
 * своих списков они не держат.
 *
 * dispatch не бросает никогда: полезная нагрузка приходит снаружи (брокер,
 * панель, чужой пикер), и упавший обработчик не должен ронять транспорт вместе
 * с подпиской на все остальные топики.
 */
function createRouter(handlers = {}) {
  const map = new Map(Object.entries(handlers));

  async function dispatch(command, payload) {
    const handler = map.get(command);
    if (!handler) return { ok: false, error: `unknown command: ${command}` };
    try {
      return { ok: true, result: await handler(payload) };
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  return {
    dispatch,
    has: (command) => map.has(command),
    commands: () => [...map.keys()],
  };
}

export { createRouter };
```

- [ ] **Step 4: Убедиться, что тест проходит**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/commands/router.test.js
```

Ожидается: PASS, 5 тестов.

- [ ] **Step 5: Коммит**

```bash
cd /home/popstas/projects/js/windows11-manager
git add src/commands/router.js src/commands/router.test.js
git commit -m "feat(commands): карта команд с единым разбором ошибок"
```

---

### Task 2: Оконные команды в карте

**Репозиторий:** `windows11-manager`

Переезжают обработчики MQTT-подписок `windows-mqtt/src/modules/windows.js`: `autoplace` (стр. 166), `place` (882), `store` (893), `restore` (898), `clear` (903), `open` (908), `focus` (914).

**Files:**
- Create: `src/commands/window-commands.js`
- Test: `src/commands/window-commands.test.js`

**Interfaces:**
- Consumes: `createRouter` из Task 1 (в этой задаче не используется, карта собирается в Task 5).
- Produces: `windowCommands(deps) → { autoplace, place, placeAll, store, restore, clear, open, focus, desktop, reload }` — объект обработчиков для `createRouter`. `deps` — `{ winMan, config, log }`, где `winMan` — пространство имён `src/lib/index.js`, `config` — результат `getConfig()`, `log(message, level)`.

Внедрение через `deps` нужно ради тестов: настоящий `winMan` тянет `node-window-manager`, нативный модуль, которого на Linux нет.

- [ ] **Step 1: Написать падающий тест**

Создать `src/commands/window-commands.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { windowCommands } from './window-commands.js';

function deps(overrides = {}) {
  return {
    winMan: {
      placeWindows: vi.fn().mockResolvedValue([]),
      placeWindowByConfig: vi.fn().mockResolvedValue(undefined),
      storeWindows: vi.fn(),
      restoreWindows: vi.fn().mockResolvedValue(undefined),
      clearWindows: vi.fn(),
      openStore: vi.fn(),
      focusWindow: vi.fn().mockResolvedValue(true),
      reloadConfigs: vi.fn().mockResolvedValue(undefined),
      virtualDesktop: { GoToDesktopNumber: vi.fn() },
      ...overrides.winMan,
    },
    config: overrides.config ?? { store: { custom: { windows: [] } } },
    log: overrides.log ?? vi.fn(),
  };
}

describe('windowCommands', () => {
  it('place принимает объект правила', async () => {
    const d = deps();
    await windowCommands(d).place({ window: 'current' });
    expect(d.winMan.placeWindowByConfig).toHaveBeenCalledWith({ window: 'current' });
  });

  it('place принимает то же правило строкой JSON', async () => {
    const d = deps();
    await windowCommands(d).place('{"window":"current"}');
    expect(d.winMan.placeWindowByConfig).toHaveBeenCalledWith({ window: 'current' });
  });

  it('restore после восстановления открывает сохранённые приложения', async () => {
    const d = deps({ config: { store: { custom: { apps: ['C:/a.exe'] } } } });
    await windowCommands(d).restore();
    expect(d.winMan.restoreWindows).toHaveBeenCalled();
    expect(d.winMan.openStore).toHaveBeenCalledWith(
      expect.objectContaining({ windows: [{ path: 'C:/a.exe' }] }),
    );
  });

  it('restore без store.custom не падает', async () => {
    const d = deps({ config: {} });
    await expect(windowCommands(d).restore()).resolves.not.toThrow();
    expect(d.winMan.restoreWindows).toHaveBeenCalled();
    expect(d.winMan.openStore).not.toHaveBeenCalled();
  });

  it('focus пишет в журнал, когда ни одно окно не подошло', async () => {
    const d = deps({ winMan: { focusWindow: vi.fn().mockResolvedValue(false) } });
    await windowCommands(d).focus({ title: '^OBS' });
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('no window matched'), 'warn');
  });

  it('desktop переводит номер в индекс с нуля', async () => {
    const d = deps();
    await windowCommands(d).desktop({ number: 3 });
    expect(d.winMan.virtualDesktop.GoToDesktopNumber).toHaveBeenCalledWith(2);
  });

  it('autoplace отдаёт число расставленных окон', async () => {
    const placed = [{ w: { path: 'C:\\x\\code.exe' } }];
    const d = deps({ winMan: { placeWindows: vi.fn().mockResolvedValue(placed) } });
    expect(await windowCommands(d).autoplace()).toEqual({ placed: 1 });
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/commands/window-commands.test.js
```

Ожидается: FAIL — `Failed to resolve import "./window-commands.js"`.

- [ ] **Step 3: Написать обработчики**

Создать `src/commands/window-commands.js`:

```js
/**
 * Оконные команды. Переехали из windows-mqtt/src/modules/windows.js — там они
 * были обработчиками MQTT-подписок и жили в одном файле с claude-wt и
 * экспортом в Home Assistant.
 *
 * Зависимости приходят аргументом, а не импортом: winMan тянет
 * node-window-manager, нативный модуль, которого нет на машине разработчика.
 */

/** Тело команды приходит и объектом, и строкой JSON: брокер несёт байты. */
function asObject(payload) {
  if (payload && typeof payload === 'object') return payload;
  const raw = String(payload ?? '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** store.custom / store.default пишут список либо в windows, либо в apps. */
function storeEntry(entry) {
  if (!entry) return null;
  if (entry.apps) return { ...entry, windows: entry.apps.map((path) => ({ path })) };
  return entry;
}

function windowCommands({ winMan, config, log }) {
  async function restore() {
    await winMan.restoreWindows();
    const stored = storeEntry(config?.store?.custom);
    if (stored) await winMan.openStore(stored);
  }

  return {
    async autoplace() {
      const placed = await winMan.placeWindows();
      log(`Placed windows: ${placed.length}`);
      return { placed: placed.length };
    },

    async place(payload) {
      await winMan.placeWindowByConfig(asObject(payload));
    },

    async placeAll() {
      const placed = await winMan.placeWindows();
      return { placed: placed.length };
    },

    store() {
      winMan.storeWindows();
    },

    restore,

    clear() {
      winMan.clearWindows();
    },

    open(payload) {
      winMan.openStore(asObject(payload));
    },

    async focus(payload) {
      const rule = asObject(payload);
      const focused = await winMan.focusWindow(rule);
      if (!focused) log(`focus: no window matched ${JSON.stringify(rule)}`, 'warn');
    },

    async desktop(payload) {
      const { number } = asObject(payload);
      await winMan.virtualDesktop.GoToDesktopNumber(Number(number) - 1);
    },

    async reload() {
      await winMan.reloadConfigs();
    },
  };
}

export { windowCommands, asObject, storeEntry };
```

- [ ] **Step 4: Убедиться, что тест проходит**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/commands/window-commands.test.js
```

Ожидается: PASS, 7 тестов.

- [ ] **Step 5: Коммит**

```bash
cd /home/popstas/projects/js/windows11-manager
git add src/commands/window-commands.js src/commands/window-commands.test.js
git commit -m "feat(commands): оконные команды переехали из windows-mqtt"
```

---

### Task 3: Чистые хелперы claude-wt переезжают

**Репозиторий:** `windows11-manager`

Пять файлов без I/O, за которыми потянутся команды claude-wt и экспорт в Home Assistant.

**Files:**
- Create: `src/claude-wt/ha/format-age.js`, `src/claude-wt/ha/session-groups.js`, `src/claude-wt/ha/session-slots.js`, `src/commands/restore-payload.js`, `src/commands/press-throttle.js`, `src/commands/delayed-slot-off.js`
- Test: `src/claude-wt/ha/session-slots.test.js`, `src/claude-wt/ha/session-groups.test.js`, `src/commands/restore-payload.test.js`, `src/commands/press-throttle.test.js`, `src/commands/delayed-slot-off.test.js`

**Interfaces:**
- Produces:
  - `formatAge(timestamp, nowSec) → string`
  - `buildSlots(sessions, count, sort) → Array<{slot, id, title, state, …}>`, `sessionIdForSlot(slots, slot) → string | null`, `DEFAULT_SLOTS`, `orderSessions`, `slotStatus`
  - `labelSessions(sessions) → sessions[]`, `chooseAction(session, isAlive) → 'focus' | 'restore'`, `resolveDesktopSwitch(liveDesktop) → number | null`, `compareSessions`, `normalizeSort`, `DEFAULT_SORT`
  - `parseRestorePayload(message) → { id: string, sessionIds: string[] }`
  - `throttlePress(handler, opts) → handler`, `DEFAULT_INTERVAL_MS`
  - `createDelayedSlotOff({delayMs, publish, setTimeoutFn, clearTimeoutFn}) → scheduleSlotOff(slot)`

- [ ] **Step 1: Скопировать файлы и тесты**

```bash
cd /home/popstas/projects/js/windows11-manager
mkdir -p src/claude-wt/ha
W=/home/popstas/projects/js/windows-mqtt
cp $W/src/picker/format-age.js      src/claude-wt/ha/format-age.js
cp $W/src/picker/session-groups.js  src/claude-wt/ha/session-groups.js
cp $W/src/picker/session-slots.js   src/claude-wt/ha/session-slots.js
cp $W/src/picker/restore-payload.js src/commands/restore-payload.js
cp $W/src/modules/press-throttle.js src/commands/press-throttle.js
cp $W/src/modules/delayed-slot-off.js src/commands/delayed-slot-off.js
cp $W/test/session-slots.test.js         src/claude-wt/ha/session-slots.test.js
cp $W/test/picker-session-groups.test.js src/claude-wt/ha/session-groups.test.js
cp $W/test/restore-payload.test.js       src/commands/restore-payload.test.js
cp $W/test/press-throttle.test.js        src/commands/press-throttle.test.js
cp $W/test/delayed-slot-off.test.js      src/commands/delayed-slot-off.test.js
```

- [ ] **Step 2: Убедиться, что тесты падают**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/claude-wt/ha src/commands/restore-payload.test.js src/commands/press-throttle.test.js src/commands/delayed-slot-off.test.js
```

Ожидается: FAIL — `require is not defined` либо `Cannot find module 'node:test'`: файлы ещё в CommonJS и на `node --test`.

- [ ] **Step 3: Перевести в ESM и на vitest**

В каждом из шести исходников: убрать `module.exports = {…}` в конце и поставить `export { … }` с тем же списком имён; `const {x} = require('./y')` заменить на `import { x } from './y.js'`. Относительные пути внутри `src/claude-wt/ha/` остаются относительными (`session-slots.js` импортирует `./session-groups.js`).

В каждом из пяти тестов: заменить шапку

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSlots } = require('../src/picker/session-slots');
```

на

```js
import { describe, it, expect } from 'vitest';
import { buildSlots } from './session-slots.js';
```

и тела проверок: `assert.deepEqual(a, b)` → `expect(a).toEqual(b)`, `assert.equal(a, b)` → `expect(a).toBe(b)`, `assert.ok(x)` → `expect(x).toBeTruthy()`, `test('имя', () => {…})` → `it('имя', () => {…})`, обёртка `describe(…)` добавляется, если её не было.

`press-throttle.test.js` и `delayed-slot-off.test.js` подменяют время своими `now` / `setTimeoutFn` — эти параметры уже есть в сигнатурах, `vi.useFakeTimers()` не нужен.

- [ ] **Step 4: Убедиться, что тесты проходят**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/claude-wt/ha src/commands/restore-payload.test.js src/commands/press-throttle.test.js src/commands/delayed-slot-off.test.js
```

Ожидается: PASS. Число тестов должно совпасть с тем, что даёт исходник:

```bash
cd /home/popstas/projects/js/windows-mqtt && node --test test/session-slots.test.js test/picker-session-groups.test.js test/restore-payload.test.js test/press-throttle.test.js test/delayed-slot-off.test.js 2>&1 | tail -5
```

- [ ] **Step 5: Коммит**

```bash
cd /home/popstas/projects/js/windows11-manager
git add src/claude-wt/ha src/commands/restore-payload.js src/commands/restore-payload.test.js src/commands/press-throttle.js src/commands/press-throttle.test.js src/commands/delayed-slot-off.js src/commands/delayed-slot-off.test.js
git commit -m "refactor(claude-wt): чистые хелперы слотов и нажатий переехали из windows-mqtt"
```

---

### Task 4: Команды claude-wt

**Репозиторий:** `windows11-manager`

Переезжают `claudeFocus` (`windows.js:238`), `focusOrRestoreClaudeSession` (198), `claudeFocusSlot` (671), `claudeSnapshotRestore` (658), `claudeSessionUnread` (463), `claudeSessionOpen` (400). Последние две — с новыми MQTT-топиками: подписки у них не было (см. спеку).

**Files:**
- Create: `src/commands/claude-commands.js`
- Test: `src/commands/claude-commands.test.js`

**Interfaces:**
- Consumes: `chooseAction`, `resolveDesktopSwitch` из `src/claude-wt/ha/session-groups.js`; `sessionIdForSlot` из `src/claude-wt/ha/session-slots.js`; `parseRestorePayload` из `src/commands/restore-payload.js` (Task 3).
- Produces: `claudeCommands(deps) → { 'claude-focus', 'claude-focus-slot', 'claude-session-unread', 'claude-snapshot-restore', 'claude-session-open' }`. `deps` — `{ winMan, log, notify, slots }`, где `notify(message)` шлёт человеку строку, а `slots() → Array` отдаёт последнюю разложенную по слотам картину (её ведёт экспорт из Task 6).

- [ ] **Step 1: Написать падающий тест**

Создать `src/commands/claude-commands.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { claudeCommands } from './claude-commands.js';

const SESSION = { id: 'abc', windowId: 42, open: true, agentState: 'review' };

function deps(overrides = {}) {
  return {
    winMan: {
      claudeWtSessions: vi.fn().mockReturnValue({ ok: true, sessions: [SESSION] }),
      getWindowById: vi.fn().mockReturnValue({ id: 42 }),
      focusWindowById: vi.fn().mockReturnValue(true),
      markSessionUnread: vi.fn().mockReturnValue({ ok: true, ids: ['abc'] }),
      restoreSnapshot: vi.fn().mockResolvedValue({ restored: ['abc'], skipped: [] }),
      restoreClaudeSessions: vi.fn().mockResolvedValue({ restored: ['abc'], skipped: [] }),
      openClaudeProject: vi.fn().mockResolvedValue({ ok: true, action: 'focus' }),
      virtualDesktop: {
        GetWindowDesktopNumber: vi.fn().mockResolvedValue(1),
        GoToDesktopNumber: vi.fn().mockResolvedValue(undefined),
      },
      ...overrides.winMan,
    },
    log: overrides.log ?? vi.fn(),
    notify: overrides.notify ?? vi.fn(),
    slots: overrides.slots ?? (() => [{ slot: 1, id: 'abc' }]),
  };
}

describe('claude-focus', () => {
  it('поднимает окно живой сессии', async () => {
    const d = deps();
    await claudeCommands(d)['claude-focus']({ id: 'abc' });
    expect(d.winMan.focusWindowById).toHaveBeenCalledWith(42);
    expect(d.winMan.restoreClaudeSessions).not.toHaveBeenCalled();
  });

  it('принимает голый id строкой', async () => {
    const d = deps();
    await claudeCommands(d)['claude-focus']('abc');
    expect(d.winMan.focusWindowById).toHaveBeenCalledWith(42);
  });

  it('восстанавливает сессию, у которой окна больше нет', async () => {
    const d = deps({ winMan: { getWindowById: vi.fn().mockReturnValue(null) } });
    await claudeCommands(d)['claude-focus']({ id: 'abc' });
    expect(d.winMan.restoreClaudeSessions).toHaveBeenCalledWith({ sessionIds: ['abc'] });
  });

  it('сообщает человеку о неизвестной сессии', async () => {
    const d = deps();
    await claudeCommands(d)['claude-focus']({ id: 'zzz' });
    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('zzz'));
    expect(d.winMan.focusWindowById).not.toHaveBeenCalled();
  });
});

describe('claude-focus-slot', () => {
  it('переводит номер строки в id по последней раскладке', async () => {
    const d = deps();
    await claudeCommands(d)['claude-focus-slot']('1');
    expect(d.winMan.focusWindowById).toHaveBeenCalledWith(42);
  });

  it('принимает {slot: N}', async () => {
    const d = deps();
    await claudeCommands(d)['claude-focus-slot']({ slot: 1 });
    expect(d.winMan.focusWindowById).toHaveBeenCalledWith(42);
  });

  it('молчит на пустой строке', async () => {
    const d = deps({ slots: () => [{ slot: 1, id: null }] });
    await claudeCommands(d)['claude-focus-slot']('1');
    expect(d.winMan.focusWindowById).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('slot 1 is empty'), 'warn');
  });
});

describe('claude-session-unread', () => {
  it('возвращает сессию в непросмотренное', async () => {
    const d = deps();
    await claudeCommands(d)['claude-session-unread']({ id: 'abc' });
    expect(d.winMan.markSessionUnread).toHaveBeenCalledWith('abc');
  });

  it('сообщает человеку об отказе', async () => {
    const d = deps({ winMan: { markSessionUnread: vi.fn().mockReturnValue({ ok: false, reason: 'нет состояния' }) } });
    await claudeCommands(d)['claude-session-unread']({ id: 'abc' });
    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('нет состояния'));
  });
});

describe('claude-snapshot-restore', () => {
  it('по умолчанию берёт последний снимок', async () => {
    const d = deps();
    await claudeCommands(d)['claude-snapshot-restore']('');
    expect(d.winMan.restoreSnapshot).toHaveBeenCalledWith({ id: 'last', sessionIds: [] });
  });

  it('сообщает, когда восстанавливать нечего', async () => {
    const d = deps({ winMan: { restoreSnapshot: vi.fn().mockResolvedValue({ restored: [], skipped: [] }) } });
    await claudeCommands(d)['claude-snapshot-restore']('last');
    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('нечего восстанавливать'));
  });
});

describe('claude-session-open', () => {
  it('действие terminal поднимает окно, а не открывает второе', async () => {
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ id: 'abc', action: 'terminal' });
    expect(d.winMan.focusWindowById).toHaveBeenCalledWith(42);
  });

  it('без action ничего не делает', async () => {
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ id: 'abc' });
    expect(d.winMan.focusWindowById).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/commands/claude-commands.test.js
```

Ожидается: FAIL — `Failed to resolve import "./claude-commands.js"`.

- [ ] **Step 3: Написать обработчики**

Создать `src/commands/claude-commands.js`:

```js
/**
 * Команды claude-wt. Переехали из windows-mqtt/src/modules/windows.js.
 *
 * `claude-session-unread` и `claude-session-open` заводятся здесь заново: в
 * windows-mqtt у них были только stdinActions старого webview-пикера, а
 * MQTT-подписки не было ни у кого. Из-за этого отметка «непросмотрено» из
 * ccfzf-picker пропадала молча — тот же случай, что уже описан в комментарии
 * windows.js:1088-1093 про claude-focus.
 */
import { chooseAction, resolveDesktopSwitch } from '../claude-wt/ha/session-groups.js';
import { sessionIdForSlot } from '../claude-wt/ha/session-slots.js';
import { parseRestorePayload } from './restore-payload.js';

/** Тело просьбы: `{"id": …}` либо голый id строкой — ради вызова руками. */
function parseIdPayload(payload) {
  if (payload && typeof payload === 'object') return payload;
  const raw = String(payload ?? '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* не JSON — значит сам id */ }
  return { id: raw };
}

function claudeCommands({ winMan, log, notify, slots }) {
  function findSession(id) {
    let res;
    try {
      res = winMan.claudeWtSessions();
    } catch (e) {
      return { error: e.message };
    }
    if (!res.ok) return { error: res.reason };
    const session = res.sessions.find((s) => s.id === id);
    return session ? { session } : { error: `unknown session ${id}` };
  }

  async function restoreOne(id) {
    try {
      const { restored } = await winMan.restoreClaudeSessions({ sessionIds: [id] });
      if (!restored.length) notify(`claude-wt: не удалось поднять сессию ${id}`);
    } catch (e) {
      log(`claude-wt restore failed: ${e.message}`, 'error');
      notify(`claude-wt: ошибка восстановления — ${e.message}`);
    }
  }

  /**
   * Живое окно поднимаем, мёртвую сессию восстанавливаем.
   *
   * Переход на её рабочий стол идёт первым: фокус на окне с чужого стола
   * Windows отдаёт молча и без результата.
   */
  async function focusOrRestore(id, session) {
    if (chooseAction(session, (windowId) => !!winMan.getWindowById(windowId)) === 'restore') {
      await restoreOne(id);
      return;
    }
    const current = await winMan.virtualDesktop.GetWindowDesktopNumber(session.windowId);
    const target = resolveDesktopSwitch(current);
    if (target !== null) await winMan.virtualDesktop.GoToDesktopNumber(target);
    if (!winMan.focusWindowById(session.windowId)) log(`claude-wt: ${id} is not on screen`, 'warn');
  }

  async function focus(payload) {
    const { id } = parseIdPayload(payload);
    if (!id) return;
    const found = findSession(id);
    if (found.error) {
      log(`claude-wt: ${found.error}`, 'warn');
      notify(`claude-wt: ${found.error}`);
      return;
    }
    await focusOrRestore(id, found.session);
  }

  return {
    'claude-focus': focus,

    /**
     * Панель шлёт номер строки, а не id: топик в openhasp_buttons.yaml —
     * фиксированная строка и от содержимого строки зависеть не может.
     * Раскладка берётся из последнего экспорта, чтобы номер значил ровно то,
     * что человек видел в момент нажатия.
     */
    async 'claude-focus-slot'(payload) {
      const parsed = parseIdPayload(payload);
      const slot = parsed.slot !== undefined ? parsed.slot : parsed.id;
      const id = sessionIdForSlot(slots(), slot);
      if (!id) {
        log(`claude-wt: slot ${slot} is empty`, 'warn');
        return;
      }
      await focus({ id });
    },

    async 'claude-session-unread'(payload) {
      const { id } = parseIdPayload(payload);
      if (!id) return;
      let res;
      try {
        res = winMan.markSessionUnread(id);
      } catch (e) {
        log(`claude-wt mark unread failed: ${e.message}`, 'error');
        notify(`claude-wt: ${e.message}`);
        return;
      }
      if (!res.ok) {
        log(`claude-wt mark unread: ${res.reason}`, 'warn');
        notify(`claude-wt: ${res.reason}`);
        return;
      }
      log(`claude-wt marked unread: ${res.ids.join(', ')}`);
    },

    async 'claude-snapshot-restore'(payload) {
      const { id, sessionIds } = parseRestorePayload(payload);
      try {
        const { restored, skipped } = await winMan.restoreSnapshot({ id, sessionIds });
        log(`claude-wt snapshot ${id}: restored ${restored.length}, skipped ${skipped.length}`);
        if (!restored.length && !skipped.length) notify('claude-wt: нечего восстанавливать');
      } catch (e) {
        log(`claude-wt snapshot restore failed: ${e.message}`, 'error');
        notify(`claude-wt: ошибка восстановления — ${e.message}`);
      }
    },

    /**
     * Просьба пикера с чужой машины открыть сессию здесь.
     *
     * Пока поддержано одно действие — `terminal`: остальные (cursor, explorer,
     * pr) осмысленны только там, где стоит человек, и пикер выполняет их у
     * себя. Уже открытую сессию поднимаем, а не открываем второй копией.
     */
    async 'claude-session-open'(payload) {
      const parsed = parseIdPayload(payload);
      const { id, action } = parsed;
      if (!id || !action) return;
      if (action !== 'terminal') {
        log(`claude-wt session-open: unsupported action ${action}`, 'warn');
        return;
      }
      const found = findSession(id);
      if (found.error) {
        log(`claude-wt session-open: ${found.error}`, 'warn');
        notify(`claude-wt: ${found.error}`);
        return;
      }
      await focusOrRestore(id, found.session);
    },
  };
}

export { claudeCommands, parseIdPayload };
```

- [ ] **Step 4: Убедиться, что тест проходит**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/commands/claude-commands.test.js
```

Ожидается: PASS, 12 тестов.

- [ ] **Step 5: Коммит**

```bash
cd /home/popstas/projects/js/windows11-manager
git add src/commands/claude-commands.js src/commands/claude-commands.test.js
git commit -m "feat(commands): команды claude-wt переехали из windows-mqtt

claude-session-unread и claude-session-open заводятся впервые: у них были
только stdinActions старого пикера, из-за чего просьбы ccfzf-picker по MQTT
пропадали молча."
```

---

### Task 5: Экспорт в Home Assistant

**Репозиторий:** `windows11-manager`

Переезжают `src/homeassistant/{api,discovery,claude-sessions}.js` и цикл `exportToHomeAssistant` (`windows.js:490-621`).

**Files:**
- Create: `src/claude-wt/ha/discovery.js`, `src/claude-wt/ha/api.js`, `src/claude-wt/ha/entities.js`, `src/claude-wt/ha/export.js`
- Test: `src/claude-wt/ha/discovery.test.js`, `src/claude-wt/ha/api.test.js`, `src/claude-wt/ha/export.test.js`

**Interfaces:**
- Consumes: `buildSlots`, `labelSessions` из Task 3.
- Produces:
  - `topics(base) → { root, availability, slot(n), slotCommand(n), summary, slotConfig(n), summaryConfig }`
  - `discoveryMessages(base, count, names) → Array<{topic, payload, retain}>`, `stateMessages(base, entities) → Array<…>`, `namesFingerprint(names) → string`, `removalMessages(base, from, to)`
  - `sessionEntity(slot, nowSec)`, `buildSessionEntities(sessions, count, sort, nowSec)`, `buildSummaryEntity(sessions)`
  - `createHaExport({ winMan, publish, log, config }) → { start(), stop(), refresh(delayMs), slotOff(slot), slots() }`. `slots()` — та самая последняя раскладка, которую потребляет `claude-focus-slot` из Task 4; `slotOff(slot)` гасит переключатель, не дожидаясь очередного экспорта.

- [ ] **Step 1: Скопировать модули и тесты**

```bash
cd /home/popstas/projects/js/windows11-manager
W=/home/popstas/projects/js/windows-mqtt
cp $W/src/homeassistant/discovery.js       src/claude-wt/ha/discovery.js
cp $W/src/homeassistant/api.js             src/claude-wt/ha/api.js
cp $W/src/homeassistant/claude-sessions.js src/claude-wt/ha/entities.js
cp $W/test/homeassistant-discovery.test.js src/claude-wt/ha/discovery.test.js
cp $W/test/homeassistant-api.test.js       src/claude-wt/ha/api.test.js
```

- [ ] **Step 2: Убедиться, что тесты падают**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/claude-wt/ha/discovery.test.js src/claude-wt/ha/api.test.js
```

Ожидается: FAIL — `require is not defined`.

- [ ] **Step 3: Перевести в ESM и на vitest, поправить два места**

Конвертация — по правилам из Global Constraints. Дополнительно ровно две правки по существу:

1. В `src/claude-wt/ha/discovery.js` в объекте `DEVICE` поменять `manufacturer: 'windows-mqtt'` на `manufacturer: 'windows11-manager'`. `identifiers: ['claude_wt']` **не трогать** — по нему Home Assistant узнаёт то же устройство; сменится только подпись в карточке. Поправить ожидание в `discovery.test.js`, если оно там проверяется.
2. В `src/claude-wt/ha/entities.js` заменить импорты:

```js
import { buildSlots } from './session-slots.js';
import { formatAge } from './format-age.js';
```

- [ ] **Step 4: Убедиться, что тесты проходят**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/claude-wt/ha/discovery.test.js src/claude-wt/ha/api.test.js
```

Ожидается: PASS.

- [ ] **Step 5: Написать падающий тест на цикл экспорта**

Создать `src/claude-wt/ha/export.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHaExport } from './export.js';

const SESSIONS = [
  { id: 'a', title: 'alpha', open: true, agentState: 'review' },
  { id: 'b', title: 'beta', open: false, agentState: 'idle' },
];

function make(overrides = {}) {
  const publish = vi.fn();
  const exporter = createHaExport({
    winMan: {
      claudeWtSessions: vi.fn().mockReturnValue({ ok: true, sessions: SESSIONS }),
      ...overrides.winMan,
    },
    publish,
    log: vi.fn(),
    config: { base: 'home/room/pc/windows', homeassistant: { slots: 2, interval: 15 }, ...overrides.config },
  });
  return { exporter, publish };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createHaExport', () => {
  it('в слоты идут только открытые сессии', () => {
    const { exporter } = make();
    exporter.start();
    expect(exporter.slots().find((s) => s.slot === 1).id).toBe('a');
    expect(exporter.slots().some((s) => s.id === 'b')).toBe(false);
  });

  it('конфиги переиздаются только при смене имён', () => {
    const { exporter, publish } = make();
    exporter.start();
    const configTopics = () => publish.mock.calls.filter(([t]) => t.startsWith('homeassistant/')).length;
    const afterFirst = configTopics();
    expect(afterFirst).toBeGreaterThan(0);
    vi.advanceTimersByTime(15000);
    expect(configTopics()).toBe(afterFirst);
  });

  it('состояния публикуются на каждом тике', () => {
    const { exporter, publish } = make();
    exporter.start();
    const stateTopics = () => publish.mock.calls.filter(([t]) => t.includes('/claude/slot/')).length;
    const afterFirst = stateTopics();
    vi.advanceTimersByTime(15000);
    expect(stateTopics()).toBeGreaterThan(afterFirst);
  });

  it('stop помечает устройство недоступным', () => {
    const { exporter, publish } = make();
    exporter.start();
    publish.mockClear();
    exporter.stop();
    expect(publish).toHaveBeenCalledWith(
      'home/room/pc/windows/claude/availability', 'offline', { retain: true, qos: 0 },
    );
  });

  it('enabled: false не публикует ничего', () => {
    const { exporter, publish } = make({ config: { homeassistant: { enabled: false } } });
    exporter.start();
    expect(publish).not.toHaveBeenCalled();
  });

  it('сбой чтения сессий не роняет таймер', () => {
    const { exporter } = make({
      winMan: { claudeWtSessions: vi.fn(() => { throw new Error('SMB timeout'); }) },
    });
    exporter.start();
    expect(() => vi.advanceTimersByTime(15000)).not.toThrow();
  });
});
```

- [ ] **Step 6: Убедиться, что тест падает**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/claude-wt/ha/export.test.js
```

Ожидается: FAIL — `Failed to resolve import "./export.js"`.

- [ ] **Step 7: Написать цикл экспорта**

Создать `src/claude-wt/ha/export.js`:

```js
/**
 * Экспорт сессий claude-wt в Home Assistant. Переехал из
 * windows-mqtt/src/modules/windows.js:490-621.
 *
 * Транспорт — MQTT Discovery, а не REST: только так у сущностей появляется
 * устройство, unique_id и жизнь после перезапуска HA. /api/states пишет
 * состояние мимо реестра, поэтому там ни устройства, ни переименования.
 *
 * Свой таймер, а не подача пикера: панель показывает список постоянно.
 * Интервал редкий — claudeWtSessions() сканирует окна через getWindows(), и
 * раз в секунду в фоне ему тут делать нечего.
 */
import { labelSessions } from './session-groups.js';
import { buildSlots } from './session-slots.js';
import { discoveryMessages, namesFingerprint, stateMessages, topics } from './discovery.js';
import { sessionEntity, buildSessionEntities, buildSummaryEntity } from './entities.js';

// Два тика демона claude-wt (у него интервал 1000 мс). Отметку «просмотрено»
// ставит демон, а не мы в момент перевода фокуса, — значит сразу после
// focusWindowById() состояние на диске ещё прежнее, и экспорт по горячим
// следам опубликовал бы ровно тот статус, от которого человек только что ушёл.
const REFRESH_DELAY_MS = 2000;

function createHaExport({ winMan, publish, log, config }) {
  const ha = config?.homeassistant ?? {};
  const cfg = {
    slots: ha.slots ?? 10,
    interval: (ha.interval ?? 15) * 1000,
    enabled: ha.enabled !== false,
    // Закрытые сессии на панели только мешают: строк там единицы, и каждая,
    // занятая давно закрытой сессией, вытесняет живую.
    openOnly: ha.openOnly !== false,
    sort: ha.sort ?? 'activity',
  };
  const base = config.base;

  let timerId = null;
  let refreshId = null;
  let announced = null;
  let lastSlots = [];

  function publishAll(messages) {
    for (const m of messages) publish(m.topic, m.payload, { retain: m.retain, qos: 0 });
  }

  function tick() {
    if (!cfg.enabled) return;
    let sessions;
    try {
      const res = winMan.claudeWtSessions();
      if (!res.ok) throw new Error(res.reason);
      sessions = labelSessions(res.sessions);
    } catch (e) {
      log(`claude-wt sessions failed: ${e.message}`, 'error');
      return;
    }
    // Сводка считается по всем сессиям, слоты — только по живым: total в
    // сводке должен оставаться total.
    const slotSessions = cfg.openOnly ? sessions.filter((s) => s.open) : sessions;
    lastSlots = buildSlots(slotSessions, cfg.slots, cfg.sort);

    const fingerprint = namesFingerprint(lastSlots.map((s) => s.title));
    if (fingerprint !== announced) {
      publishAll(discoveryMessages(base, cfg.slots, lastSlots.map((s) => s.title)));
      announced = fingerprint;
    }
    publishAll(stateMessages(base, [
      buildSummaryEntity(sessions),
      ...buildSessionEntities(slotSessions, cfg.slots, cfg.sort),
    ]));
  }

  return {
    start() {
      if (!cfg.enabled || timerId !== null) return;
      log(`home assistant: publishing ${cfg.slots} session slots every ${cfg.interval / 1000}s`);
      tick();
      timerId = setInterval(tick, cfg.interval);
      timerId.unref?.();
    },

    stop() {
      if (refreshId !== null) {
        clearTimeout(refreshId);
        refreshId = null;
      }
      if (timerId === null) return;
      clearInterval(timerId);
      timerId = null;
      // Сущности станут unavailable, а не застынут с последним состоянием:
      // пока нас нет, никакой номер слота ничего не значит.
      publish(topics(base).availability, 'offline', { retain: true, qos: 0 });
    },

    /** Внеочередной экспорт после того, как мы сами перевели фокус. */
    refresh(delay = REFRESH_DELAY_MS) {
      // Один отложенный экспорт на серию нажатий: пока прошлый не отработал,
      // новый таймер публиковал бы то же самое.
      if (!cfg.enabled || refreshId !== null) return;
      refreshId = setTimeout(() => {
        refreshId = null;
        tick();
      }, delay);
      refreshId.unref?.();
    },

    /**
     * Погасить переключатель слота, не дожидаясь очередного экспорта.
     *
     * Публикуется слот целиком: состояние и атрибуты живут в одном топике, и
     * нагрузка из одного `state` стёрла бы текст, сводку и цифры.
     */
    slotOff(slot) {
      if (!cfg.enabled) return;
      const known = lastSlots.find((s) => s.slot === Number(slot));
      if (!known) return;
      publishAll(stateMessages(base, [{ ...sessionEntity(known), state: 'off' }]));
    },

    slots: () => lastSlots,
  };
}

export { createHaExport, REFRESH_DELAY_MS };
```

- [ ] **Step 8: Убедиться, что тест проходит**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/claude-wt/ha/
```

Ожидается: PASS — все файлы каталога, включая перенесённые в Task 3.

- [ ] **Step 9: Коммит**

```bash
cd /home/popstas/projects/js/windows11-manager
git add src/claude-wt/ha/
git commit -m "feat(claude-wt): экспорт сессий в Home Assistant переехал из windows-mqtt"
```

---

### Task 6: MQTT-клиент и точка входа

**Репозиторий:** `windows11-manager`

Собирает воедино роутер, обработчики и экспорт; заменяет мост `Rust → WS → Node`.

**Files:**
- Create: `src/mqtt/client.js`, `src/commands/build.js`, `src/mqtt/service.js`
- Test: `src/mqtt/client.test.js`, `src/commands/build.test.js`
- Modify: `src/index.js` (добавить команду `mqtt` рядом с `http-server`, строки 68-74)
- Modify: `package.json` (зависимость `mqtt`)

`buildCommandMap` живёт в `src/commands/build.js`, а не в `src/mqtt/`: его импортирует и HTTP-транспорт (Task 7), и через `src/mqtt/` он тянул бы за собой пакет `mqtt` в процесс, которому клиент не нужен.

**Interfaces:**
- Consumes: `createRouter` (Task 1), `windowCommands` (Task 2), `claudeCommands` (Task 4), `createHaExport` (Task 5), `throttlePress`, `createDelayedSlotOff` (Task 3).
- Produces:
  - `commandFromTopic(topic, base) → string | null` — `home/room/pc/windows/store` → `store`; `home/room/pc/windows/claude/slot/3/set` → `claude-slot-command:3`; чужой префикс → `null`.
  - `readMqttSettings(env) → { host, port, username, password, base } | null` — `null`, если `host` или `base` пусты.
  - `connectMqtt({ settings, onCommand, log }) → client`.
  - `buildCommandMap({ winMan, config, log, notify, haExport, publishDone }) → { [command]: handler }`. `publishDone(command)` публикует ответ `<base>/<command>/done`; его ждёт `power` в windows-mqtt перед перезагрузкой (Task 9). Необязателен — в HTTP-транспорте пустышка.
  - `startMqttService({ winMan, config, log, env }) → { stop() }`.

- [ ] **Step 1: Добавить зависимость**

```bash
cd /home/popstas/projects/js/windows11-manager && npm install mqtt@^5
```

- [ ] **Step 2: Написать падающий тест на разбор топика и настроек**

Создать `src/mqtt/client.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { commandFromTopic, readMqttSettings } from './client.js';

const BASE = 'home/room/pc/windows';

describe('commandFromTopic', () => {
  it('снимает префикс', () => {
    expect(commandFromTopic(`${BASE}/store`, BASE)).toBe('store');
    expect(commandFromTopic(`${BASE}/claude-focus`, BASE)).toBe('claude-focus');
  });

  it('узнаёт командный топик переключателя слота', () => {
    expect(commandFromTopic(`${BASE}/claude/slot/3/set`, BASE)).toBe('claude-slot-command:3');
  });

  it('не путает состояние слота с командой', () => {
    expect(commandFromTopic(`${BASE}/claude/slot/3`, BASE)).toBe(null);
  });

  it('отбрасывает чужой префикс', () => {
    expect(commandFromTopic('home/room/pc/audio/next', BASE)).toBe(null);
    expect(commandFromTopic(BASE, BASE)).toBe(null);
  });
});

describe('readMqttSettings', () => {
  it('собирает настройки из окружения', () => {
    expect(readMqttSettings({
      W11M_MQTT_HOST: 'mqtt.lan', W11M_MQTT_PORT: '1883',
      W11M_MQTT_USER: 'u', W11M_MQTT_PASS: 'p', W11M_MQTT_BASE: BASE,
    })).toEqual({ host: 'mqtt.lan', port: 1883, username: 'u', password: 'p', base: BASE });
  });

  it('порт по умолчанию 1883', () => {
    expect(readMqttSettings({ W11M_MQTT_HOST: 'mqtt.lan', W11M_MQTT_BASE: BASE }).port).toBe(1883);
  });

  it('без хоста или базы — null', () => {
    expect(readMqttSettings({ W11M_MQTT_BASE: BASE })).toBe(null);
    expect(readMqttSettings({ W11M_MQTT_HOST: 'mqtt.lan' })).toBe(null);
  });
});
```

- [ ] **Step 3: Убедиться, что тест падает**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/mqtt/client.test.js
```

Ожидается: FAIL — `Failed to resolve import "./client.js"`.

- [ ] **Step 4: Написать клиент**

Создать `src/mqtt/client.js`:

```js
/**
 * MQTT-клиент менеджера.
 *
 * До переезда подписку держал Rust (tauri-app/src-tauri/src/mqtt.rs) и гнал
 * команды в node по WebSocket. Раз node всё равно заводит клиент ради
 * публикации в Home Assistant, второй перескок стал лишним.
 *
 * Настройки приходят окружением, а не аргументами: пароль в argv виден в
 * списке процессов.
 */
import mqtt from 'mqtt';

/** Топик командного переключателя слота: `<base>/claude/slot/<n>/set`. */
const SLOT_COMMAND = /^claude\/slot\/(\d+)\/set$/;

function commandFromTopic(topic, base) {
  const prefix = `${base}/`;
  if (!topic.startsWith(prefix)) return null;
  const rest = topic.slice(prefix.length);
  if (!rest) return null;
  const slot = rest.match(SLOT_COMMAND);
  if (slot) return `claude-slot-command:${slot[1]}`;
  // Всё остальное с косой чертой — наши же публикации (claude/slot/N,
  // claude/summary, stats/...): подписка идёт на `#`, и своё эхо надо
  // отбрасывать, иначе роутер будет ругаться на неизвестные команды.
  return rest.includes('/') ? null : rest;
}

function readMqttSettings(env = process.env) {
  const host = (env.W11M_MQTT_HOST ?? '').trim();
  const base = (env.W11M_MQTT_BASE ?? '').trim().replace(/\/$/, '');
  if (!host || !base) return null;
  return {
    host,
    port: Number(env.W11M_MQTT_PORT) || 1883,
    username: (env.W11M_MQTT_USER ?? '').trim(),
    password: env.W11M_MQTT_PASS ?? '',
    base,
  };
}

/**
 * Подключиться и звать `onCommand(command, payload)` на каждое сообщение.
 *
 * Переподключение оставлено библиотеке: `reconnectPeriod` у mqtt.js встроен, а
 * своя петля поверх него давала бы два таймера на одно соединение.
 */
function connectMqtt({ settings, onCommand, log }) {
  const url = `mqtt://${settings.host}:${settings.port}`;
  const client = mqtt.connect(url, {
    clientId: `w11mgr-${process.pid}`,
    username: settings.username || undefined,
    password: settings.username ? settings.password : undefined,
    keepalive: 30,
    reconnectPeriod: 5000,
  });

  client.on('connect', () => {
    log(`MQTT connected to ${url}`);
    client.subscribe(`${settings.base}/#`, { qos: 0 }, (err) => {
      if (err) log(`MQTT subscribe error: ${err.message}`, 'error');
      else log(`MQTT subscribed to ${settings.base}/#`);
    });
  });

  client.on('reconnect', () => log('MQTT reconnecting'));
  client.on('error', (err) => log(`MQTT error: ${err.message}`, 'error'));

  client.on('message', (topic, payload) => {
    const command = commandFromTopic(topic, settings.base);
    if (!command) return;
    onCommand(command, payload.toString());
  });

  return client;
}

export { commandFromTopic, readMqttSettings, connectMqtt, SLOT_COMMAND };
```

- [ ] **Step 5: Убедиться, что тест проходит**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/mqtt/client.test.js
```

Ожидается: PASS, 7 тестов.

- [ ] **Step 6: Написать падающий тест на сборку карты**

Создать `src/commands/build.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { buildCommandMap } from './build.js';

function winManStub() {
  return {
    placeWindows: vi.fn().mockResolvedValue([]),
    placeWindowByConfig: vi.fn(),
    storeWindows: vi.fn(),
    restoreWindows: vi.fn().mockResolvedValue(undefined),
    clearWindows: vi.fn(),
    openStore: vi.fn(),
    focusWindow: vi.fn().mockResolvedValue(true),
    reloadConfigs: vi.fn(),
    claudeWtSessions: vi.fn().mockReturnValue({ ok: true, sessions: [] }),
    getWindowById: vi.fn(),
    focusWindowById: vi.fn(),
    markSessionUnread: vi.fn(),
    restoreSnapshot: vi.fn(),
    restoreClaudeSessions: vi.fn(),
    virtualDesktop: { GetWindowDesktopNumber: vi.fn(), GoToDesktopNumber: vi.fn() },
  };
}

function makeMap(overrides = {}) {
  return buildCommandMap({
    winMan: winManStub(),
    config: { base: 'home/room/pc/windows' },
    log: vi.fn(),
    notify: vi.fn(),
    haExport: { slots: () => [], slotOff: vi.fn(), refresh: vi.fn() },
    ...overrides,
  });
}

describe('buildCommandMap', () => {
  const map = makeMap();

  it('содержит все оконные команды', () => {
    for (const c of ['autoplace', 'place', 'placeAll', 'store', 'restore', 'clear', 'open', 'focus', 'desktop', 'reload']) {
      expect(Object.keys(map)).toContain(c);
    }
  });

  it('содержит все команды claude-wt', () => {
    for (const c of ['claude-focus', 'claude-focus-slot', 'claude-session-unread', 'claude-snapshot-restore', 'claude-session-open', 'claude-wt-restore']) {
      expect(Object.keys(map)).toContain(c);
    }
  });

  it('заводит по обработчику на каждый командный топик слота', () => {
    expect(Object.keys(map).filter((k) => k.startsWith('claude-slot-command:')).length).toBeGreaterThan(0);
  });

  it('в карте нет команд мёртвого пикера', () => {
    for (const c of ['claude-sessions-start', 'claude-sessions-stop', 'claude-sessions-sort-cycle', 'claude-sessions-toggle', 'claude-session-actions', 'claude-snapshots']) {
      expect(Object.keys(map)).not.toContain(c);
    }
  });

  it('после store публикует ответ, которого ждёт windows-mqtt перед перезагрузкой', async () => {
    const publishDone = vi.fn();
    await makeMap({ publishDone }).store();
    expect(publishDone).toHaveBeenCalledWith('store');
  });

  it('без publishDone store всё равно работает', async () => {
    await expect(makeMap().store()).resolves.not.toThrow();
  });
});
```

- [ ] **Step 7: Убедиться, что тест падает**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/commands/build.test.js
```

Ожидается: FAIL — `Failed to resolve import "./build.js"`.

- [ ] **Step 8: Написать сборку карты**

Создать `src/commands/build.js`:

```js
/**
 * Карта команд целиком — общая для обоих транспортов.
 *
 * Живёт в commands/, а не в mqtt/: её импортирует и http-сервер, и через
 * mqtt/ он тянул бы за собой клиент брокера, который ему не нужен.
 */
import { windowCommands } from './window-commands.js';
import { claudeCommands } from './claude-commands.js';
import { throttlePress } from './press-throttle.js';
import { createDelayedSlotOff } from './delayed-slot-off.js';

const SLOT_COUNT_DEFAULT = 10;

/**
 * Карта команд целиком.
 *
 * Ограничитель стоит на том, что приходит с физической кнопки платы:
 * `claude-focus-slot` и `claude-snapshot-restore`. Палец, снятый неровно, даёт
 * две-три посылки подряд, а каждая — переход фокуса в Windows, то есть
 * настоящая работа. `claude-focus` без ограничителя: там источник — Enter в
 * списке пикера, дребезжать нечему.
 */
function buildCommandMap({ winMan, config, log, notify, haExport, publishDone = () => {} }) {
  const windows = windowCommands({ winMan, config, log });
  const claude = claudeCommands({ winMan, log, notify, slots: () => haExport.slots() });

  // Панель с toggle:true рисует локальное включение раньше, чем доедет MQTT.
  // Полсекунды — после локального toggle, до ощущения «залипло».
  const schedulePanelSlotOff = createDelayedSlotOff({
    delayMs: 500,
    publish: (slot) => haExport.slotOff(slot),
  });

  /** После собственного перевода фокуса панель обновляем внеочередно. */
  const withRefresh = (fn) => async (payload) => {
    const result = await fn(payload);
    haExport.refresh();
    return result;
  };

  const map = {
    ...windows,
    // Ответ на просьбу сохранить раскладку. Его ждёт модуль power в
    // windows-mqtt перед перезагрузкой: подтверждение брокера говорит лишь о
    // доставке до него, а не о том, что раскладка записана на диск.
    async store(payload) {
      const result = await windows.store(payload);
      publishDone('store');
      return result;
    },
    'claude-focus': withRefresh(claude['claude-focus']),
    'claude-focus-slot': throttlePress(
      withRefresh(async (payload) => {
        await claude['claude-focus-slot'](payload);
        schedulePanelSlotOff(typeof payload === 'object' ? payload?.slot : payload);
      }),
      { onDrop: (payload) => log(`claude-focus-slot ${payload} — отброшено, не чаще раза в секунду`, 'warn') },
    ),
    'claude-session-unread': withRefresh(claude['claude-session-unread']),
    'claude-session-open': withRefresh(claude['claude-session-open']),
    'claude-snapshot-restore': throttlePress(claude['claude-snapshot-restore'], {
      onDrop: (payload) => log(`claude-snapshot-restore ${payload} — отброшено, не чаще раза в секунду`, 'warn'),
    }),
    async 'claude-wt-restore'(payload) {
      const { restoreClaudeSessions } = await import('../claude-wt/restore.js');
      const body = typeof payload === 'string' ? JSON.parse(payload || '{}') : (payload ?? {});
      return restoreClaudeSessions({ force: Boolean(body.force), sessionIds: body.sessionIds });
    },
  };

  // Нажатие на переключатель сессии в интерфейсе Home Assistant. Гасим до
  // перехода, а не после: focusWindowById() ходит в Windows и может
  // задуматься, а переключатель к этому моменту уже должен стоять правильно.
  const slotCount = config?.homeassistant?.slots ?? SLOT_COUNT_DEFAULT;
  for (let n = 1; n <= slotCount; n += 1) {
    map[`claude-slot-command:${n}`] = async () => {
      haExport.slotOff(n);
      await claude['claude-focus-slot']({ slot: n });
      haExport.refresh();
    };
  }

  return map;
}

export { buildCommandMap, SLOT_COUNT_DEFAULT };
```

- [ ] **Step 9: Убедиться, что тест проходит**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/commands/build.test.js src/mqtt/client.test.js
```

Ожидается: PASS, 13 тестов.

- [ ] **Step 10: Написать службу**

Создать `src/mqtt/service.js`:

```js
/**
 * Долгоживущая служба: клиент, карта команд, экспорт в Home Assistant.
 *
 * Процесс отдельный от демона claude-wt намеренно: http-сервер, поднятый
 * внутри демона, вешал событийный цикл через две-три минуты (см. src/lib/index.js).
 */
import { createRouter } from '../commands/router.js';
import { buildCommandMap } from '../commands/build.js';
import { createHaExport } from '../claude-wt/ha/export.js';
import { connectMqtt, readMqttSettings } from './client.js';

function startMqttService({ winMan, config, log, env = process.env }) {
  const settings = readMqttSettings(env);
  if (!settings) {
    log('MQTT: W11M_MQTT_HOST или W11M_MQTT_BASE не заданы — служба не поднята', 'warn');
    return { stop() {} };
  }

  const withBase = { ...config, base: settings.base };
  let client = null;
  const publish = (topic, payload, opts) => client?.publish(topic, String(payload), opts ?? {});
  const notify = (message) => publish(`${settings.base}/notify/notify`, message);
  const publishDone = (command) => publish(`${settings.base}/${command}/done`, '1');

  const haExport = createHaExport({ winMan, publish, log, config: withBase });
  const router = createRouter(buildCommandMap({
    winMan, config: withBase, log, notify, haExport, publishDone,
  }));

  client = connectMqtt({
    settings,
    log,
    onCommand: async (command, payload) => {
      const res = await router.dispatch(command, payload);
      if (!res.ok) log(`MQTT ${command}: ${res.error}`, 'warn');
    },
  });

  client.on('connect', () => haExport.start());

  return {
    stop() {
      haExport.stop();
      client?.end(true);
    },
  };
}

export { startMqttService };
```

- [ ] **Step 11: Добавить команду CLI**

В `src/index.js` после блока `http-server` (строки 68-74) вставить:

```js
  program
    .command('mqtt')
    .description('MQTT: подписка на команды окон и экспорт сессий в Home Assistant')
    .action(async () => {
      const { startMqttService } = await import('./mqtt/service.js');
      const log = (message, level = 'info') => {
        if (level === 'error') console.error(`[mqtt] ${message}`);
        else console.log(`[mqtt] ${message}`);
      };
      startMqttService({ winMan, config: winMan.getConfig(), log });
    });
```

- [ ] **Step 12: Проверить, что команда поднимается и без брокера не падает**

```bash
cd /home/popstas/projects/js/windows11-manager && node src/index.js mqtt
```

Ожидается: строка `[mqtt] MQTT: W11M_MQTT_HOST или W11M_MQTT_BASE не заданы — служба не поднята` и выход без исключения (переменных нет). Прервать `Ctrl+C`, если процесс остался.

- [ ] **Step 13: Коммит**

```bash
cd /home/popstas/projects/js/windows11-manager
git add package.json package-lock.json src/mqtt/ src/commands/build.js src/commands/build.test.js src/index.js
git commit -m "feat(mqtt): свой клиент и команда mqtt вместо моста через Rust"
```

---

### Task 7: HTTP-сервер поверх роутера

**Репозиторий:** `windows11-manager`

Второй транспорт той же карты; заодно закрывает дубль `switch`, ради которого роутер и заводился.

**Files:**
- Modify: `src/http-server.js` (переписать целиком)
- Test: `src/http-server.test.js`

**Interfaces:**
- Consumes: `buildCommandMap` (Task 6), `createRouter` (Task 1).
- Produces: `startHttpServer(port, deps)` — как раньше, но `deps` необязателен; `routeToCommand(url) → string | null` для тестов.

- [ ] **Step 1: Написать падающий тест**

Создать `src/http-server.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { routeToCommand } from './http-server.js';

describe('routeToCommand', () => {
  it('переводит путь в команду', () => {
    expect(routeToCommand('/place')).toBe('place');
    expect(routeToCommand('/placeAll')).toBe('placeAll');
    expect(routeToCommand('/store')).toBe('store');
    expect(routeToCommand('/desktop')).toBe('desktop');
  });

  it('терпит хвостовую косую черту', () => {
    expect(routeToCommand('/store/')).toBe('store');
  });

  it('знает вложенный путь claude-wt', () => {
    expect(routeToCommand('/claude-wt/restore')).toBe('claude-wt-restore');
    expect(routeToCommand('/claude-wt/session-open')).toBe('claude-session-open');
  });

  it('чужой путь — null', () => {
    expect(routeToCommand('/nope')).toBe(null);
    expect(routeToCommand('/')).toBe(null);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/http-server.test.js
```

Ожидается: FAIL — `routeToCommand is not a function`.

- [ ] **Step 3: Переписать http-server.js**

Заменить содержимое `src/http-server.js` на:

```js
/**
 * HTTP-транспорт поверх той же карты команд, что и MQTT.
 *
 * Раньше здесь был свой switch, второй такой же жил в ws-client.js, и при пяти
 * командах они уже разъезжались. Теперь путь переводится в имя команды, а
 * дальше работает роутер.
 *
 * Сервер поднимается отдельной командой (`node src/index.js http-server`), а не
 * внутри процесса демона: там он вешал событийный цикл через две-три минуты.
 */
import http from 'node:http';
import * as winMan from './lib/index.js';
import { createRouter } from './commands/router.js';
import { buildCommandMap } from './commands/build.js';

const ROUTES = {
  '/place': 'place',
  '/placeAll': 'placeAll',
  '/store': 'store',
  '/restore': 'restore',
  '/clear': 'clear',
  '/open': 'open',
  '/focus': 'focus',
  '/desktop': 'desktop',
  '/reload': 'reload',
  '/autoplace': 'autoplace',
  '/claude-wt/restore': 'claude-wt-restore',
  '/claude-wt/focus': 'claude-focus',
  '/claude-wt/session-open': 'claude-session-open',
  '/claude-wt/session-unread': 'claude-session-unread',
  '/claude-wt/snapshot-restore': 'claude-snapshot-restore',
};

function routeToCommand(url) {
  const clean = String(url ?? '').replace(/\/+$/, '') || '/';
  return ROUTES[clean] ?? null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function startHttpServer(port = 9722) {
  const log = (message, level = 'info') => {
    if (level === 'error') console.error(`[http] ${message}`);
    else console.log(`[http] ${message}`);
  };
  const config = winMan.getConfig();
  // Экспорт в HA живёт в mqtt-процессе; здесь нужна только его форма, чтобы
  // команды claude-wt получили slots()/slotOff()/refresh() и не проверяли их
  // на существование в каждом вызове.
  const haExport = { slots: () => [], slotOff: () => {}, refresh: () => {} };
  const router = createRouter(buildCommandMap({
    winMan, config, log, notify: (m) => log(m), haExport,
  }));

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    const command = routeToCommand(req.url);
    if (!command) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
    log(`POST ${req.url}: ${JSON.stringify(body)}`);
    const result = await router.dispatch(command, body);
    if (!result.ok) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: result.error }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...(result.result ?? {}) }));
  });

  server.listen(port, () => log(`HTTP server listening on port ${port}`));
  return server;
}

export { startHttpServer, routeToCommand, ROUTES };
```

- [ ] **Step 4: Убедиться, что тест проходит**

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/http-server.test.js
```

Ожидается: PASS, 4 теста.

- [ ] **Step 5: Коммит**

```bash
cd /home/popstas/projects/js/windows11-manager
git add src/http-server.js src/http-server.test.js
git commit -m "refactor(http): сервер работает поверх карты команд"
```

---

### Task 8: Снос моста через Rust

**Репозиторий:** `windows11-manager`

**Files:**
- Delete: `tauri-app/src-tauri/src/mqtt.rs`, `tauri-app/src-tauri/src/ws_server.rs`, `src/ws-client.js`
- Modify: `tauri-app/src-tauri/src/lib.rs`, `tauri-app/src-tauri/Cargo.toml`

- [ ] **Step 1: Убедиться, что сборка сейчас проходит**

```bash
cd /home/popstas/projects/js/windows11-manager/tauri-app/src-tauri && . "$HOME/.cargo/env" && cargo build 2>&1 | tail -5
```

Ожидается: `Finished`. Если сборка падает уже сейчас — остановиться и разобраться, не начиная правок.

- [ ] **Step 2: Удалить файлы**

```bash
cd /home/popstas/projects/js/windows11-manager
git rm tauri-app/src-tauri/src/mqtt.rs tauri-app/src-tauri/src/ws_server.rs src/ws-client.js
```

- [ ] **Step 3: Поправить lib.rs**

В `tauri-app/src-tauri/src/lib.rs`:

1. Убрать `mod mqtt;` и `mod ws_server;`.
2. В `AppState` заменить поле `ws_client_child: Option<CommandChild>` на `mqtt_child: Option<CommandChild>`; убрать поля хендлов MQTT и WS-сервера, если они там есть.
3. Найти место, где спавнится `ws-client.js` (поиск: `rg 'ws-client' src/lib.rs`), и заменить аргументы на `["src/index.js", "mqtt"]`, добавив окружение из настроек — тем же способом, каким `run_node_command` уже задаёт рабочий каталог:

```rust
.env("W11M_MQTT_HOST", settings.mqtt_host.clone())
.env("W11M_MQTT_PORT", settings.mqtt_port.to_string())
.env("W11M_MQTT_USER", settings.mqtt_username.clone())
.env("W11M_MQTT_PASS", settings.mqtt_password.clone())
.env("W11M_MQTT_BASE", settings.mqtt_topic.clone())
```

4. Убрать вызовы `start_mqtt(...)` и `start_ws_server(...)` вместе с их `tauri::async_runtime::spawn`.
5. Пункт трея, показывающий состояние MQTT, переименовать в состояние процесса: текст `MQTT: connected/disconnected` заменить на `MQTT: running/stopped` по наличию `mqtt_child`. Это сознательная потеря из спеки — факт подключения теперь виден только в логе node-процесса.

- [ ] **Step 4: Убрать неиспользуемые зависимости**

В `tauri-app/src-tauri/Cargo.toml` удалить строки `rumqttc`, `tokio-tungstenite` и `futures-util`, если после правки на них никто не ссылается. Проверить:

```bash
cd /home/popstas/projects/js/windows11-manager/tauri-app/src-tauri && rg -l 'rumqttc|tokio_tungstenite|futures_util' src/ || echo "не используются"
```

- [ ] **Step 5: Собрать**

```bash
cd /home/popstas/projects/js/windows11-manager/tauri-app/src-tauri && . "$HOME/.cargo/env" && cargo build 2>&1 | tail -20
```

Ожидается: `Finished`. Предупреждений о неиспользуемых импортах быть не должно.

- [ ] **Step 6: Прогнать все тесты**

```bash
cd /home/popstas/projects/js/windows11-manager && npm test
```

Ожидается: PASS целиком.

- [ ] **Step 7: Коммит**

```bash
cd /home/popstas/projects/js/windows11-manager
git add -A tauri-app/src-tauri src/ws-client.js
git commit -m "refactor(tauri): мост MQTT через Rust снесён, трей поднимает node-службу"
```

---

## Фаза 2 — windows-mqtt: развязка

### Task 9: Флаг и модуль питания

**Репозиторий:** `windows-mqtt`

**`windows.js` в этой задаче не удаляется.** Флаг выбран как способ отката без отката релиза — откатывать нечего, если модуль уже снесён. Он гаснет настройкой, а удаление идёт отдельной задачей (Task 13), после того как ручной чеклист пройден на живой машине.

Два модуля никогда не работают вместе: при `windows.enabled: true` питание обслуживает старый `windows.js`, при `false` — новый `power`. Иначе на `windows/restart` отвечали бы оба.

**Files:**
- Create: `src/modules/power.js`, `test/power.test.js`
- Modify: `src/modules/index.js`, `config.example.yml`

**Interfaces:**
- Produces: модуль `power` с подписками `sleep`, `restart`, `shutdown`, `restart_restore` и обработчиком ответного `windows/store/done`.

- [ ] **Step 1: Написать падающий тест на сохранение через брокер**

Создать `test/power.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { storeThen } = require('../src/modules/power');

test('storeThen публикует просьбу сохранить раскладку', async () => {
  const published = [];
  const done = storeThen({
    publish: (topic, payload) => published.push([topic, payload]),
    base: 'home/room/pc/windows',
    onDone: () => {},
    timeoutMs: 50,
    setTimeoutFn: (fn) => { fn(); return 0; },
    clearTimeoutFn: () => {},
  });
  await done;
  assert.deepEqual(published, [['home/room/pc/windows/store', '1']]);
});

test('storeThen идёт дальше по ответу и снимает таймер', async () => {
  const cleared = [];
  let resolveAck;
  const ack = new Promise((r) => { resolveAck = r; });
  const p = storeThen({
    publish: () => {},
    base: 'b',
    ack,
    timeoutMs: 10000,
    // Таймер не срабатывает никогда: если бы промис ждал только его, тест
    // повис бы на 10 секунд и упал по таймауту раннера.
    setTimeoutFn: () => 77,
    clearTimeoutFn: (id) => cleared.push(id),
  });
  resolveAck();
  await p;
  assert.deepEqual(cleared, [77], 'таймер снят, потому что ответ пришёл раньше');
});

test('storeThen не ждёт вечно, если ответа нет', async () => {
  let timeoutFn;
  const p = storeThen({
    publish: () => {},
    base: 'b',
    ack: new Promise(() => {}),
    timeoutMs: 5000,
    setTimeoutFn: (fn) => { timeoutFn = fn; return 1; },
    clearTimeoutFn: () => {},
  });
  timeoutFn();
  await p;
});
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
cd /home/popstas/projects/js/windows-mqtt && node --test test/power.test.js
```

Ожидается: FAIL — `Cannot find module '../src/modules/power'`.

- [ ] **Step 3: Написать модуль power**

Создать `src/modules/power.js`:

```js
/** Питание машины. Осталось здесь после того, как окна уехали в windows11-manager. */
const {exec} = require('child_process');

/**
 * Попросить менеджер сохранить раскладку и дождаться ответа.
 *
 * Ждать подтверждения брокера бессмысленно: QoS говорит о доставке до брокера,
 * а не о том, что раскладка записана на диск. Признак — ответная публикация
 * `windows/store/done`, которую менеджер шлёт по завершении storeWindows().
 * Таймаут нужен на случай, когда менеджера нет вовсе: перезагрузка без
 * сохранения лучше, чем машина, которая не перезагружается.
 */
function storeThen({
  publish, base, ack, timeoutMs = 5000,
  setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout,
}) {
  publish(`${base}/store`, '1');
  return new Promise((resolve) => {
    const timer = setTimeoutFn(resolve, timeoutMs);
    if (ack && typeof ack.then === 'function') {
      ack.then(() => {
        clearTimeoutFn(timer);
        resolve();
      });
    }
  });
}

function sleep() {
  setTimeout(() => exec('D:/prog/SysinternalsSuite/psshutdown.exe -d -t 0'), 1000);
}

function restart() {
  setTimeout(() => exec('shutdown -t 0 -r -f'), 1000);
}

function shutdown() {
  setTimeout(() => exec('shutdown -t 0 -s -f'), 1000);
}

module.exports = async (mqtt, config, log) => {
  // Ответ менеджера ловится одной подпиской на всё время жизни модуля: своей
  // на каждую перезагрузку было бы столько же, сколько перезагрузок.
  let ackResolvers = [];
  function nextAck() {
    return new Promise((resolve) => ackResolvers.push(resolve));
  }
  function onStoreDone() {
    const pending = ackResolvers;
    ackResolvers = [];
    for (const r of pending) r();
  }

  const publish = (topic, payload) => mqtt.publish(topic, payload);

  async function storeAndThen(action) {
    await storeThen({publish, base: config.base, ack: nextAck()});
    action();
  }

  return {
    subscriptions: [
      {topics: [`${config.base}/store/done`], handler: onStoreDone},
      {topics: [`${config.base}/sleep`], handler: () => sleep()},
      {
        topics: [`${config.base}/restart`],
        handler: (topic, message) => {
          log(`< ${topic}: ${message}`);
          if (`${message}` === 'nostore') restart();
          else storeAndThen(restart);
        },
      },
      {
        topics: [`${config.base}/shutdown`],
        handler: (topic, message) => {
          log(`< ${topic}: ${message}`);
          if (`${message}` === 'store') storeAndThen(shutdown);
          else shutdown();
        },
      },
      {topics: [`${config.base}/restart_restore`], handler: () => storeAndThen(restart)},
    ],
    menuItems: [
      {label: 'Restart with windows restore', click: () => storeAndThen(restart)},
      {label: 'Sleep', click: sleep},
      {label: 'Restart', click: restart},
      {label: 'Shutdown', click: shutdown},
    ],
  };
};

module.exports.storeThen = storeThen;
```

- [ ] **Step 4: Убедиться, что тест проходит**

```bash
cd /home/popstas/projects/js/windows-mqtt && node --test test/power.test.js
```

Ожидается: PASS, 3 теста.

- [ ] **Step 5: Опубликовать ответ на стороне менеджера**

Вернуться в `windows11-manager` и в `src/mqtt/service.js`, в `buildCommandMap`, обернуть `store`:

```js
    async store(payload) {
      const result = await windows.store(payload);
      publishDone('store');
      return result;
    },
```

где `publishDone` приходит новым полем `deps` (`publishDone: (command) => publish(`${base}/${command}/done`, '1')`) и передаётся из `startMqttService`. Добавить в `src/mqtt/service.test.js`:

```js
  it('после store публикует ответ', async () => {
    const publishDone = vi.fn();
    const m = buildCommandMap({
      winMan: winManStub(), config: { base: 'b' }, log: vi.fn(), notify: vi.fn(),
      haExport: { slots: () => [], slotOff: vi.fn(), refresh: vi.fn() }, publishDone,
    });
    await m.store();
    expect(publishDone).toHaveBeenCalledWith('store');
  });
```

Прогнать:

```bash
cd /home/popstas/projects/js/windows11-manager && npx vitest run src/mqtt/service.test.js
```

Ожидается: PASS.

- [ ] **Step 6: Развести модули по флагу**

В `src/modules/index.js` зарегистрировать `power` рядом с `windows` и сделать выбор взаимоисключающим — какой бы способ включения модулей там ни использовался, условие одно: `windows` грузится при `windows.enabled !== false`, `power` — при `windows.enabled === false`.

В `config.example.yml` в секции `windows` добавить:

```yaml
  # Оконные команды и claude-wt переехали в windows11-manager. false отдаёт их
  # ему и оставляет здесь только питание машины (модуль power). Это выключатель
  # перехода: при неполадке вернуть true и перезапустить.
  enabled: true
```

- [ ] **Step 7: Проверить обе ветки**

```bash
cd /home/popstas/projects/js/windows-mqtt && node --test test/**/*.test.js 2>&1 | tail -10
```

Ожидается: PASS. Затем убедиться руками, что при `enabled: false` в списке загруженных модулей есть `power` и нет `windows`, а при `true` — наоборот (строки старта в `windowsmqtt.out.log`).

- [ ] **Step 8: Коммит**

```bash
cd /home/popstas/projects/js/windows-mqtt
git add src/modules/power.js test/power.test.js src/modules/index.js config.example.yml
git commit -m "feat(power): питание машины отдельным модулем за флагом windows.enabled

Раскладка перед перезагрузкой сохраняется просьбой по MQTT с ответным
store/done вместо прямого вызова библиотеки. windows.js пока на месте: флаг —
это способ отката, и откатывать было бы нечего."
```

---

## Фаза 3 — ccfzf-picker

### Task 10: Открытие сессии через менеджер

**Репозиторий:** `ccfzf-picker`

**Files:**
- Create: `frontend-src/open-transport.js`
- Test: `test/open-transport.test.js`
- Modify: `sessions.html` (ветка открытия в обработчике Enter, около строки 911)

**Interfaces:**
- Produces: `chooseOpenTransport(state, configHost) → 'manager' | 'local'` — `manager`, когда `state.windowHost` совпал с `CONFIG.windowHost`; иначе `local`.

Отличие от `canFocus()` (`frontend-src/session-windows.js:35`): там дополнительно требуется `windowPid > 0`, потому что подъём окна на Windows требует передачи права переднего плана. Для выбора способа **открытия** pid не нужен — предикат отдельный, не переиспользуется.

- [ ] **Step 1: Написать падающий тест**

Создать `test/open-transport.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseOpenTransport } = require('../frontend-src/open-transport');

test('свой хост — открываем через менеджер', () => {
  assert.equal(chooseOpenTransport({ windowHost: 'PC-WIN' }, 'pc-win'), 'manager');
});

test('регистр и пробелы не мешают', () => {
  assert.equal(chooseOpenTransport({ windowHost: ' pc-win ' }, 'PC-Win'), 'manager');
});

test('чужой хост — открываем локально', () => {
  assert.equal(chooseOpenTransport({ windowHost: 'PC-WIN' }, 'macbook'), 'local');
});

test('пустой windowHost в конфиге — локально', () => {
  assert.equal(chooseOpenTransport({ windowHost: 'PC-WIN' }, ''), 'local');
  assert.equal(chooseOpenTransport({ windowHost: 'PC-WIN' }, undefined), 'local');
});

test('нет ответа агрегатора — локально', () => {
  assert.equal(chooseOpenTransport(null, 'pc-win'), 'local');
  assert.equal(chooseOpenTransport({}, 'pc-win'), 'local');
});

test('pid трекера на выбор не влияет', () => {
  assert.equal(chooseOpenTransport({ windowHost: 'pc-win', windowPid: 0 }, 'pc-win'), 'manager');
});
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
cd /home/popstas/projects/js/ccfzf-picker && node --test test/open-transport.test.js
```

Ожидается: FAIL — `Cannot find module '../frontend-src/open-transport'`.

- [ ] **Step 3: Написать модуль**

Создать `frontend-src/open-transport.js` (тем же двойным экспортом, что и соседи — файл грузится и как `<script>`, и как модуль в тестах):

```js
// Loaded twice: as a <script> in sessions.html and as a module in the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OpenTransport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function normHost(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }

  /**
   * Кто открывает сессию.
   *
   * На машине оконного трекера — он: маппинг проекта на профиль Windows
   * Terminal (`claudeWt.projects`) знает только windows11-manager, и собранная
   * здесь команда `wt.exe` этот профиль теряет.
   *
   * Где трекера нет — открываем сами, как раньше: на macOS менеджера не
   * существует, и просьба уехала бы открывать окно на чужой машине.
   *
   * `windowPid` здесь, в отличие от `canFocus`, не смотрим: право переднего
   * плана нужно для подъёма окна, а не для запуска терминала.
   */
  function chooseOpenTransport(state, configHost) {
    const host = normHost((state || {}).windowHost);
    const mine = normHost(configHost);
    return host && host === mine ? 'manager' : 'local';
  }

  return { chooseOpenTransport };
});
```

- [ ] **Step 4: Убедиться, что тест проходит**

```bash
cd /home/popstas/projects/js/ccfzf-picker && node --test test/open-transport.test.js
```

Ожидается: PASS, 6 тестов.

- [ ] **Step 5: Подключить в sessions.html**

Добавить `<script src="frontend-src/open-transport.js"></script>` рядом с остальными в шапке `sessions.html`, а в обработчике открытия (около строки 911, где сейчас зовётся `chooseOpenStrategy(row, CONFIG.caps, { canFocus: canFocusWindows() })`) поставить перед ним ветку:

```js
      if (window.OpenTransport.chooseOpenTransport(lastState, CONFIG.windowHost) === 'manager') {
        // Менеджер знает профиль Windows Terminal для этого проекта; собранная
        // здесь команда его теряет.
        await openViaManager(row.id);
        return;
      }
```

и рядом — саму функцию, которая шлёт POST на петлевой адрес:

```js
  /** Просьба к windows11-manager открыть сессию у себя. Порт из config.yaml,
   *  умолчание — 9722, как у команды `node src/index.js http-server`. */
  async function openViaManager(id) {
    const port = CONFIG.managerPort || 9722;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/claude-wt/session-open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'terminal' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      // Менеджер мог быть выключен: не молчим — иначе Enter выглядит нажатым
      // впустую, ровно как публикация в топик, у которого не было подписчика.
      showStatus(`windows11-manager не ответил: ${e.message}`);
    }
  }
```

Добавить `managerPort` в `config.example.yml` с комментарием и умолчанием `9722`.

- [ ] **Step 6: Прогнать тесты фронтенда**

```bash
cd /home/popstas/projects/js/ccfzf-picker && npm test 2>&1 | tail -10
```

Ожидается: PASS целиком.

- [ ] **Step 7: Коммит**

```bash
cd /home/popstas/projects/js/ccfzf-picker
git add frontend-src/open-transport.js test/open-transport.test.js sessions.html config.example.yml
git commit -m "feat(picker): на хосте с трекером сессию открывает windows11-manager

Собранная здесь команда wt.exe теряет профиль проекта — маппинг
claudeWt.projects знает только менеджер."
```

---

### Task 11: Действие «открыть на машине трекера»

**Репозиторий:** `ccfzf-picker`

**Files:**
- Modify: `src-tauri/src/mqtt.rs` (топик и команда), `sessions.html` (пункт в меню `Ctrl+K`)
- Test: `src-tauri/src/mqtt.rs` (тест топика рядом с существующими, около строки 183)

**Interfaces:**
- Consumes: `claude-session-open` в роутере менеджера (Task 4) — тело `{"id": …, "action": "terminal"}`.
- Produces: команда Tauri `open_session_mqtt(id: String)`.

- [ ] **Step 1: Написать падающий тест на топик**

В `src-tauri/src/mqtt.rs`, рядом с существующими тестами топиков (около строки 183), добавить:

```rust
    #[test]
    fn open_topic_is_under_windows() {
        let broker = test_broker();
        assert_eq!(
            topic_of(&broker, OPEN_TOPIC),
            "home/room/pc/windows/claude-session-open"
        );
    }
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
cd /home/popstas/projects/js/ccfzf-picker/src-tauri && . "$HOME/.cargo/env" && cargo test 2>&1 | tail -10
```

Ожидается: FAIL — `cannot find value OPEN_TOPIC in this scope`.

- [ ] **Step 3: Добавить константу и команду**

В `src-tauri/src/mqtt.rs` рядом с `FOCUS_TOPIC` / `UNREAD_TOPIC` / `RESTORE_TOPIC` (строки 25-27):

```rust
/// Просьба к windows11-manager открыть сессию у себя. Отличается от
/// `FOCUS_TOPIC` тем, что окна может не быть вовсе: менеджер тогда поднимет
/// терминал с нужным профилем.
const OPEN_TOPIC: &str = "/windows/claude-session-open";
```

и публикующую функцию по образцу соседних, с телом `{"id": id, "action": "terminal"}`. В `src-tauri/src/main.rs` добавить команду `open_session_mqtt` рядом с `restore_snapshot_mqtt` и зарегистрировать её в `invoke_handler`.

- [ ] **Step 4: Убедиться, что тест проходит**

```bash
cd /home/popstas/projects/js/ccfzf-picker/src-tauri && . "$HOME/.cargo/env" && cargo test 2>&1 | tail -10
```

Ожидается: PASS.

- [ ] **Step 5: Добавить пункт меню**

В `sessions.html`, в сборку меню `Ctrl+K`, добавить пункт рядом с остальными:

```js
    // Трекер существует, но он на другой машине: отсюда можно попросить его
    // поднять сессию у себя. На своём хосте пункт лишний — там это делает
    // обычный Enter.
    if (lastState && lastState.windowHost
        && window.OpenTransport.chooseOpenTransport(lastState, CONFIG.windowHost) === 'local') {
      items.push({
        label: `Open on ${lastState.windowHost}`,
        run: () => invoke('open_session_mqtt', { id: row.id }),
      });
    }
```

Имя переменной `items` и форму пункта (`label` / `run`) подогнать под то, как меню собирается в этом файле — сверить с соседними пунктами, например с `Open PR #<num>`.

- [ ] **Step 6: Прогнать оба набора тестов**

```bash
cd /home/popstas/projects/js/ccfzf-picker && npm test 2>&1 | tail -5
cd src-tauri && . "$HOME/.cargo/env" && cargo test 2>&1 | tail -5
```

Ожидается: PASS в обоих.

- [ ] **Step 7: Коммит**

```bash
cd /home/popstas/projects/js/ccfzf-picker
git add -A
git commit -m "feat(picker): пункт «открыть на машине трекера» через MQTT"
```

---

### Task 12: Уборка мёртвого кода и обновление карты

**Репозиторий:** `windows11-manager`

**Files:**
- Modify: `src/claude-wt/ha/session-groups.js` и его тест (удалить функции старого пикера), `.claude/skills/claude-wt/SKILL.md`, `AGENTS.md`, `docs/TODO.md`

- [ ] **Step 1: Убрать функции старого пикера**

Из `src/claude-wt/ha/session-groups.js` удалить `buildSessionsPayload`, `groupSessions`, `sortGroupSessions`, `cycleSort` и убрать их из `export`. Из `src/claude-wt/ha/session-groups.test.js` удалить блоки, которые их проверяют.

Проверить, что удалённое действительно никому не нужно:

```bash
cd /home/popstas/projects/js/windows11-manager
rg -n 'buildSessionsPayload|groupSessions|sortGroupSessions|cycleSort' src/ || echo "не используется"
```

- [ ] **Step 2: Прогнать все тесты**

```bash
cd /home/popstas/projects/js/windows11-manager && npm test
```

Ожидается: PASS целиком.

- [ ] **Step 3: Обновить карту скилла**

В `.claude/skills/claude-wt/SKILL.md`:

- В таблице «Кто где живёт» строку «Приложение — `D:/projects/js/windows-mqtt` — пикер, MQTT, экспорт в Home Assistant» заменить: пикер — `ccfzf-picker`, MQTT и экспорт — `windows11-manager`, `src/mqtt/` и `src/claude-wt/ha/`.
- Абзац «Project hotkeys» переписать: список берёт `ccfzf-picker`, а не Rust в windows-mqtt.
- Раздел «Деплой после правок» — `deploy-fast` / `deploy-local` относятся только к windows-mqtt, которого в цепочке больше нет; заменить на порядок выкатки менеджера и пикера.
- В «Частые ошибки» строку про `deploy-local` оставить, добавить строку: «Отметка «непросмотрено» из пикера не действует — проверить, что менеджер подписан на `claude-session-unread`: до переезда подписки не было вовсе».

В `AGENTS.md` в разделе про claude-wt поправить упоминание `windows-mqtt` и добавить `src/mqtt/` в перечень модулей.

- [ ] **Step 4: Коммит**

```bash
cd /home/popstas/projects/js/windows11-manager
git add -A
git commit -m "docs(claude-wt): карта связки после переезда MQTT в менеджер"
```

Пункт в `docs/TODO.md` здесь **не** отмечается: работа не закончена, пока в windows-mqtt жив `windows.js` (Task 13).

---

### Task 13: Снос оконной части windows-mqtt

**Репозиторий:** `windows-mqtt`

**Делается только после того, как ручной чеклист ниже пройден целиком на живой машине.** До этого момента `windows.js` — единственный путь отката.

**Files:**
- Delete: `src/modules/windows.js`, `src/homeassistant/`, `src/picker/`, `src/modules/claude-wt-watchdog.js`, `src/modules/delayed-slot-off.js` и их тесты
- Modify: `src/modules/obs.js`, `src/modules/index.js`, `package.json`, `src-tauri/src/main.rs`

- [ ] **Step 1: Отвязать obs.js**

В `src/modules/obs.js` убрать строку 1 (`const winMan = require('windows11-manager');`) и заменить проверку в `connect()` (строки 23-25):

```js
  const {execFile} = require('child_process');

  /** Есть ли OBS в списке процессов. Раньше здесь искалось окно через
   *  windows11-manager — ради одной проверки держать зависимость на весь
   *  менеджер незачем. */
  function obsRunning() {
    return new Promise((resolve) => {
      execFile('tasklist', ['/FI', 'IMAGENAME eq obs64.exe', '/NH'], (err, stdout) => {
        resolve(!err && /obs64\.exe/i.test(stdout));
      });
    });
  }

  async function connect() {
    if (!(await obsRunning())) return; // не подключаться, когда OBS не запущен
    try {
```

- [ ] **Step 2: Удалить оконную часть**

```bash
cd /home/popstas/projects/js/windows-mqtt
git rm -r src/modules/windows.js src/homeassistant src/picker
git rm src/modules/claude-wt-watchdog.js src/modules/delayed-slot-off.js
git rm test/homeassistant-api.test.js test/homeassistant-discovery.test.js \
       test/session-slots.test.js test/picker-session-groups.test.js \
       test/restore-payload.test.js test/delayed-slot-off.test.js \
       test/claude-focus-subscription.test.js test/claude-wt-watchdog.test.js \
       test/picker-action-consistency.test.js test/picker-filter.test.js \
       test/picker-list-sync.test.js test/picker-snapshots.test.js \
       test/picker-toggles-parity.test.js test/session-glyph.test.js \
       test/session-info.test.js test/session-menu-info-lookup.test.js \
       test/session-open-helpers.test.js test/sessions-sort-config.test.js \
       test/claude-project-helpers.test.js test/pr-url-parity.test.js
```

`src/modules/press-throttle.js` **не удалять**: его использует `keys/press-throttled`, который никуда не едет.

В `src/modules/index.js` убрать ветвление по флагу из Task 9 — остаётся только `power`. Флаг `windows.enabled` из `config.example.yml` тоже убрать: откатывать больше нечего.

- [ ] **Step 3: Убрать проектные хоткеи из Rust**

В `src-tauri/src/main.rs` удалить функцию, зовущую `claudeWtProjects()` (около строк 768-782), её вызывателя и регистрацию проектных хоткеев — их теперь регистрирует `ccfzf-picker`.

- [ ] **Step 4: Убрать зависимость**

```bash
cd /home/popstas/projects/js/windows-mqtt
npm pkg delete dependencies.windows11-manager
npm install
```

- [ ] **Step 5: Проверить, что развязано**

```bash
cd /home/popstas/projects/js/windows-mqtt
rg -n 'winMan|windows11-manager' src/ src-tauri/src/ || echo "развязано"
node --test test/**/*.test.js 2>&1 | tail -10
. "$HOME/.cargo/env" && cd src-tauri && cargo build 2>&1 | tail -5
```

Ожидается: `rg` находит упоминания только в комментариях (либо не находит вовсе); тесты проходят; `cargo build` — `Finished`. Это и есть критерий готовности из спеки.

- [ ] **Step 6: Коммит**

```bash
cd /home/popstas/projects/js/windows-mqtt
git add -A
git commit -m "refactor: оконная часть удалена, зависимость от windows11-manager снята

Остаётся питание машины и модули, не связанные с окнами. obs.js ищет процесс
obs64.exe вместо окна через менеджер."
```

- [ ] **Step 7: Отметить пункт TODO**

Теперь работа закончена. В `/home/popstas/projects/js/windows11-manager/docs/TODO.md` отметить `[x]` пункт про распределение функций по проектам, оставив в `# future` два оставшихся, и закоммитить:

```bash
cd /home/popstas/projects/js/windows11-manager
git add docs/TODO.md
git commit -m "task: переезд управления окнами завершён"
```

---

## Ручная проверка на Windows

Выполняется после того, как все три репозитория собраны и установлены, **до** переключения флага и после него.

- [ ] Поставить новое рядом со старым; убедиться, что `windows.enabled` в windows-mqtt ещё `true`, а служба `node src/index.js mqtt` не запущена. Ничего не должно измениться.
- [ ] Погасить модуль (`windows.enabled: false`), перезапустить windows-mqtt, запустить службу менеджера из трея.
- [ ] Плата openHASP: нажатие на строку поднимает окно нужной сессии; после нажатия плитка гаснет и не залипает; строки обновляются раз в 15 с.
- [ ] Home Assistant: сущности `switch.claude_wt_session_N` доступны, атрибут `summary` непустой, нажатие в интерфейсе переводит фокус.
- [ ] Retained-конфиги от старого приложения переехали сами, а не удвоились. Проверить, что в `/api/states` нет вторых сущностей рядом с прежними: `object_id` не менялся, менялась только подпись производителя. Если дубли всё же появились — стереть старые пустой нагрузкой в топики `homeassistant/switch/claude_wt/slot_N/config` (пустой payload удаляет сущность; для этого в `discovery.js` есть `removalMessages`).
- [ ] `ccfzf-picker` с Windows-машины: Enter открывает сессию с правильным профилем Windows Terminal; отметка «непросмотрено» перекрашивает кружок (до переезда она не работала вовсе); восстановление снимка работает.
- [ ] `ccfzf-picker` с macOS: Enter по-прежнему открывает локальный терминал; в `Ctrl+K` появился пункт «открыть на машине трекера» и он поднимает окно на Windows.
- [ ] Раскладка: `autoplace`, `place`, `store`, `restore`, `clear` через MQTT.
- [ ] Питание: `restart_restore` сохраняет раскладку до перезагрузки — проверить, что после возврата окна на местах.
- [ ] Трей менеджера показывает `MQTT: running`; в логе node-процесса есть строка `MQTT connected`.

**Откат:** вернуть `windows.enabled: true` в windows-mqtt и остановить службу менеджера. Откатывать релизы не нужно.
