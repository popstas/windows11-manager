# Claude-wt Daemon Liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать видимой поломку, из-за которой демон claude-wt перестал обновлять `claude-wt.json`, и не дать списку сессий молча оставаться сломанным.

**Architecture:** Демон в `windows11-manager` копит в памяти три счётчика (`lastTickAt`, `tickFailures`, `lastTickError`) и отдаёт их из `claudeWtStatus()`. Приложение `windows-mqtt` раз в 30 секунд спрашивает статус, отдаёт его в `claudeWtHealth()` из библиотеки и при болезни пишет диагноз через `log()` и поднимает демона заново. Параллельно `console.*` в windows-mqtt перестаёт теряться мимо файлового лога.

**Tech Stack:** windows11-manager — ESM, vitest (`npm test`). windows-mqtt — CommonJS, `node --test` (`npm test`), деплой в установленное приложение через `npm run deploy-fast`.

## Global Constraints

- Спека: `docs/specs/2026-08-03-claude-wt-state-write-design.md`.
- Период проверки сторожа — 30 с; порог молчания — 60 с; грейс после старта — 60 с; кулдаун перезапуска — 5 мин.
- Счётчики живут только в памяти процесса: ни одной записи на диск и ни одного обращения к `V:` ради них.
- Бюджет опроса демона не трогаем: в тик не добавляется ни `getWindows()`, ни чтений с сетевого диска.
- Логика решений — чистые функции в `daemon-helpers.js` («Pure helper functions for the claude-wt daemon. No external I/O.»); `index.js` остаётся тонким.
- Комментарии в обоих репозиториях — по-русски, в тон существующим: объясняют «почему», а не «что».
- Причину поломки этот план не чинит. Он её показывает.

---

## File Structure

**windows11-manager (ESM, vitest):**
- Modify: `src/claude-wt/daemon-helpers.js` — чистые `emptyTickStats`, `recordTick`, `claudeWtHealth`.
- Modify: `src/claude-wt/daemon-helpers.test.js` — тесты к ним.
- Modify: `src/claude-wt/index.js` — модульные переменные, учёт в обёртке тика, новые поля в `claudeWtStatus()`.

**windows-mqtt (CommonJS, node --test):**
- Create: `src/log-reentry.js` — счётчик повторного входа, чтобы строка не попала в файл дважды.
- Create: `test/log-reentry.test.js`.
- Modify: `src/helpers.js` — `log()` пишет под защитой, новый экспорт `logConsoleLine`.
- Modify: `src/index.js` — `stderrWrite` дублирует строку в файловый лог.
- Create: `src/modules/claude-wt-watchdog.js` — сторож без I/O, все зависимости инъекцией.
- Create: `test/claude-wt-watchdog.test.js`.
- Modify: `src/modules/windows.js` — завести и погасить интервал сторожа.

---

### Task 1: Чистые функции живости в библиотеке

**Files:**
- Modify: `src/claude-wt/daemon-helpers.js`
- Test: `src/claude-wt/daemon-helpers.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `emptyTickStats(): { lastTickAt: number, tickFailures: number, lastTickError: string }`
  - `recordTick(stats, { ok: boolean, error?: string, nowMs: number }): { lastTickAt, tickFailures, lastTickError }`
  - `claudeWtHealth({ running: boolean, lastTickAt: number, startedAt: number, nowMs: number, silenceMs: number, graceMs: number }): { healthy: boolean, reason: string, ageMs: number }`
  - Константы `TICK_SILENCE_MS = 60000`, `TICK_GRACE_MS = 60000`.
  - `reason` принимает ровно одно из: `'not running'`, `'starting'`, `'no ticks'`, `'stale'`, `'ok'`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в конец `src/claude-wt/daemon-helpers.test.js`:

```js
describe('recordTick', () => {
  it('успех двигает отметку и обнуляет счётчик неудач', () => {
    const before = { lastTickAt: 100, tickFailures: 3, lastTickError: 'boom' };
    expect(recordTick(before, { ok: true, nowMs: 500 })).toEqual({
      lastTickAt: 500, tickFailures: 0, lastTickError: '',
    });
  });

  it('неудача копит счётчик и не двигает отметку', () => {
    const before = { lastTickAt: 100, tickFailures: 1, lastTickError: '' };
    expect(recordTick(before, { ok: false, error: 'EBUSY', nowMs: 500 })).toEqual({
      lastTickAt: 100, tickFailures: 2, lastTickError: 'EBUSY',
    });
  });

  it('неудача без текста ошибки не роняет вызов', () => {
    const before = emptyTickStats();
    expect(recordTick(before, { ok: false, nowMs: 500 }).lastTickError).toBe('unknown error');
  });
});

describe('claudeWtHealth', () => {
  const base = { startedAt: 0, nowMs: 100000, silenceMs: 60000, graceMs: 60000 };

  it('не запущен — болен', () => {
    const h = claudeWtHealth({ ...base, running: false, lastTickAt: 99000 });
    expect(h.healthy).toBe(false);
    expect(h.reason).toBe('not running');
  });

  it('тиков ещё не было, грейс не вышел — здоров', () => {
    const h = claudeWtHealth({ ...base, running: true, lastTickAt: 0, startedAt: 70000 });
    expect(h.healthy).toBe(true);
    expect(h.reason).toBe('starting');
  });

  it('грейс вышел, тиков нет — болен', () => {
    const h = claudeWtHealth({ ...base, running: true, lastTickAt: 0, startedAt: 10000 });
    expect(h.healthy).toBe(false);
    expect(h.reason).toBe('no ticks');
    expect(h.ageMs).toBe(90000);
  });

  it('свежий тик — здоров', () => {
    const h = claudeWtHealth({ ...base, running: true, lastTickAt: 99000 });
    expect(h.healthy).toBe(true);
    expect(h.reason).toBe('ok');
    expect(h.ageMs).toBe(1000);
  });

  it('тик старше порога — болен', () => {
    const h = claudeWtHealth({ ...base, running: true, lastTickAt: 30000 });
    expect(h.healthy).toBe(false);
    expect(h.reason).toBe('stale');
    expect(h.ageMs).toBe(70000);
  });
});
```

Добавить новые имена в блок импорта в начале файла:

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
} from './daemon-helpers.js';
```

- [ ] **Step 2: Запустить тесты и убедиться, что падают**

Run: `npm test -- daemon-helpers`
Expected: FAIL — `emptyTickStats is not a function`.

- [ ] **Step 3: Реализовать функции**

Дописать в `src/claude-wt/daemon-helpers.js` перед блоком `export`:

```js
// Минута молчания при тике раз в секунду — это не флуктуация, а поломка.
const TICK_SILENCE_MS = 60000;
// Столько демону дают на первый успешный тик после старта: maybeRestoreOnStart()
// и первый разбор дампа с сетевого диска занимают заметно больше одного тика.
const TICK_GRACE_MS = 60000;

function emptyTickStats() {
  return { lastTickAt: 0, tickFailures: 0, lastTickError: '' };
}

/**
 * Учёт одного тика.
 *
 * Отметка времени двигается только на успехе — то есть когда тик дошёл до
 * записи состояния. Упавший тик её не трогает: иначе демон, падающий каждую
 * секунду, выглядел бы здоровее всех.
 */
function recordTick(stats, { ok, error, nowMs }) {
  if (ok) return { lastTickAt: nowMs, tickFailures: 0, lastTickError: '' };
  return {
    lastTickAt: stats.lastTickAt,
    tickFailures: stats.tickFailures + 1,
    lastTickError: error || 'unknown error',
  };
}

/**
 * Здоров ли демон, по данным, которые он о себе отдаёт.
 *
 * Различает три беды, и это существенно: «интервал не заведён» лечится
 * перезапуском, «тиков не было ни одного» указывает на падение в первом же
 * проходе, «тики были, но давно» — на то, что что-то сломалось по дороге.
 */
function claudeWtHealth({ running, lastTickAt, startedAt, nowMs, silenceMs, graceMs }) {
  if (!running) return { healthy: false, reason: 'not running', ageMs: nowMs - startedAt };
  if (!lastTickAt) {
    const ageMs = nowMs - startedAt;
    return ageMs < graceMs
      ? { healthy: true, reason: 'starting', ageMs }
      : { healthy: false, reason: 'no ticks', ageMs };
  }
  const ageMs = nowMs - lastTickAt;
  return ageMs > silenceMs
    ? { healthy: false, reason: 'stale', ageMs }
    : { healthy: true, reason: 'ok', ageMs };
}
```

Дописать имена в существующий блок `export`:

```js
export {
  CLAUDE_WT_DEFAULTS,
  TICK_SILENCE_MS,
  TICK_GRACE_MS,
  mergeClaudeWtConfig,
  isTerminalPath,
  desktopOnlyActions,
  layoutFingerprint,
  focusedSessionIds,
  unresolvedTitles,
  emptyTickStats,
  recordTick,
  claudeWtHealth,
};
```

- [ ] **Step 4: Запустить тесты и убедиться, что проходят**

Run: `npm test -- daemon-helpers`
Expected: PASS, все существующие тесты файла тоже зелёные.

- [ ] **Step 5: Коммит**

```bash
git add src/claude-wt/daemon-helpers.js src/claude-wt/daemon-helpers.test.js
git commit -m "feat(claude-wt): чистые функции живости демона"
```

---

### Task 2: Демон считает свои тики и отдаёт статистику

**Files:**
- Modify: `src/claude-wt/index.js`
- Test: ручная проверка через CLI (чистая логика уже покрыта в Task 1)

**Interfaces:**
- Consumes: `emptyTickStats`, `recordTick` из Task 1.
- Produces: `claudeWtStatus()` дополнительно возвращает `startedAt: number`, `lastTickAt: number`, `tickFailures: number`, `lastTickError: string`. Все — эпоха в миллисекундах, `0` означает «ещё не было».

- [ ] **Step 1: Завести переменные и учёт**

В `src/claude-wt/index.js` дописать импорт `emptyTickStats` и `recordTick` в существующий блок из `./daemon-helpers.js`:

```js
import {
  mergeClaudeWtConfig,
  isTerminalPath,
  desktopOnlyActions,
  layoutFingerprint,
  focusedSessionIds,
  unresolvedTitles,
  emptyTickStats,
  recordTick,
} from './daemon-helpers.js';
```

Рядом с существующими `let intervalId = null; let prevWindows = []; …` добавить:

```js
// Счётчики живости. Только в памяти: сторож в windows-mqtt спрашивает их через
// claudeWtStatus(), на диск они не едут и лишнего обращения к V: не стоят.
let tickStats = emptyTickStats();
let startedAt = 0;
```

- [ ] **Step 2: Учитывать исход каждого тика**

Заменить в `startClaudeWt()` установку интервала:

```js
  intervalId = setInterval(() => {
    claudeWtTick().catch(e => console.error(`[claude-wt] tick failed: ${e.message}`));
  }, cfg.interval);
```

на:

```js
  intervalId = setInterval(() => {
    claudeWtTick().then(
      () => { tickStats = recordTick(tickStats, { ok: true, nowMs: Date.now() }); },
      e => {
        tickStats = recordTick(tickStats, { ok: false, error: e.message, nowMs: Date.now() });
        console.error(`[claude-wt] tick failed: ${e.message}`);
      },
    );
  }, cfg.interval);
```

- [ ] **Step 3: Сбрасывать статистику на старте и остановке**

В `startClaudeWt()` рядом с существующими сбросами (`liveState = null; prevWindows = []; lastWritten = ''; …`) добавить:

```js
  tickStats = emptyTickStats();
  startedAt = Date.now();
```

В `stopClaudeWt()` внутри `if (intervalId !== null) { … }` добавить:

```js
    // Иначе после перезапуска сторож увидит чужую статистику и решит, что
    // свежий демон болен ещё до первого своего тика.
    tickStats = emptyTickStats();
    startedAt = 0;
```

- [ ] **Step 4: Отдать статистику из статуса**

В `claudeWtStatus()` дополнить возвращаемый объект:

```js
  return {
    running: intervalId !== null,
    startedAt,
    lastTickAt: tickStats.lastTickAt,
    tickFailures: tickStats.tickFailures,
    lastTickError: tickStats.lastTickError,
    slots: Object.entries(state.slots).map(([id, slot]) => ({
      id, title: slot.titles[0], bounds: slot.bounds, desktop: slot.desktop, lastSeen: slot.lastSeen,
    })),
    lastLayout: state.lastLayout,
    statePath: cfg.statePath,
    sessionsFile: cfg.sessionsFile,
  };
```

- [ ] **Step 5: Вывести диагноз и пороги наружу**

`src/lib/index.js` (точка входа пакета, `main`) делает `export * from '../claude-wt/index.js'`, а тот реэкспортирует из хелперов ровно одно имя. Без правки `winMan.claudeWtHealth` в Task 5 будет `undefined`.

Заменить в конце `src/claude-wt/index.js`:

```js
export { CLAUDE_WT_DEFAULTS } from './daemon-helpers.js';
```

на:

```js
// Наружу, а не только внутрь: сторож в windows-mqtt принимает решение по этому
// же диагнозу и этим же порогам — иначе они разъедутся в двух репозиториях.
export {
  CLAUDE_WT_DEFAULTS,
  TICK_SILENCE_MS,
  TICK_GRACE_MS,
  claudeWtHealth,
} from './daemon-helpers.js';
```

- [ ] **Step 6: Проверить на живом демоне**

Run: `node src/index.js claude-wt status`
Expected: в JSON появились `startedAt: 0`, `lastTickAt: 0`, `tickFailures: 0`, `lastTickError: ""` — CLI-статус не запускает watcher, поэтому нули здесь правильные.

Run: `node -e "import('./src/lib/index.js').then(m => console.log(['claudeWtHealth','TICK_SILENCE_MS','TICK_GRACE_MS','claudeWtStatus'].map(k => k + '=' + typeof m[k]).join(' ')))"`
Expected: `claudeWtHealth=function TICK_SILENCE_MS=number TICK_GRACE_MS=number claudeWtStatus=function`

Run: `npm test`
Expected: PASS — весь набор тестов репозитория зелёный.

- [ ] **Step 7: Коммит**

```bash
git add src/claude-wt/index.js
git commit -m "feat(claude-wt): демон отдаёт статистику тиков"
```

---

### Task 3: console в windows-mqtt перестаёт теряться мимо файлового лога

**Files:**
- Create: `../windows-mqtt/src/log-reentry.js`
- Create: `../windows-mqtt/test/log-reentry.test.js`
- Modify: `../windows-mqtt/src/helpers.js`
- Modify: `../windows-mqtt/src/index.js`

Все пути ниже — относительно `D:/projects/js/windows-mqtt`.

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `src/log-reentry.js` → `{ enter(): void, leave(): void, isInside(): boolean, run(fn): any }`
  - `src/helpers.js` → новый экспорт `logConsoleLine(level: string, msg: any): void` рядом с существующими `log`, `getModulesEnabled`, `initModules`.

- [ ] **Step 1: Написать падающий тест на защиту от повторного входа**

Создать `test/log-reentry.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const reentry = require('../src/log-reentry');

test('снаружи вызова флаг опущен', () => {
  assert.strictEqual(reentry.isInside(), false);
});

test('внутри run() флаг поднят, после — опущен', () => {
  let inside = null;
  reentry.run(() => { inside = reentry.isInside(); });
  assert.strictEqual(inside, true);
  assert.strictEqual(reentry.isInside(), false);
});

test('вложенные вызовы не гасят флаг раньше времени', () => {
  const seen = [];
  reentry.run(() => {
    reentry.run(() => { seen.push(reentry.isInside()); });
    seen.push(reentry.isInside());
  });
  assert.deepStrictEqual(seen, [true, true]);
  assert.strictEqual(reentry.isInside(), false);
});

test('исключение внутри run() опускает флаг', () => {
  assert.throws(() => reentry.run(() => { throw new Error('boom'); }), /boom/);
  assert.strictEqual(reentry.isInside(), false);
});

test('run() возвращает значение обёрнутой функции', () => {
  assert.strictEqual(reentry.run(() => 42), 42);
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `node --test test/log-reentry.test.js`
Expected: FAIL — `Cannot find module '../src/log-reentry'`.

- [ ] **Step 3: Реализовать модуль**

Создать `src/log-reentry.js`:

```js
/** Счётчик повторного входа в файловый лог. Без I/O. */

// Одна строка не должна попасть в файл дважды. Путей в файл теперь два: log()
// пишет туда сам, и он же зовёт console, а console с этого момента тоже пишет в
// файл. Плюс rotateFile сообщает о своих сбоях через console.warn — то есть
// ошибка записи в файл способна вызвать запись в файл.
//
// Счётчик, а не флаг: вложенность здесь настоящая, и внутренний вызов не должен
// снимать защиту, поставленную внешним.
let depth = 0;

function enter() { depth += 1; }
function leave() { depth = Math.max(0, depth - 1); }
function isInside() { return depth > 0; }

/** Выполнить fn под защитой, опустив счётчик даже при исключении. */
function run(fn) {
  enter();
  try {
    return fn();
  } finally {
    leave();
  }
}

module.exports = { enter, leave, isInside, run };
```

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

Run: `node --test test/log-reentry.test.js`
Expected: PASS, все пять проверок.

- [ ] **Step 5: Подключить защиту в helpers.js**

В `src/helpers.js` добавить к импортам в начале файла:

```js
const reentry = require('./log-reentry');
```

Заменить тело `if (messageLogLevel >= currentLogLevel) { … }` внутри `log()`:

```js
  if (messageLogLevel >= currentLogLevel) {
    const tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
    // Compute the instant once so console and file timestamps can't drift.
    const local = new Date(Date.now() - tzoffset).toISOString();
    const d = local.
    replace(/T/, ' ').      // replace T with a space
      replace(/\..+/, '')     // delete the dot and everything after

    // Под защитой целиком: console отсюда уходит в stderrWrite, который теперь
    // тоже пишет в файл, а writeToLogFile при сбое ротации зовёт console.warn.
    reentry.run(() => {
      console[logLevel](`${d} ${msg}`);
      // Full timestamp with ms + level tag on disk for crash forensics.
      const fileTs = local.replace(/T/, ' ').replace(/Z$/, '');
      writeToLogFile(`${fileTs} [${logLevel}] ${stringifyMsg(msg)}`);
    });
  }
```

Добавить рядом с `log()` новую функцию:

```js
/**
 * Строка, пришедшая из console мимо log(), — в файловый лог.
 *
 * Console в bridge-режиме переопределён на запись в stderr, откуда её забирает
 * Rust и показывает в server-log окна приложения. В файл она не попадала
 * никогда, и `[claude-wt] tick failed: …` вместе со всей диагностикой
 * библиотеки терялась вместе с закрытым окном.
 */
function logConsoleLine(level, msg) {
  if (reentry.isInside()) return;
  reentry.run(() => {
    const tzoffset = (new Date()).getTimezoneOffset() * 60000;
    const local = new Date(Date.now() - tzoffset).toISOString();
    const fileTs = local.replace(/T/, ' ').replace(/Z$/, '');
    writeToLogFile(`${fileTs} [${level}] ${stringifyMsg(msg)}`);
  });
}
```

Дополнить экспорт:

```js
module.exports = {
  log,
  logConsoleLine,
  getModulesEnabled,
  initModules,
};
```

- [ ] **Step 6: Подключить в index.js**

В `src/index.js` заменить `stderrWrite`:

```js
  const stderrWrite = (level) => (...args) => {
    try {
      process.stderr.write(tagLines(level, args.join(' ')) + '\n');
    } catch {}
  };
```

на:

```js
  const stderrWrite = (level) => (...args) => {
    const text = args.join(' ');
    try {
      process.stderr.write(tagLines(level, text) + '\n');
    } catch {}
    // Ленивый require: console переопределяется до загрузки конфига, а helpers
    // тянет его за собой. Первая же строка после старта конфиг уже застанет.
    try {
      require('./helpers').logConsoleLine(level, text);
    } catch {}
  };
```

- [ ] **Step 7: Прогнать весь набор тестов**

Run: `npm test`
Expected: PASS — включая существующие `test/log-rotate.test.js` и `test/log-tag.test.js`.

- [ ] **Step 8: Коммит**

```bash
git add src/log-reentry.js test/log-reentry.test.js src/helpers.js src/index.js
git commit -m "feat(log): console из библиотеки доезжает до файлового лога"
```

---

### Task 4: Сторож как отдельный модуль

**Files:**
- Create: `../windows-mqtt/src/modules/claude-wt-watchdog.js`
- Create: `../windows-mqtt/test/claude-wt-watchdog.test.js`

**Interfaces:**
- Consumes: `claudeWtHealth` из Task 1 (через `winMan`), `claudeWtStatus` из Task 2.
- Produces: `createClaudeWtWatchdog({ status, health, restart, log, now?, silenceMs?, graceMs?, cooldownMs? }): () => boolean` — возвращает функцию проверки; она отдаёт `true`, если демон был поднят на этом вызове.
- Константы модуля: `CHECK_INTERVAL_MS = 30000`, `RESTART_COOLDOWN_MS = 300000`.

- [ ] **Step 1: Написать падающий тест**

Создать `test/claude-wt-watchdog.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  createClaudeWtWatchdog,
  CHECK_INTERVAL_MS,
  RESTART_COOLDOWN_MS,
} = require('../src/modules/claude-wt-watchdog');

function harness({ healthy, reason = 'stale', ageMs = 70000 }) {
  const logs = [];
  let restarts = 0;
  let now = 1000000;
  const check = createClaudeWtWatchdog({
    status: () => ({
      running: true, startedAt: 0, lastTickAt: 1, tickFailures: 7, lastTickError: 'EBUSY',
    }),
    health: () => ({ healthy, reason, ageMs }),
    restart: () => { restarts += 1; },
    log: (msg) => { logs.push(msg); },
    now: () => now,
  });
  return {
    check,
    logs,
    restarts: () => restarts,
    advance: (ms) => { now += ms; },
  };
}

test('здоровый демон не даёт ни строки, ни перезапуска', () => {
  const h = harness({ healthy: true, reason: 'ok', ageMs: 500 });
  assert.strictEqual(h.check(), false);
  assert.deepStrictEqual(h.logs, []);
  assert.strictEqual(h.restarts(), 0);
});

test('больной демон логируется и поднимается', () => {
  const h = harness({ healthy: false });
  assert.strictEqual(h.check(), true);
  assert.strictEqual(h.restarts(), 1);
  assert.ok(h.logs.some(m => m.includes('stale')));
  assert.ok(h.logs.some(m => m.includes('EBUSY')));
  assert.ok(h.logs.some(m => m.includes('7')));
});

test('внутри кулдауна демон не поднимается, но диагноз пишется каждый раз', () => {
  const h = harness({ healthy: false });
  h.check();
  const afterFirst = h.logs.length;
  h.advance(CHECK_INTERVAL_MS);
  assert.strictEqual(h.check(), false);
  assert.strictEqual(h.restarts(), 1);
  assert.ok(h.logs.length > afterFirst);
});

test('после кулдауна демон поднимается снова', () => {
  const h = harness({ healthy: false });
  h.check();
  h.advance(RESTART_COOLDOWN_MS + 1);
  assert.strictEqual(h.check(), true);
  assert.strictEqual(h.restarts(), 2);
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `node --test test/claude-wt-watchdog.test.js`
Expected: FAIL — `Cannot find module '../src/modules/claude-wt-watchdog'`.

- [ ] **Step 3: Реализовать модуль**

Создать `src/modules/claude-wt-watchdog.js`:

```js
/** Сторож демона claude-wt. Без I/O: статус, диагноз, подъём и часы — снаружи. */

// Полминуты: при пороге молчания в минуту это две проверки на порог, то есть
// поломку замечают быстрее, чем она успевает надоесть, и не чаще, чем нужно.
const CHECK_INTERVAL_MS = 30000;
// Неустранимая поломка не должна превратить лог в поток перезапусков. Диагноз
// при этом пишется каждую проверку — по частоте строк видно, что беда не ушла.
const RESTART_COOLDOWN_MS = 300000;

/**
 * Проверка живости демона.
 *
 * Решение о болезни принимает библиотека (`claudeWtHealth`), здесь только
 * реакция: сказать и поднять. Разделение не косметическое — пороги и смысл
 * «болен» живут там же, где счётчики, а приложение владеет логом и жизненным
 * циклом.
 */
function createClaudeWtWatchdog({
  status,
  health,
  restart,
  log,
  now = Date.now,
  silenceMs,
  graceMs,
  cooldownMs = RESTART_COOLDOWN_MS,
}) {
  // -Infinity, а не 0: с нулём первый же подъём после старта процесса попал бы
  // в кулдаун только при подставных часах в тестах, и тест лгал бы.
  let lastRestartAt = -Infinity;

  return function check() {
    const s = status();
    const nowMs = now();
    const h = health({
      running: s.running,
      lastTickAt: s.lastTickAt,
      startedAt: s.startedAt,
      nowMs,
      silenceMs,
      graceMs,
    });
    if (h.healthy) return false;

    const ageSec = Math.round((h.ageMs ?? 0) / 1000);
    log(`claude-wt: демон нездоров (${h.reason}), последний тик ${ageSec}s назад, `
      + `падений подряд ${s.tickFailures}, последняя ошибка: ${s.lastTickError || '—'}`, 'warn');

    if (nowMs - lastRestartAt < cooldownMs) return false;
    lastRestartAt = nowMs;
    log('claude-wt: поднимаю демона заново', 'warn');
    restart();
    return true;
  };
}

module.exports = { createClaudeWtWatchdog, CHECK_INTERVAL_MS, RESTART_COOLDOWN_MS };
```

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

Run: `node --test test/claude-wt-watchdog.test.js`
Expected: PASS, все четыре проверки.

- [ ] **Step 5: Коммит**

```bash
git add src/modules/claude-wt-watchdog.js test/claude-wt-watchdog.test.js
git commit -m "feat(claude-wt): сторож живости демона"
```

---

### Task 5: Подключить сторож и проверить на живой машине

**Files:**
- Modify: `../windows-mqtt/src/modules/windows.js`

**Interfaces:**
- Consumes: `createClaudeWtWatchdog`, `CHECK_INTERVAL_MS` из Task 4; `winMan.claudeWtStatus`, `winMan.claudeWtHealth`, `winMan.startClaudeWt`; `TICK_SILENCE_MS`, `TICK_GRACE_MS` из Task 1.
- Produces: ничего для последующих задач.

- [ ] **Step 1: Завести сторожа**

В `src/modules/windows.js` добавить к импортам рядом с `const {throttlePress} = require('./press-throttle');`:

```js
const {createClaudeWtWatchdog, CHECK_INTERVAL_MS} = require('./claude-wt-watchdog');
```

Рядом с `let statsIntervalId = null; let restoreTimeoutId = null;` добавить:

```js
  let claudeWtWatchdogId = null;
```

Заменить блок запуска демона:

```js
  if (config.claudeWt) {
    winMan.startClaudeWt();
  }
```

на:

```js
  if (config.claudeWt) {
    winMan.startClaudeWt();
    // Сторож рядом со стартом, а не в onStart(): onStart в этой кодовой базе
    // никто не вызывает, и повешенный туда сторож никогда бы не завёлся.
    const check = createClaudeWtWatchdog({
      status: () => winMan.claudeWtStatus(),
      health: (args) => winMan.claudeWtHealth(args),
      restart: () => winMan.startClaudeWt(),
      log,
      silenceMs: winMan.TICK_SILENCE_MS,
      graceMs: winMan.TICK_GRACE_MS,
    });
    claudeWtWatchdogId = setInterval(check, CHECK_INTERVAL_MS);
  }
```

- [ ] **Step 2: Гасить сторожа вместе с демоном**

В `onStop()` заменить строку `if (config.claudeWt) winMan.stopClaudeWt();` на:

```js
    if (claudeWtWatchdogId !== null) {
      clearInterval(claudeWtWatchdogId);
      claudeWtWatchdogId = null;
    }
    if (config.claudeWt) winMan.stopClaudeWt();
```

- [ ] **Step 3: Убедиться, что библиотека отдаёт нужные имена**

Пакет подключён как `file:../windows11-manager`, реэкспорт сделан в Task 2 Step 5.

Run: `node -e "import('windows11-manager').then(m => console.log(['claudeWtHealth','TICK_SILENCE_MS','TICK_GRACE_MS','claudeWtStatus'].map(k => k + '=' + typeof m[k]).join(' ')))"`
Expected: `claudeWtHealth=function TICK_SILENCE_MS=number TICK_GRACE_MS=number claudeWtStatus=function`

- [ ] **Step 4: Прогнать тесты обоих репозиториев**

Run в `D:/projects/js/windows11-manager`: `npm test`
Expected: PASS

Run в `D:/projects/js/windows-mqtt`: `npm test`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add src/modules/windows.js
git commit -m "feat(claude-wt): подключить сторожа к жизненному циклу модуля"
```

- [ ] **Step 6: Деплой**

Обе правки чисто node-овые — интерфейс пикера и Rust не менялись.

Run в `D:/projects/js/windows-mqtt`: `npm run deploy-fast`
Expected: скрипт отработал и не отказался из-за UI/Rust в диффе.

- [ ] **Step 7: Перезапустить приложение и снять улику**

Перезапустить windows-mqtt, подождать минуту, затем:

Run: `grep -a "\[claude-wt\]" "C:/Users/popstas/AppData/Roaming/windows-mqtt/windows-mqtt.log" | tail -20`

Ожидаемо одно из двух, и это ответ на вопрос, ради которого всё делалось:

- есть `[claude-wt] watching every 1000ms, state: …` и нет `tick failed` — демон стартует и тикает, значит поломка была в чём-то, что перезапуск лечит;
- есть `tick failed: …` — в тексте исключения причина, и следующая задача чинит именно её.

Дополнительно:

Run: `grep -a "демон нездоров" "C:/Users/popstas/AppData/Roaming/windows-mqtt/windows-mqtt.log" | tail -5`
Expected: либо пусто (демон здоров), либо строка с `reason`, счётчиком падений и `lastTickError`.

- [ ] **Step 8: Проверить, что состояние снова живёт**

Подвинуть окно любой claude-сессии, подождать пару секунд:

Run: `ls -la "C:/Users/popstas/AppData/Local/windows11-manager/claude-wt.json"`
Expected: mtime — только что, а не 2 августа.

Run: `node src/index.js claude-wt status` в `D:/projects/js/windows11-manager`
Expected: в `slots` есть открытая сейчас сессия со свежим `lastSeen`.

- [ ] **Step 9: Записать вывод в спеку**

Дописать в `docs/specs/2026-08-03-claude-wt-state-write-design.md` раздел `## Что показал лог` с точной строкой из шага 7 — это вход для следующей задачи.

```bash
git add docs/specs/2026-08-03-claude-wt-state-write-design.md
git commit -m "docs: что показал лог демона claude-wt"
```

---

## Что осталось за планом

- Причина поломки. План её показывает, чинит — следующая задача, по тексту из шага 7 Task 5.
- Сессия `claude-statusline-todo` не появится в списке: её нет в дампе `ccfzf`, хотя транскрипт `95c01fff-1c29-45f9-9c1f-420e2d3d0898` живой. Поломка на стороне ccfzf, отдельная задача.
- Утечка памяти приложения (`heap 908.9mb` перед рестартом 15:03) — вне скоупа.
