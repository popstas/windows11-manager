# YAML Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Конфиг windows11-manager переезжает с исполняемого JS на YAML, а JS-дорога вырезается целиком.

**Architecture:** `src/config.js` теряет `require` и собирается вокруг `parse()` из пакета `yaml`; вся логика без I/O (кандидаты путей, разбор текста, правило перечитывания, сравнение двух конфигов) уезжает в новый `src/config-helpers.js` — тот же приём, которым в этом проекте уже разделены `placement`/`placement-helpers` и соседи. Две новые команды CLI (`config-dump`, `config-verify`) делают перенос живого конфига проверяемым: эквивалентность доказывается до выкатки, а не после.

**Tech Stack:** Node 20 ESM, commander, vitest, пакет `yaml` v2 (eemeli).

**Spec:** `docs/superpowers/specs/2026-08-17-yaml-config-design.md`

## Global Constraints

- Расширение конфига — только `.yaml`. Второго имени `.yml` нет нигде: у ccfzf-picker файл называется `config.yaml`, и единообразие связки — первая из целей спеки.
- Единственная новая зависимость — `yaml` v2. `js-yaml` (есть в дереве транзитивно, через eslint) не годится: не сохраняет комментарии при round-trip.
- `parse()` зовётся **только** с `{ merge: true }`. Без опции `yaml` v2 читает `<<` как обычный ключ — молча, и правило остаётся без унаследованных полей.
- Служебный ключ верхнего уровня — `x-anchors`, загрузчик его удаляет.
- Модули — ESM (`import`), как весь `src/`. Тесты лежат рядом с исходником: `src/config-helpers.test.js`.
- Комментарии и сообщения об ошибках — по-русски, как в соседних модулях `src/claude-wt/`.
- Перед каждым коммитом: `npm test` и `npx eslint <изменённые файлы>` — оба чистые.
- Файловые тесты работают через `fs.mkdtempSync(path.join(os.tmpdir(), '...'))` и убирают за собой в `afterEach` — образец в `src/claude-wt/state.test.js`.

---

### Task 1: Разбор YAML с якорями

**Files:**
- Modify: `package.json` (зависимости)
- Create: `src/config-helpers.js`
- Test: `src/config-helpers.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces: `parseConfigText(text: string, filePath?: string) => object` — разбирает YAML, раскрывает merge-ключи, удаляет `x-anchors`; бросает `Error` с номером строки на битом файле.

- [ ] **Step 1: Поставить зависимость**

```bash
npm install yaml@^2
```

- [ ] **Step 2: Написать падающий тест**

Создать `src/config-helpers.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { parseConfigText } from './config-helpers.js';

describe('parseConfigText', () => {
  it('раскрывает merge-ключ: правило получает поля якоря', () => {
    const text = [
      'x-anchors:',
      '  base: &base',
      '    desktop: 1',
      '    fancyZones: { monitor: 1, position: 3 }',
      'windows:',
      '  - <<: *base',
      '    titleMatch: Telegram',
    ].join('\n');
    expect(parseConfigText(text)).toEqual({
      windows: [{ desktop: 1, fancyZones: { monitor: 1, position: 3 }, titleMatch: 'Telegram' }],
    });
  });

  it('своё поле перебивает унаследованное', () => {
    const text = [
      'x-anchors:',
      '  base: &base',
      '    desktop: 1',
      'windows:',
      '  - <<: *base',
      '    desktop: 2',
    ].join('\n');
    expect(parseConfigText(text).windows[0].desktop).toBe(2);
  });

  it('x-anchors в выдаче нет: иначе сравнение со старым конфигом врало бы', () => {
    const text = 'x-anchors:\n  base: &base\n    a: 1\ndebug: true\n';
    expect(parseConfigText(text)).toEqual({ debug: true });
  });

  it('пустой файл — пустой конфиг, а не падение', () => {
    expect(parseConfigText('')).toEqual({});
  });

  it('битый YAML — сообщение с позицией и именем файла, а не стек', () => {
    // Табуляция в отступе: YAML её запрещает, а редактор ставит молча — самая
    // частая поломка файла, написанного руками.
    const text = 'debug: true\n\tmqtt: 1\n';
    expect(() => parseConfigText(text, 'C:/cfg.yaml')).toThrow(/строка \d+/);
    expect(() => parseConfigText(text, 'C:/cfg.yaml')).toThrow(/C:\/cfg\.yaml/);
  });

  it('список вместо отображения — внятный отказ', () => {
    expect(() => parseConfigText('- a\n- b\n')).toThrow(/списком/);
  });
});
```

- [ ] **Step 3: Прогнать тест и убедиться, что он падает**

Run: `npx vitest run src/config-helpers.test.js`
Expected: FAIL — `Failed to resolve import "./config-helpers.js"`.

- [ ] **Step 4: Написать реализацию**

Создать `src/config-helpers.js`:

```js
/** Чистые помощники конфига: разбор, поиск файла, сравнение. Без I/O. */

import { parse } from 'yaml';

/**
 * Ключ, под которым живут якоря.
 *
 * Якорю в YAML нужен узел, на котором он объявлен, и держать их отдельно
 * лучше, чем объявлять на первом использовании: иначе первое правило
 * становится определением для остальных, и его нельзя удалить или переставить,
 * не сломав соседей молча. Префикс `x-` — соглашение docker-compose для
 * служебных ключей.
 */
const ANCHORS_KEY = 'x-anchors';

/**
 * Разобрать текст конфига.
 *
 * `merge: true` обязателен: без него `yaml` v2 читает `<<` как обычный ключ со
 * строковым именем — правило получает поле `<<` и ни одного унаследованного
 * значения, и происходит это молча.
 *
 * `x-anchors` вырезается не ради чистоты: оставшись, он попал бы в сравнение
 * со старым конфигом (`config-verify`), и проверка эквивалентности сообщала бы
 * о расхождении, которого нет.
 */
function parseConfigText(text, filePath = '') {
  const where = filePath ? ` ${filePath}` : '';
  let parsed;
  try {
    parsed = parse(text, { merge: true });
  } catch (e) {
    const pos = e.linePos?.[0];
    const at = pos ? ` (строка ${pos.line}, колонка ${pos.col})` : '';
    throw new Error(`Конфиг${where} не разбирается${at}: ${e.message}`);
  }
  if (parsed === null || parsed === undefined) return {};
  if (Array.isArray(parsed)) {
    throw new Error(`Конфиг${where} должен быть отображением ключей, а оказался списком`);
  }
  if (typeof parsed !== 'object') {
    throw new Error(`Конфиг${where} должен быть отображением ключей, а оказался значением ${typeof parsed}`);
  }
  const config = { ...parsed };
  delete config[ANCHORS_KEY];
  return config;
}

export { ANCHORS_KEY, parseConfigText };
```

- [ ] **Step 5: Прогнать тест и убедиться, что он проходит**

Run: `npx vitest run src/config-helpers.test.js`
Expected: PASS, 6 тестов.

- [ ] **Step 6: Коммит**

```bash
git add package.json package-lock.json src/config-helpers.js src/config-helpers.test.js
git commit -m "feat(config): разбор YAML с якорями и merge-ключами"
```

---

### Task 2: Поиск файла и правило перечитывания

**Files:**
- Modify: `src/config-helpers.js`
- Test: `src/config-helpers.test.js`

**Interfaces:**
- Consumes: `parseConfigText` из задачи 1 (не используется здесь, но живёт в том же файле).
- Produces:
  - `configCandidates({ appDataDir, homedir, cwd, repoDir }) => string[]` — пять путей в порядке приоритета;
  - `shouldReload({ cachedPath, cachedMtimeMs, filePath, mtimeMs }) => boolean`;
  - `formatMissingConfig(candidates: string[]) => string`.

- [ ] **Step 1: Написать падающий тест**

Дописать в `src/config-helpers.test.js`:

```js
import { configCandidates, shouldReload, formatMissingConfig } from './config-helpers.js';

describe('configCandidates', () => {
  const dirs = { appDataDir: '/app', homedir: '/home/u', cwd: '/work', repoDir: '/repo' };

  it('пять мест в порядке приоритета, все с расширением .yaml', () => {
    expect(configCandidates(dirs).map(p => p.replace(/\\/g, '/'))).toEqual([
      '/app/windows-mqtt/windows11-manager.config.yaml',
      '/app/windows11-manager/config.yaml',
      '/home/u/.config/windows11-manager.config.yaml',
      '/work/windows11-manager.config.yaml',
      '/repo/config.yaml',
    ]);
  });

  it('второго имени .yml нет ни у одного кандидата', () => {
    expect(configCandidates(dirs).some(p => p.endsWith('.yml'))).toBe(false);
  });
});

describe('shouldReload', () => {
  const base = { cachedPath: '/c.yaml', cachedMtimeMs: 100, filePath: '/c.yaml', mtimeMs: 100 };

  it('ничего не изменилось — не перечитываем', () => {
    expect(shouldReload(base)).toBe(false);
  });

  it('файл переписали — перечитываем', () => {
    expect(shouldReload({ ...base, mtimeMs: 101 })).toBe(true);
  });

  it('сменился путь — перечитываем', () => {
    expect(shouldReload({ ...base, filePath: '/other.yaml' })).toBe(true);
  });

  it('кэша ещё нет — перечитываем', () => {
    expect(shouldReload({ ...base, cachedPath: '' })).toBe(true);
  });

  it('mtime неизвестен — перечитываем, а не верим кэшу', () => {
    // statSync не ответил: файл могли подменить, и молчаливая выдача старого
    // конфига хуже лишнего чтения.
    expect(shouldReload({ ...base, mtimeMs: null })).toBe(true);
  });
});

describe('formatMissingConfig', () => {
  it('перечисляет все просмотренные места', () => {
    const text = formatMissingConfig(['/a.yaml', '/b.yaml']);
    expect(text).toContain('/a.yaml');
    expect(text).toContain('/b.yaml');
    expect(text).toMatch(/не найден/i);
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npx vitest run src/config-helpers.test.js`
Expected: FAIL — `configCandidates is not a function`.

- [ ] **Step 3: Написать реализацию**

Дописать в `src/config-helpers.js` — сначала импорт (в задаче 1 его не было, потому что он был бы неиспользуемым):

```js
import path from 'node:path';
```

Дальше, перед `export`:

```js
/**
 * Пять мест, где ищется конфиг, в порядке приоритета. Список тот же, что был у
 * JS-конфига, — меняется только расширение.
 */
function configCandidates({ appDataDir, homedir, cwd, repoDir }) {
  return [
    path.join(appDataDir, 'windows-mqtt', 'windows11-manager.config.yaml'),
    path.join(appDataDir, 'windows11-manager', 'config.yaml'),
    path.join(homedir, '.config', 'windows11-manager.config.yaml'),
    path.join(cwd, 'windows11-manager.config.yaml'),
    path.join(repoDir, 'config.yaml'),
  ];
}

/**
 * Пора ли перечитывать файл.
 *
 * Кэш нужен не из аккуратности: `getConfig()` зовут из тика демона claude-wt
 * раз в секунду, и без кэша это 234 МБ RSS против 49 МБ (замерено на живом
 * конфиге). Сторож — mtime: конфиг правят на живой машине и ждут, что правка
 * подхватится без перезапуска.
 *
 * Неизвестный mtime считается поводом перечитать: `statSync` не ответил, а
 * молчаливая выдача старого конфига хуже лишнего чтения локального файла.
 */
function shouldReload({ cachedPath, cachedMtimeMs, filePath, mtimeMs }) {
  if (!cachedPath || cachedPath !== filePath) return true;
  if (mtimeMs === null || mtimeMs === undefined) return true;
  return cachedMtimeMs !== mtimeMs;
}

/** Отказ, который называет, где искали: иначе «конфиг не найден» нечем чинить. */
function formatMissingConfig(candidates) {
  return ['Конфиг не найден. Просмотрены:', ...candidates.map(c => `  ${c}`)].join('\n');
}
```

И расширить экспорт:

```js
export { ANCHORS_KEY, parseConfigText, configCandidates, shouldReload, formatMissingConfig };
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Run: `npx vitest run src/config-helpers.test.js`
Expected: PASS, 14 тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/config-helpers.js src/config-helpers.test.js
git commit -m "feat(config): кандидаты путей .yaml и правило перечитывания"
```

---

### Task 3: Загрузчик на YAML вместо require

**Files:**
- Modify: `src/config.js` (переписывается целиком, кроме `appDataDir()` и `watchAppliedLayouts()`)
- Test: `src/config.test.js` (создать)

**Interfaces:**
- Consumes: `parseConfigText`, `configCandidates`, `shouldReload`, `formatMissingConfig` из задач 1–2.
- Produces:
  - `loadConfigFile(filePath: string) => object` — прочитать и разобрать названный файл (без `_configPath`);
  - `resolveConfigPath() => string` — первый существующий кандидат или `''`;
  - `getConfig() => object` (подпись не меняется), `reloadConfigs()`, `watchAppliedLayouts()` — как были.

- [ ] **Step 1: Написать падающий тест**

Создать `src/config.test.js`:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfigFile } from './config.js';

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w11m-config-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(name, text) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

describe('loadConfigFile', () => {
  it('читает файл с диска и раскрывает якоря', () => {
    const file = write('c.yaml', [
      'x-anchors:',
      '  base: &base',
      '    desktop: 1',
      'debug: true',
      'windows:',
      '  - <<: *base',
      '    titleMatch: Telegram',
    ].join('\n'));
    expect(loadConfigFile(file)).toEqual({
      debug: true,
      windows: [{ desktop: 1, titleMatch: 'Telegram' }],
    });
  });

  it('не добавляет _configPath: сравнению конфигов лишний ключ мешает', () => {
    const file = write('c.yaml', 'debug: false\n');
    expect('_configPath' in loadConfigFile(file)).toBe(false);
  });

  it('битый файл называет своё имя', () => {
    const file = write('broken.yaml', 'mqtt: {host: a: b}\n');
    expect(() => loadConfigFile(file)).toThrow(/broken\.yaml/);
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npx vitest run src/config.test.js`
Expected: FAIL — `loadConfigFile is not a function`.

- [ ] **Step 3: Переписать `src/config.js`**

Целиком, кроме `appDataDir()` и `watchAppliedLayouts()`, которые остаются как есть:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configCandidates, formatMissingConfig, parseConfigText, shouldReload } from './config-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// OS settings base dir: %APPDATA% on Windows, ~/Library/Application Support on
// macOS, $XDG_CONFIG_HOME (or ~/.config) on Linux.
function appDataDir() {
  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function candidates() {
  return configCandidates({
    appDataDir: appDataDir(),
    homedir: os.homedir(),
    cwd: process.cwd(),
    repoDir: path.resolve(__dirname, '..'),
  });
}

/** Первый существующий кандидат; пусто — конфига нет нигде. */
function resolveConfigPath() {
  for (const candidate of candidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

/** Прочитать названный файл. Без `_configPath`: его добавляет только getConfig. */
function loadConfigFile(filePath) {
  return parseConfigText(fs.readFileSync(filePath, 'utf8'), filePath);
}

let configPath = resolveConfigPath();

// Разобранный конфиг живёт до смены mtime — почему, см. shouldReload().
let cached = null;
let cachedPath = '';
let cachedMtimeMs = null;

function configMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function getConfig() {
  if (!configPath) throw new Error(formatMissingConfig(candidates()));
  const mtimeMs = configMtimeMs(configPath);
  if (shouldReload({ cachedPath, cachedMtimeMs, filePath: configPath, mtimeMs })) {
    cached = loadConfigFile(configPath);
    cachedPath = configPath;
    cachedMtimeMs = mtimeMs;
  }
  // Копия обязана быть глубокой: вызывающие пишут прямо в объекты конфига —
  // placement.js ставит rule.pos правилам из config.windows, findWindows()
  // дописывает им titleMatch. Общий кэшированный объект копил бы эти пометки
  // между вызовами. Отката на «неклонируемый конфиг» больше нет: функций в
  // YAML не бывает, и structuredClone на этих данных не спотыкается.
  const config = structuredClone(cached);
  config._configPath = configPath;
  return config;
}

function reloadConfigs() {
  // Явный сброс: «перечитать» должно означать перечитать, а не «сверить mtime».
  cached = null;
  cachedPath = '';
  // Файл могли положить в другое место (или впервые) уже после старта процесса.
  configPath = resolveConfigPath();
  const config = getConfig();
  if (config.debug) console.log('Configuration reloaded');
  return config;
}
```

Ниже — `watchAppliedLayouts()` без изменений, и экспорт:

```js
export { getConfig, reloadConfigs, watchAppliedLayouts, loadConfigFile, resolveConfigPath };
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Run: `npx vitest run src/config.test.js`
Expected: PASS, 3 теста.

- [ ] **Step 5: Прогнать весь набор**

Run: `npm test`
Expected: PASS. Тесты, мокающие `getConfig()`, не задеты — подпись не менялась.

- [ ] **Step 6: Коммит**

```bash
git add src/config.js src/config.test.js
git commit -m "feat(config): загрузчик читает YAML, require и его кэш вырезаны"
```

---

### Task 4: Сравнение двух конфигов

**Files:**
- Modify: `src/config-helpers.js`
- Test: `src/config-helpers.test.js`

**Interfaces:**
- Consumes: ничего из предыдущих задач.
- Produces:
  - `MISSING: symbol` — «ключа нет вовсе», отличается от `undefined` в значении;
  - `diffConfigs(a, b) => Array<{ path: string, a: any, b: any }>`;
  - `describeValue(v) => string` — для печати расхождения.

- [ ] **Step 1: Написать падающий тест**

Дописать в `src/config-helpers.test.js`:

```js
import { diffConfigs, describeValue, MISSING } from './config-helpers.js';

describe('diffConfigs', () => {
  it('одинаковые конфиги — ни одного расхождения', () => {
    const a = { debug: true, windows: [{ x: 1 }] };
    expect(diffConfigs(a, structuredClone(a))).toEqual([]);
  });

  it('расхождение в глубине называет полный путь', () => {
    const a = { windows: [{}, {}, { fancyZones: { position: 3 } }] };
    const b = { windows: [{}, {}, { fancyZones: { position: 1 } }] };
    expect(diffConfigs(a, b)).toEqual([
      { path: 'windows[2].fancyZones.position', a: 3, b: 1 },
    ]);
  });

  it('лишний элемент массива виден как отсутствующий у соседа', () => {
    const diffs = diffConfigs({ list: [1, 2] }, { list: [1] });
    expect(diffs).toEqual([{ path: 'list[1]', a: 2, b: MISSING }]);
  });

  it('ключ есть у одного и отсутствует у другого', () => {
    const diffs = diffConfigs({ a: 1 }, {});
    expect(diffs).toEqual([{ path: 'a', a: 1, b: MISSING }]);
  });

  it('отличает отсутствие ключа от значения null', () => {
    const diffs = diffConfigs({ a: null }, {});
    expect(diffs).toEqual([{ path: 'a', a: null, b: MISSING }]);
  });

  it('объект против скаляра — одно расхождение, а не обход внутрь', () => {
    const diffs = diffConfigs({ a: { b: 1 } }, { a: 5 });
    expect(diffs).toEqual([{ path: 'a', a: { b: 1 }, b: 5 }]);
  });
});

describe('describeValue', () => {
  it('отсутствие называется словом, а не undefined', () => {
    expect(describeValue(MISSING)).toBe('отсутствует');
  });

  it('строки печатаются в кавычках, числа — как есть', () => {
    expect(describeValue('Work')).toBe('"Work"');
    expect(describeValue(3)).toBe('3');
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npx vitest run src/config-helpers.test.js`
Expected: FAIL — `diffConfigs is not a function`.

- [ ] **Step 3: Написать реализацию**

Дописать в `src/config-helpers.js`:

```js
/**
 * «Ключа нет вовсе» — не то же самое, что `undefined` в значении. Различать
 * обязательно: переезд конфига как раз и ошибается тем, что запись теряют
 * целиком, а не портят её значение.
 */
const MISSING = Symbol('отсутствует');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Сравнить два разобранных конфига и вернуть расхождения путями.
 *
 * Сравниваются структуры, а не текст: порядок ключей, отступы и комментарии на
 * поведение менеджера не влияют и расхождением не считаются.
 */
function diffConfigs(a, b, prefix = '', out = []) {
  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      diffConfigs(
        i < a.length ? a[i] : MISSING,
        i < b.length ? b[i] : MISSING,
        `${prefix}[${i}]`,
        out,
      );
    }
    return out;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      diffConfigs(
        key in a ? a[key] : MISSING,
        key in b ? b[key] : MISSING,
        prefix ? `${prefix}.${key}` : key,
        out,
      );
    }
    return out;
  }
  if (a !== b) out.push({ path: prefix, a, b });
  return out;
}

/** Значение для строки отчёта: отсутствие — словом, остальное — как в JSON. */
function describeValue(value) {
  if (value === MISSING) return 'отсутствует';
  return JSON.stringify(value);
}
```

И расширить экспорт:

```js
export {
  ANCHORS_KEY, MISSING,
  parseConfigText, configCandidates, shouldReload, formatMissingConfig,
  diffConfigs, describeValue,
};
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Run: `npx vitest run src/config-helpers.test.js`
Expected: PASS, 22 теста.

- [ ] **Step 5: Коммит**

```bash
git add src/config-helpers.js src/config-helpers.test.js
git commit -m "feat(config): сравнение двух конфигов путями расхождений"
```

---

### Task 5: Команды config-dump и config-verify

**Files:**
- Create: `src/commands/config-commands.js`
- Create: `src/commands/config-commands.test.js`
- Modify: `src/index.js` (регистрация команд, рядом с существующими `program.command(...)`)

**Interfaces:**
- Consumes: `loadConfigFile`, `resolveConfigPath` (задача 3), `diffConfigs`, `describeValue` (задача 4).
- Produces:
  - `dumpConfig(filePath?: string, opts?: { json?: boolean }) => string`;
  - `verifyConfigs(aPath: string, bPath: string) => { ok: boolean, lines: string[] }`.

- [ ] **Step 1: Написать падающий тест**

Создать `src/commands/config-commands.test.js`:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dumpConfig, verifyConfigs } from './config-commands.js';

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w11m-config-cmd-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(name, text) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

describe('dumpConfig', () => {
  it('по умолчанию печатает YAML с раскрытыми якорями', () => {
    const file = write('c.yaml', 'x-anchors:\n  b: &b\n    desktop: 1\nwindows:\n  - <<: *b\n');
    const out = dumpConfig(file);
    expect(out).toContain('windows:');
    expect(out).toContain('desktop: 1');
    expect(out).not.toContain('x-anchors');
  });

  it('--json печатает JSON', () => {
    const file = write('c.yaml', 'debug: true\n');
    expect(JSON.parse(dumpConfig(file, { json: true }))).toEqual({ debug: true });
  });
});

describe('verifyConfigs', () => {
  it('снимок JSON против YAML: совпало — успех одной строкой', () => {
    const a = write('old.json', JSON.stringify({ debug: true, windows: [{ desktop: 1 }] }));
    const b = write('new.yaml', 'debug: true\nwindows:\n  - desktop: 1\n');
    expect(verifyConfigs(a, b)).toEqual({ ok: true, lines: ['конфиги эквивалентны'] });
  });

  it('расхождение печатается путём и обоими значениями', () => {
    const a = write('old.json', JSON.stringify({ windows: [{ desktop: 1 }] }));
    const b = write('new.yaml', 'windows:\n  - desktop: 2\n');
    const res = verifyConfigs(a, b);
    expect(res.ok).toBe(false);
    expect(res.lines[0]).toBe('разошлись: windows[0].desktop  1 ≠ 2');
    expect(res.lines.at(-1)).toBe('расхождений: 1');
  });

  it('потерянная при переносе запись видна как отсутствующая', () => {
    const a = write('old.json', JSON.stringify({ claudeWt: { projects: [{ name: 'home' }] } }));
    const b = write('new.yaml', 'claudeWt:\n  projects: []\n');
    const res = verifyConfigs(a, b);
    expect(res.lines[0]).toContain('claudeWt.projects[0]');
    expect(res.lines[0]).toContain('отсутствует');
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npx vitest run src/commands/config-commands.test.js`
Expected: FAIL — `Failed to resolve import "./config-commands.js"`.

- [ ] **Step 3: Написать реализацию**

Создать `src/commands/config-commands.js`:

```js
/**
 * Служебные команды конфига: показать разобранное и доказать эквивалентность.
 *
 * Заведены ради переезда с JS на YAML. Живой конфиг переписывается руками (в
 * нём якоря и комментарии, которых автоматический дамп не восстановит), а
 * `config-verify` доказывает, что рукопись не разошлась с оригиналом, — до
 * выкатки, а не после.
 *
 * Старый JS здесь не читается намеренно: `require` пришлось бы оставить в новой
 * версии ровно затем, ради чего его выпиливают. Снимок делает старая версия на
 * своей машине:
 *   node -e "console.log(JSON.stringify(require('<путь к .js>')))" > old.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { loadConfigFile, resolveConfigPath } from '../config.js';
import { describeValue, diffConfigs } from '../config-helpers.js';

/** `.json` — снимок старой версии, всё остальное — конфиг YAML. */
function loadAny(filePath) {
  if (path.extname(filePath).toLowerCase() === '.json') {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  return loadConfigFile(filePath);
}

function dumpConfig(filePath, { json = false } = {}) {
  const config = loadAny(filePath || resolveConfigPath());
  return json ? JSON.stringify(config, null, 2) : stringify(config);
}

function verifyConfigs(aPath, bPath) {
  const diffs = diffConfigs(loadAny(aPath), loadAny(bPath));
  if (!diffs.length) return { ok: true, lines: ['конфиги эквивалентны'] };
  return {
    ok: false,
    lines: [
      ...diffs.map(d => `разошлись: ${d.path}  ${describeValue(d.a)} ≠ ${describeValue(d.b)}`),
      `расхождений: ${diffs.length}`,
    ],
  };
}

export { dumpConfig, verifyConfigs };
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Run: `npx vitest run src/commands/config-commands.test.js`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Зарегистрировать команды в CLI**

В `src/index.js`, рядом с прочими `program.command(...)` (выше строки `program.allowExcessArguments();`):

```js
  program
    .command('config-dump')
    .description('показать разобранный конфиг: по умолчанию YAML, при --json — JSON')
    .argument('[path]', 'путь к конфигу; по умолчанию — тот, что выбрал бы менеджер')
    .option('--json', 'вывести JSON вместо YAML')
    .action(async (file, options) => {
      const { dumpConfig } = await import('./commands/config-commands.js');
      console.log(dumpConfig(file, { json: options.json }));
      process.exit(0);
    });

  program
    .command('config-verify')
    .description('сравнить два конфига (.json-снимок или .yaml) и показать расхождения')
    .argument('<a>', 'первый файл')
    .argument('<b>', 'второй файл')
    .action(async (a, b) => {
      const { verifyConfigs } = await import('./commands/config-commands.js');
      const { ok, lines } = verifyConfigs(a, b);
      for (const line of lines) console.log(line);
      process.exit(ok ? 0 : 1);
    });
```

- [ ] **Step 6: Проверить команды живьём**

```bash
printf 'debug: true\nwindows:\n  - desktop: 1\n' > /tmp/a.yaml
printf '{"debug":true,"windows":[{"desktop":1}]}' > /tmp/a.json
node src/index.js config-verify /tmp/a.json /tmp/a.yaml; echo "код выхода: $?"
node src/index.js config-dump /tmp/a.yaml
```

Expected: `конфиги эквивалентны`, код выхода 0; затем YAML с ключами `debug` и `windows`.

- [ ] **Step 7: Коммит**

```bash
git add src/commands/config-commands.js src/commands/config-commands.test.js src/index.js
git commit -m "feat(config): команды config-dump и config-verify"
```

---

### Task 6: Пример конфига и документация на YAML

**Files:**
- Create: `config.example.yaml`
- Delete: `config.example.cjs`
- Modify: `README.md`, `AGENTS.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `config-verify` из задачи 5 — им и доказывается, что перевод примера ничего не потерял.
- Produces: образец формата, на который будут смотреть все, кто переносит свой конфиг.

- [ ] **Step 1: Снять снимок старого примера**

```bash
node -e "console.log(JSON.stringify(require('./config.example.cjs')))" > /tmp/example-old.json
```

- [ ] **Step 2: Перевести пример в YAML**

Создать `config.example.yaml`. Правила перевода:

1. Комментарии переносятся дословно — они и есть документация формата.
2. Константы (`const homeMon1RightHalf = {...}`) уходят в `x-anchors`, использования — в `<<: *имя`.
3. **Строки, начинающиеся с `{`, обязаны быть закавычены.** `{` в начале плоского скаляра YAML читает как начало отображения:

```yaml
    profileArgs: ['-p', '{profile}']     # закавычено — обязательно
    args: ['ssh', '-t', 'ccfzf --session {id} --kiosk']   # тут { в середине, но кавычки не мешают
```

4. **Строки с одинарными и двойными кавычками внутри — в блочном скаляре**, иначе экранирование не читается глазами. Аргумент `launchNew` из примера:

```yaml
    launchNew:
      args:
        - ssh
        - -A
        - popstas@pc-virt.popstas.pro
        - -t
        - >-
          exec $SHELL -ic 'cd -- "$1" && exec claude -n "$2"' claude-wt '{cwd}' '{name}'
```

5. Пустые списки и объекты пишутся явно (`terminalExecutables: []`), а не пропускаются: пропущенный ключ и пустой список — разные вещи для `config-verify`.

Образец перевода блока — как выглядит результат:

```js
// было (config.example.cjs)
const mon1RightThird = { fancyZones: { monitor: 1, position: 3 } };
module.exports = {
  fancyZones: {
    enabled: true,
    path: 'C:/Users/popstas/AppData/Local/Microsoft/PowerToys/FancyZones', // TODO: detect
  },
  windows: [
    {...mon1RightThird, ...{ titleMatch: 'Telegram' }},
  ],
};
```

```yaml
# стало (config.example.yaml)
x-anchors:
  mon1RightThird: &mon1RightThird
    fancyZones: { monitor: 1, position: 3 }

fancyZones:
  enabled: true
  path: C:/Users/popstas/AppData/Local/Microsoft/PowerToys/FancyZones  # TODO: detect

windows:
  - <<: *mon1RightThird
    titleMatch: Telegram
```

- [ ] **Step 3: Доказать, что перевод ничего не потерял**

```bash
node src/index.js config-verify /tmp/example-old.json config.example.yaml
```

Expected: `конфиги эквивалентны`, код выхода 0. Каждое расхождение — либо опечатка перевода, либо осознанная правка примера; во втором случае поправить снимок нечем, поэтому правку примера делать **после** этого шага, отдельным коммитом.

- [ ] **Step 4: Удалить старый пример**

```bash
git rm config.example.cjs
```

- [ ] **Step 5: Поправить документацию**

- `README.md` — раздел про конфиг: имя файла, пять мест поиска, `x-anchors` с примером якоря, обе команды.
- `AGENTS.md` — строка «Config loaded from: `~/.config/windows11-manager.config.js` (takes priority) or `config.cjs`» → пять путей `.yaml`; в разделе Getting started «Copy `config.example.cjs` to `config.js`» → `config.example.yaml` в `config.yaml`.
- `CLAUDE.md` — в quick reference путь живого конфига на popstas-pc (`...\windows-mqtt\windows11-manager.config.js` → `.yaml`).
- `data/scripts/deploy-pc.sh` — файл вне git (`/data/` в .gitignore), поэтому не коммитится, но поправить надо: в его шапке абзац «Конфиг node-части сюда не входит» называет `.js` и `resolveConfigPath` в `src/config.js`. Заодно там сказано «scp'ом файла целиком, чтобы не сломать UTF-8 без BOM» — для YAML это верно тем более.

- [ ] **Step 6: Прогнать весь набор и линт**

```bash
npm test && npx eslint src/
```

Expected: оба чистые.

- [ ] **Step 7: Коммит**

```bash
git add config.example.yaml README.md AGENTS.md CLAUDE.md
git commit -m "feat(config)!: пример и документация на YAML, config.example.cjs удалён"
```

---

### Task 7: Скилл project-add правит YAML

**Files:**
- Modify: `~/.claude/skills/project-add/SKILL.md` (вне репозитория)
- Modify: `.claude/skills/project-add/SKILL.md`, если в репозитории лежит его копия — проверить `ls .claude/skills/project-add/` и править обе

**Interfaces:**
- Consumes: формат из задачи 6 (`x-anchors`, `claudeWt.projects`).
- Produces: процедуру правки конфига программой, не съедающую комментарии.

- [ ] **Step 1: Прочитать скилл и найти места правки JS**

```bash
grep -n "config.js\|module.exports\|projects" ~/.claude/skills/project-add/SKILL.md
```

- [ ] **Step 2: Переписать процедуру правки**

Заменить текстовую правку JS на Document API пакета `yaml` — он сохраняет комментарии соседних записей, а обычный `parse` + `stringify` их уничтожает:

```js
import fs from 'node:fs';
import { parseDocument } from 'yaml';

const file = 'C:/Users/popstas/AppData/Roaming/windows-mqtt/windows11-manager.config.yaml';
const doc = parseDocument(fs.readFileSync(file, 'utf8'));
const projects = doc.getIn(['claudeWt', 'projects']);
projects.add(doc.createNode({ name: 'имя', cwd: '/путь', profiles: { wt: 'Профиль' } }));
fs.writeFileSync(file, String(doc), 'utf8');
```

- [ ] **Step 3: Проверить на копии живого конфига**

```bash
cp <живой конфиг> /tmp/cfg-before.yaml
# выполнить процедуру над /tmp/cfg-before.yaml
node src/index.js config-verify /tmp/cfg-before.yaml /tmp/cfg-after.yaml
```

Expected: единственное расхождение — добавленный проект (`claudeWt.projects[N]`), и ни одного другого. Глазами: комментарии в файле на месте.

- [ ] **Step 4: Коммит**

Скилл вне git — коммитить нечего; если в репозитории есть копия, закоммитить её:

```bash
git add .claude/skills/project-add/SKILL.md
git commit -m "docs(skill): project-add правит YAML через Document API"
```

---

### Task 8: Перенос живого конфига и выкатка

**Files:**
- Живой конфиг на popstas-pc: `%APPDATA%\windows-mqtt\windows11-manager.config.js` → `.yaml` (вне git)

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: работающий менеджер на YAML.

- [ ] **Step 1: Снять снимок старым кодом — до выкатки**

```bash
ssh popstas-pc "cd /d D:\projects\js\windows11-manager && node -e \"console.log(JSON.stringify(require('C:/Users/popstas/AppData/Roaming/windows-mqtt/windows11-manager.config.js')))\"" > /tmp/pc-old.json
```

Expected: файл непустой, `node -e "JSON.parse(require('fs').readFileSync('/tmp/pc-old.json','utf8'))"` не падает.

- [ ] **Step 2: Написать YAML руками**

683 строки: 14 констант → `x-anchors`, спреды → `<<:`, закомментированные правила → `#`. Правила кавычек — из шага 2 задачи 6.

- [ ] **Step 3: Доказать эквивалентность**

```bash
node src/index.js config-verify /tmp/pc-old.json /tmp/pc-new.yaml
```

Expected: `конфиги эквивалентны`, код выхода 0. Не сошлось — править YAML, пока не сойдётся; выкатывать до этого нечего.

- [ ] **Step 4: Положить YAML на машину рядом со старым**

```bash
scp /tmp/pc-new.yaml popstas-pc:'C:/Users/popstas/AppData/Roaming/windows-mqtt/windows11-manager.config.yaml'
```

Старая версия его не видит — она ищет только `.js`, менеджер продолжает работать.

- [ ] **Step 5: Выкатить**

```bash
BRANCH=feat/yaml-config ./data/scripts/deploy-pc.sh --install
```

`--install` обязателен: появилась новая зависимость `yaml`.

- [ ] **Step 6: Проверить на машине**

```bash
ssh popstas-pc "cd /d D:\projects\js\windows11-manager && node src/index.js config-dump --json" | head -20
ssh popstas-pc "powershell -NoProfile -Command \"Get-Content 'D:\projects\js\windows11-manager\data\windows11-manager.log' -Tail 15\""
```

Expected: в stdout `config-dump` — разобранный конфиг, в stderr — строка `# C:\Users\popstas\AppData\Roaming\windows-mqtt\windows11-manager.config.yaml`, то есть прочитан живой конфиг, а не запасной кандидат поиска (`_configPath` в дамп не попадает: его добавляет только `getConfig()`); в журнале — `MQTT service started` и `claude-wt started`, без строк про конфиг.

- [ ] **Step 7: Убрать старый файл**

Только после того, как менеджер поработал на YAML и окна расставляются:

```bash
ssh popstas-pc "move C:\Users\popstas\AppData\Roaming\windows-mqtt\windows11-manager.config.js C:\Users\popstas\AppData\Roaming\windows-mqtt\windows11-manager.config.js.bak"
```

Откат до этого шага — вернуть `.js` на место и выкатить прежний тег.
