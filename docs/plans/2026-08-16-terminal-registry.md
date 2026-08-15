# Реестр терминалов в claude-wt: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** менеджер открывает сессию тем терминалом, который назвала просьба
пикера, а не только Windows Terminal; wt и WezTerm равноправны.

**Architecture:** терминал перестаёт быть частью `claudeWt.launch.args` и
переезжает в реестр `claudeWt.terminals` — карта «имя → `{command, args,
profileArgs}`». Команда собирается сложением: терминал + его аргументы +
профильные аргументы + хвост из `launch.args` (ssh и всё остальное). Имя
терминала приезжает полем `terminal` в теле просьбы `claude-session-open`;
нет имени — берётся `claudeWt.terminal` конфига. Старый конфиг (с
`launch.command`) продолжает работать прежней дорогой.

**Tech Stack:** Node ESM, vitest (тесты лежат рядом с исходниками,
`src/**/*.test.js`), запуск `npm test`, линт `npm run lint`.

**Spec:** `/home/popstas/projects/js/ccfzf-picker/docs/superpowers/specs/2026-08-16-terminal-registry-design.md`

## Global Constraints

- Имена терминалов — общий словарь трёх репозиториев: `wt`, `wezterm`,
  `kitty`, `ghostty`, `iterm2`. На Windows реальны первые два; остальные имена
  обязаны просто не находиться в реестре и откатывать на дефолт машины, а не
  ронять просьбу.
- Поле `terminal` в теле просьбы необязательно. Пустая строка, отсутствие
  ключа и незнакомое имя — дефолт машины и строка в лог.
- Старое плоское поле `profile` у проекта читается как `profiles.wt` —
  иначе первая же выкатка обнулит владельцу все профили.
- Конфиг со старым `launch.command` работает как раньше; реестр в этом случае
  игнорируется, и об этом пишется строка в лог.
- Комментарии и названия тестов — по-русски, как в остальном репозитории;
  строки, которые видит человек (лог, notify), — как принято рядом.
- Чистые помощники не ходят в I/O: конфиг им передают аргументом.

---

### Task 1: Реестр терминалов — чистые помощники

**Files:**
- Create: `src/claude-wt/terminal-helpers.js`
- Create: `src/claude-wt/terminal-helpers.test.js`
- Modify: `src/claude-wt/daemon-helpers.js` (добавить ключи в
  `CLAUDE_WT_DEFAULTS` и слияние в `mergeClaudeWtConfig`)
- Modify: `src/claude-wt/daemon-helpers.test.js` (сторож умолчаний)
- Modify: `config.example.cjs` (показать новую форму)

**Interfaces:**
- Produces:
  - `TERMINAL_DEFAULTS: Record<string, {command: string, args: string[], profileArgs?: string[]}>`
  - `normalizeTerminals(raw: unknown): Record<string, {command, args, profileArgs?}>`
  - `resolveTerminal(asked: string, cfg: object): {name: string, entry: object|null, fallback: boolean}`
  - `isLegacyLaunch(cfg: object): boolean`

- [ ] **Step 1: Написать падающий тест**

Создать `src/claude-wt/terminal-helpers.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  TERMINAL_DEFAULTS,
  normalizeTerminals,
  resolveTerminal,
  isLegacyLaunch,
} from './terminal-helpers.js';

describe('normalizeTerminals', () => {
  it('без пользовательских правок отдаёт встроенные', () => {
    expect(normalizeTerminals(undefined)).toEqual(TERMINAL_DEFAULTS);
    expect(TERMINAL_DEFAULTS.wt.command).toBe('wt.exe');
    expect(TERMINAL_DEFAULTS.wezterm.command).toBe('wezterm-gui.exe');
  });

  it('пользовательская запись перекрывает встроенную целиком', () => {
    const out = normalizeTerminals({ wezterm: { command: 'D:\\wt\\wezterm-gui.exe', args: ['start', '--'] } });
    expect(out.wezterm.command).toBe('D:\\wt\\wezterm-gui.exe');
    expect(out.wt).toEqual(TERMINAL_DEFAULTS.wt);
  });

  it('мусорную запись выбрасывает, а не роняет разбор', () => {
    const out = normalizeTerminals({ wt: 'not-an-object', mine: { args: ['x'] } });
    expect(out.wt).toEqual(TERMINAL_DEFAULTS.wt);
    expect(out.mine).toBeUndefined();
  });
});

describe('resolveTerminal', () => {
  const cfg = { terminal: 'wt', terminals: TERMINAL_DEFAULTS };

  it('названный терминал выигрывает у дефолта машины', () => {
    expect(resolveTerminal('wezterm', cfg)).toMatchObject({ name: 'wezterm', fallback: false });
  });

  it('пустое имя — дефолт машины, и это не откат', () => {
    expect(resolveTerminal('', cfg)).toMatchObject({ name: 'wt', fallback: false });
  });

  it('незнакомое имя — дефолт машины и пометка отката', () => {
    expect(resolveTerminal('iterm2', cfg)).toMatchObject({ name: 'wt', fallback: true });
  });

  it('дефолт машины тоже незнаком — первый из реестра, лишь бы просьба не пропала', () => {
    const broken = { terminal: 'nope', terminals: TERMINAL_DEFAULTS };
    expect(resolveTerminal('also-nope', broken).entry).toBeTruthy();
  });
});

describe('isLegacyLaunch', () => {
  it('уцелевший launch.command значит старый конфиг', () => {
    expect(isLegacyLaunch({ launch: { command: 'wt.exe', args: [] } })).toBe(true);
  });

  it('без launch.command конфиг новый', () => {
    expect(isLegacyLaunch({ launch: { args: ['ssh'] } })).toBe(false);
    expect(isLegacyLaunch({})).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/claude-wt/terminal-helpers.test.js`
Expected: FAIL — `Failed to resolve import "./terminal-helpers.js"`.

- [ ] **Step 3: Написать помощников**

Создать `src/claude-wt/terminal-helpers.js`:

```js
/** Реестр терминалов: имя → чем и как открывать. Без I/O. */

/**
 * Встроенные терминалы Windows.
 *
 * `args` — то, что стоит между исполняемым и хвостом из `launch.args`:
 * у Windows Terminal это «в текущее окно», у WezTerm — подкоманда `start` и
 * `--`, без которого его разбор принял бы `ssh` за свою подкоманду.
 * `profileArgs` есть только у того, у кого профили вообще бывают.
 */
const TERMINAL_DEFAULTS = {
  wt: { command: 'wt.exe', args: ['-w', '-1'], profileArgs: ['-p', '{profile}'] },
  wezterm: { command: 'wezterm-gui.exe', args: ['start', '--'] },
};

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  if (!command) return null;
  const entry = { command, args: Array.isArray(raw.args) ? raw.args.map(String) : [] };
  if (Array.isArray(raw.profileArgs)) entry.profileArgs = raw.profileArgs.map(String);
  return entry;
}

/**
 * Слить пользовательский реестр со встроенным.
 *
 * Перекрытие идёт записью целиком, а не поключево: `args` у терминала —
 * связный набор, и слияние по ключам дало бы полузаписи вроде «команда
 * WezTerm с аргументами wt».
 */
function normalizeTerminals(raw) {
  const out = { ...TERMINAL_DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const [name, value] of Object.entries(raw)) {
    const entry = normalizeEntry(value);
    if (entry) out[name] = entry;
  }
  return out;
}

/**
 * Какой терминал открывать.
 *
 * `fallback: true` значит «просили не то, что мы умеем» — про это надо сказать
 * в лог: молчаливый чужой терминал выглядит как проигнорированная настройка.
 * Пустое имя откатом не считается: пикер его не назвал, и дефолт машины — это
 * ответ, а не подмена.
 */
function resolveTerminal(asked, cfg = {}) {
  const terminals = normalizeTerminals(cfg.terminals);
  const wanted = typeof asked === 'string' ? asked.trim() : '';
  if (wanted && terminals[wanted]) return { name: wanted, entry: terminals[wanted], fallback: false };
  const preferred = typeof cfg.terminal === 'string' ? cfg.terminal.trim() : '';
  if (terminals[preferred]) return { name: preferred, entry: terminals[preferred], fallback: Boolean(wanted) };
  const [name, entry] = Object.entries(terminals)[0] ?? [];
  return { name: name ?? '', entry: entry ?? null, fallback: true };
}

/** Старый конфиг: терминал ещё лежит внутри `launch`, реестр не действует. */
function isLegacyLaunch(cfg = {}) {
  return Boolean(cfg.launch && typeof cfg.launch.command === 'string' && cfg.launch.command.trim());
}

export { TERMINAL_DEFAULTS, normalizeTerminals, resolveTerminal, isLegacyLaunch };
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npx vitest run src/claude-wt/terminal-helpers.test.js`
Expected: PASS, 9 тестов.

- [ ] **Step 5: Завести ключи конфига**

В `src/claude-wt/daemon-helpers.js` добавить импорт
`import { normalizeTerminals } from './terminal-helpers.js';`, в
`CLAUDE_WT_DEFAULTS` — две строки после `profile: ''`:

```js
  // Какой терминал открывать, когда просьба его не назвала.
  terminal: 'wt',
  // Реестр терминалов: имя → чем открывать. Умолчания — в terminal-helpers.js.
  terminals: {},
```

а в `mergeClaudeWtConfig` — строку рядом с `projects:`:

```js
    terminals: normalizeTerminals(cfg.terminals),
```

- [ ] **Step 6: Сторож умолчаний**

В `src/claude-wt/daemon-helpers.test.js` дописать:

```js
describe('умолчания реестра терминалов', () => {
  it('пустой конфиг даёт оба встроенных терминала и дефолт wt', () => {
    const cfg = mergeClaudeWtConfig({});
    expect(cfg.terminal).toBe('wt');
    expect(Object.keys(cfg.terminals).sort()).toEqual(['wezterm', 'wt']);
  });
});
```

(`mergeClaudeWtConfig` уже импортируется в этом файле; если нет — добавить в
существующий импорт.)

- [ ] **Step 7: Показать форму в примере конфига**

В `config.example.cjs` рядом с `claudeWt.launch` дописать:

```js
    // Терминал по умолчанию для этой машины. Просьба пикера может назвать
    // другой — тогда выигрывает она.
    terminal: 'wt',
    // Реестр терминалов: то, что стоит перед ssh-хвостом из launch.args.
    // Пустой — берутся встроенные (wt и wezterm).
    terminals: {
      wt: { command: 'wt.exe', args: ['-w', '-1'], profileArgs: ['-p', '{profile}'] },
      wezterm: { command: 'wezterm-gui.exe', args: ['start', '--'] },
    },
```

- [ ] **Step 8: Прогнать всё и закоммитить**

Run: `npm test && npm run lint`
Expected: PASS.

```bash
git add src/claude-wt/terminal-helpers.js src/claude-wt/terminal-helpers.test.js \
        src/claude-wt/daemon-helpers.js src/claude-wt/daemon-helpers.test.js config.example.cjs
git commit -m "feat(claude-wt): реестр терминалов — имя, команда и профильные аргументы"
```

---

### Task 2: Профиль — карта по имени терминала

**Files:**
- Modify: `src/claude-wt/project-helpers.js` (`normalizeProjects`, новая `profileForTerminal`)
- Modify: `src/claude-wt/project-helpers.test.js`
- Modify: `config.example.cjs`

**Interfaces:**
- Consumes: ничего из Task 1 (чистая работа с записью проекта).
- Produces: `profileForTerminal(cwd: string, terminalName: string, cfg: object): string`
  — пустая строка значит «профильных аргументов не добавлять».

- [ ] **Step 1: Написать падающий тест**

В `src/claude-wt/project-helpers.test.js` дописать:

```js
import { profileForTerminal } from './project-helpers.js';

describe('profileForTerminal', () => {
  const cfg = {
    profile: 'Global',
    projects: [
      { name: 'site', cwd: 'D:\\p\\site', profiles: { wt: 'Site', iterm2: 'SiteMac' } },
      { name: 'old', cwd: 'D:\\p\\old', profile: 'Old' },
    ],
  };

  it('берёт профиль по имени терминала', () => {
    expect(profileForTerminal('D:\\p\\site', 'wt', cfg)).toBe('Site');
  });

  it('у терминала без профиля в карте — пусто, а не чужой профиль', () => {
    expect(profileForTerminal('D:\\p\\site', 'wezterm', cfg)).toBe('');
  });

  it('старое плоское поле profile читается как профиль wt', () => {
    expect(profileForTerminal('D:\\p\\old', 'wt', cfg)).toBe('Old');
    expect(profileForTerminal('D:\\p\\old', 'wezterm', cfg)).toBe('');
  });

  it('незнакомый каталог получает глобальный профиль только для wt', () => {
    expect(profileForTerminal('D:\\p\\nope', 'wt', cfg)).toBe('Global');
    expect(profileForTerminal('D:\\p\\nope', 'wezterm', cfg)).toBe('');
  });
});

describe('normalizeProjects и карта профилей', () => {
  it('карта profiles переживает нормализацию', () => {
    const [p] = normalizeProjects([{ name: 'a', cwd: 'C:\\a', profiles: { wt: 'A', wezterm: 'B' } }]);
    expect(p.profiles).toEqual({ wt: 'A', wezterm: 'B' });
  });

  it('мусор в profiles выбрасывается, а запись остаётся', () => {
    const [p] = normalizeProjects([{ name: 'a', cwd: 'C:\\a', profiles: { wt: 5, ok: 'yes' } }]);
    expect(p.profiles).toEqual({ ok: 'yes' });
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/claude-wt/project-helpers.test.js`
Expected: FAIL — `profileForTerminal is not a function`.

- [ ] **Step 3: Реализовать**

В `src/claude-wt/project-helpers.js` в `normalizeProjects` после строки про
`entry.profile` добавить:

```js
    if (p.profiles && typeof p.profiles === 'object') {
      const profiles = {};
      for (const [term, value] of Object.entries(p.profiles)) {
        if (typeof value === 'string' && value.trim()) profiles[term] = value.trim();
      }
      if (Object.keys(profiles).length) entry.profiles = profiles;
    }
```

и рядом с `profileForCwd` добавить:

```js
/**
 * Профиль для конкретного терминала.
 *
 * Профили — понятие не общее: у Windows Terminal они есть, у WezTerm нет
 * вовсе. Поэтому карта по имени терминала, а не одно поле: одно поле пришлось
 * бы либо подставлять всем подряд, либо угадывать, кому оно предназначалось.
 *
 * Старое плоское `profile` (и у проекта, и глобальное) читается как профиль
 * `wt`: конфиги написаны до реестра, и все они про Windows Terminal. Читай мы
 * его как «для любого терминала», первый же запуск WezTerm получил бы
 * аргументы, которых тот не понимает.
 */
function profileForTerminal(cwd, terminalName, cfg = {}) {
  const name = typeof terminalName === 'string' ? terminalName : '';
  const projects = Array.isArray(cfg.projects) ? cfg.projects : [];
  const hit = typeof cwd === 'string' && cwd ? projects.find(p => p.cwd === cwd) : undefined;
  const mapped = hit?.profiles?.[name];
  if (typeof mapped === 'string' && mapped) return mapped;
  if (name !== 'wt') return '';
  if (hit && typeof hit.profile === 'string' && hit.profile) return hit.profile;
  if (hit && hit.profiles) return '';
  return typeof cfg.profile === 'string' ? cfg.profile : '';
}
```

и добавить `profileForTerminal` в список экспорта.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run src/claude-wt/project-helpers.test.js`
Expected: PASS.

- [ ] **Step 5: Показать форму в примере конфига**

В `config.example.cjs` у записи проекта в `claudeWt.projects` заменить
`profile: 'Site'` на:

```js
        // Профили — свои у каждого терминала: у wt они есть, у wezterm нет.
        // Старое поле `profile` продолжает работать и значит профиль wt.
        profiles: { wt: 'Site' },
```

- [ ] **Step 6: Прогнать всё и закоммитить**

Run: `npm test && npm run lint`

```bash
git add src/claude-wt/project-helpers.js src/claude-wt/project-helpers.test.js config.example.cjs
git commit -m "feat(claude-wt): профиль проекта — карта по имени терминала"
```

---

### Task 3: Сборка команды из реестра

**Files:**
- Modify: `src/claude-wt/project-helpers.js` (`planWtLaunch`, `planLaunchNew`)
- Modify: `src/claude-wt/project-helpers.test.js`

**Interfaces:**
- Consumes: `resolveTerminal` (Task 1) вызывается не здесь, а у зовущего;
  сюда приезжает уже выбранная запись терминала.
- Produces:
  - `planWtLaunch({launch, vars, profile, terminal}): {command: string, args: string[]}`
    — при переданном `terminal` команда собирается сложением, без него работает
    как раньше (старый конфиг).
  - `planLaunchNew({launchNew, cwd, name, profile, terminal})` — та же добавка.

- [ ] **Step 1: Написать падающий тест**

В `src/claude-wt/project-helpers.test.js` дописать:

```js
describe('planWtLaunch с реестром терминалов', () => {
  const launch = { args: ['ssh', '-t', 'host', 'ccfzf --session {id}'] };

  it('складывает терминал, его аргументы и хвост', () => {
    const out = planWtLaunch({
      launch,
      vars: { id: 's1' },
      terminal: { command: 'wezterm-gui.exe', args: ['start', '--'] },
    });
    expect(out.command).toBe('wezterm-gui.exe');
    expect(out.args).toEqual(['start', '--', 'ssh', '-t', 'host', 'ccfzf --session s1']);
  });

  it('профильные аргументы встают между терминалом и хвостом', () => {
    const out = planWtLaunch({
      launch,
      vars: { id: 's1' },
      profile: 'Site',
      terminal: { command: 'wt.exe', args: ['-w', '-1'], profileArgs: ['-p', '{profile}'] },
    });
    expect(out.args).toEqual(['-w', '-1', '-p', 'Site', 'ssh', '-t', 'host', 'ccfzf --session s1']);
  });

  it('пустой профиль профильных аргументов не даёт', () => {
    const out = planWtLaunch({
      launch,
      vars: { id: 's1' },
      profile: '',
      terminal: { command: 'wt.exe', args: ['-w', '-1'], profileArgs: ['-p', '{profile}'] },
    });
    expect(out.args).toEqual(['-w', '-1', 'ssh', '-t', 'host', 'ccfzf --session s1']);
  });

  it('терминал без profileArgs профиль молча роняет, а не подставляет чужой флаг', () => {
    const out = planWtLaunch({
      launch,
      vars: { id: 's1' },
      profile: 'Site',
      terminal: { command: 'wezterm-gui.exe', args: ['start', '--'] },
    });
    expect(out.args).toEqual(['start', '--', 'ssh', '-t', 'host', 'ccfzf --session s1']);
  });

  it('без terminal работает по-старому — команда из launch', () => {
    const out = planWtLaunch({
      launch: { command: 'wt.exe', args: ['-w', '-1', 'ssh', '{id}'] },
      vars: { id: 's1' },
      profile: 'Site',
    });
    expect(out.command).toBe('wt.exe');
    expect(out.args).toEqual(['-w', '-1', '-p', 'Site', 'ssh', 's1']);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/claude-wt/project-helpers.test.js -t "реестром терминалов"`
Expected: FAIL — команда `undefined`, аргументы без терминального префикса.

- [ ] **Step 3: Реализовать**

В `src/claude-wt/project-helpers.js` заменить `planWtLaunch` на:

```js
/**
 * Собрать описание запуска.
 *
 * Две дороги, и разводит их наличие `terminal`. С реестром команда
 * складывается: терминал, его аргументы, профильные аргументы, хвост из
 * `launch.args`. Без реестра — прежняя дорога старого конфига, где терминал и
 * хвост лежат в `launch` одним списком, а профиль вставляет `applyWtProfile`.
 *
 * Подстановка идёт по собранному списку, а не по хвосту: `{profile}` стоит в
 * профильных аргументах, `{id}`/`{cwd}`/`{name}` — в хвосте, и разделять два
 * прохода было бы двумя местами, где легко забыть про новую подстановку.
 */
function planWtLaunch({ launch, vars = {}, profile, terminal }) {
  const id = vars.id ?? '';
  const safeCwd = escapeForSingleQuoted(vars.cwd ?? '');
  const safeName = escapeForSingleQuoted(vars.name ?? '');
  const wanted = typeof profile === 'string' ? profile : '';
  const substitute = arg => String(arg)
    .replaceAll('{id}', id)
    .replaceAll('{cwd}', safeCwd)
    .replaceAll('{name}', safeName)
    .replaceAll('{profile}', wanted);
  const tail = launch?.args ?? [];
  if (!terminal?.command) {
    return { command: launch?.command, args: applyWtProfile(tail.map(substitute), profile) };
  }
  const profileArgs = wanted && Array.isArray(terminal.profileArgs) ? terminal.profileArgs : [];
  return {
    command: terminal.command,
    args: [...(terminal.args ?? []), ...profileArgs, ...tail].map(substitute),
  };
}
```

и в `planLaunchNew` пробросить `terminal`:

```js
function planLaunchNew({ launchNew, cwd, name, profile, terminal }) {
  return planWtLaunch({ launch: launchNew, vars: { cwd, name }, profile, terminal });
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS — вместе со старыми тестами `planWtLaunch` и `planRestore`,
которые `terminal` не передают и обязаны вести себя как прежде.

- [ ] **Step 5: Закоммитить**

```bash
git add src/claude-wt/project-helpers.js src/claude-wt/project-helpers.test.js
git commit -m "feat(claude-wt): команда собирается из реестра терминалов сложением"
```

---

### Task 4: Просьба доносит имя терминала до запуска

**Files:**
- Modify: `src/commands/claude-commands.js:207-247` (разбор поля `terminal`)
- Modify: `src/claude-wt/project.js:145-160` (выбор терминала и профиля)
- Modify: `src/claude-wt/restore.js:55-70,176-190` (терминал по умолчанию машины)
- Modify: `src/claude-wt/restore-helpers.js:40-60` (проброс `terminal` в план)
- Modify: `src/commands/claude-commands.test.js`
- Modify: `src/claude-wt/restore-helpers.test.js`

**Interfaces:**
- Consumes: `resolveTerminal`, `isLegacyLaunch` (Task 1),
  `profileForTerminal` (Task 2), `planWtLaunch`/`planLaunchNew` с полем
  `terminal` (Task 3).
- Produces: `openClaudeProject({cwd, name, profile, reuseOpen, terminal})` —
  один объект-аргумент, как сейчас, плюс необязательный ключ `terminal`
  (имя из просьбы).

- [ ] **Step 1: Написать падающий тест**

В `src/commands/claude-commands.test.js` дописать. Зависимости собираются
готовой `deps()` из шапки файла, команды — `claudeCommands(d)`; проверяется
мок `d.winMan.openClaudeProject` — тем же способом, что и соседние тесты
`claude-session-open`:

```js
describe('claude-session-open: имя терминала', () => {
  it('terminal из просьбы доезжает до openClaudeProject', async () => {
    const d = deps({ winMan: { claudeWtSessions: vi.fn().mockReturnValue({ ok: true, sessions: [] }) } });
    await claudeCommands(d)['claude-session-open']({
      action: 'terminal', cwd: 'D:\\p\\site', terminal: 'wezterm',
    });
    expect(d.winMan.openClaudeProject).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: 'D:\\p\\site', terminal: 'wezterm' }),
    );
  });

  it('без поля terminal ключа в просьбе нет вовсе', async () => {
    const d = deps({ winMan: { claudeWtSessions: vi.fn().mockReturnValue({ ok: true, sessions: [] }) } });
    await claudeCommands(d)['claude-session-open']({ action: 'terminal', cwd: 'D:\\p\\site' });
    const [opts] = d.winMan.openClaudeProject.mock.calls[0];
    expect('terminal' in opts).toBe(false);
  });
});
```

Пустой список сессий здесь обязателен: с сессией по умолчанию просьба ушла бы
в ветку подъёма окна и до `openClaudeProject` не дошла.

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/commands/claude-commands.test.js -t "имя терминала"`
Expected: FAIL — `opts.terminal` не определён.

- [ ] **Step 3: Разобрать поле в обработчике**

В `src/commands/claude-commands.js` в `claude-session-open`:

```js
      const { id, action, cwd, name, terminal } = parseIdPayload(payload);
```

и ниже, там же, где считается `asked`:

```js
      // Имя терминала из просьбы. Пикер называет то, что выбрано у него;
      // пусто — берётся дефолт машины. Проверять имя здесь нечем и незачем:
      // реестр знает менеджер, и он же скажет в лог, если имя чужое.
      const wantedTerminal = typeof terminal === 'string' ? terminal.trim() : '';
```

и пробросить в оба вызова:

```js
        await openProject(dir, asked, { reuseOpen: false, terminal: wantedTerminal });
```
```js
        await openProject(dir, asked, { terminal: wantedTerminal });
```

Сам `openProject` (`src/commands/claude-commands.js:94`) — местная обёртка над
`winMan.openClaudeProject`, и ключ она обязана класть только когда он есть, по
тому же правилу, по которому там уже не кладётся `reuseOpen: true`: лишний
ключ пришлось бы дописать в каждый существующий тест, ничего этим не проверив.

```js
  async function openProject(cwd, name, { reuseOpen = true, terminal = '' } = {}) {
    const opts = { cwd, name: name || basenameOfCwd(cwd) };
    if (!reuseOpen) opts.reuseOpen = false;
    if (terminal) opts.terminal = terminal;
```

- [ ] **Step 4: Выбрать терминал при запуске**

В `src/claude-wt/project.js` в `openClaudeProject` заменить блок сборки
команды на:

```js
  const cfg = getClaudeWtConfig();
  const legacy = isLegacyLaunch(cfg);
  if (legacy && !cfg.launchNew?.command) {
    return { ok: false, reason: 'claudeWt.launchNew.command is not set in config' };
  }
  const chosen = legacy ? { name: 'wt', entry: null, fallback: false } : resolveTerminal(terminal, cfg);
  if (chosen.fallback && terminal) {
    console.error(`[claude-wt] terminal ${terminal} is not in claudeWt.terminals, using ${chosen.name}`);
  }
  if (legacy && terminal) {
    console.error('[claude-wt] claudeWt.launch.command is set: config is legacy, terminal choice is ignored');
  }
  const effectiveProfile = profile ?? profileForTerminal(cwd, chosen.name, cfg);
  const { command, args } = planLaunchNew({
    launchNew: cfg.launchNew,
    cwd,
    name: sessionName,
    profile: effectiveProfile,
    terminal: chosen.entry,
  });
  if (!command) {
    return { ok: false, reason: 'claudeWt: терминал не назван ни просьбой, ни конфигом' };
  }
```

Сигнатура (`src/claude-wt/project.js:111`) расширяется одним ключом:

```js
async function openClaudeProject({ cwd, name, profile, reuseOpen = true, terminal } = {}) {
```

Импорты дописать: `isLegacyLaunch`, `resolveTerminal` из
`./terminal-helpers.js`, `profileForTerminal` из `./project-helpers.js`.

- [ ] **Step 5: Восстановление берёт дефолт машины**

В `src/claude-wt/restore.js` обе проверки `if (!cfg.launch.command)` заменить на
проверку, что терминал разрешим:

```js
  const chosen = isLegacyLaunch(cfg) ? { name: 'wt', entry: null } : resolveTerminal('', cfg);
  const command = chosen.entry?.command ?? cfg.launch.command;
  if (!command) {
    console.error('[claude-wt] нечем открывать: ни claudeWt.terminals, ни claudeWt.launch.command');
    return { restored, skipped: [] };
  }
```

(во второй ветке `skipped` собирается из снимка, как сейчас — оставить как
есть), и передать терминал и имя в план:

```js
  const resolveProfile = cwd => profileForTerminal(cwd, chosen.name, cfg);
  const fullPlan = planRestore({ state, launch: cfg.launch, sessionIds, resolveProfile, terminal: chosen.entry });
```

В `src/claude-wt/restore-helpers.js` в `planRestore` и `planSnapshotRestore`
принять `terminal` и передать его в `planWtLaunch`:

```js
      const planned = planWtLaunch({
        launch,
        vars: { id: sessionId },
        profile: resolve(slot.cwd ?? ''),
        terminal,
      });
```

- [ ] **Step 6: Сторож восстановления**

В `src/claude-wt/restore-helpers.test.js` дописать:

```js
it('план восстановления берёт команду из реестра, а не из launch', () => {
  const state = { lastLayout: ['s1'], slots: { s1: { titles: ['t'], bounds: {}, cwd: 'C:\\a' } } };
  const [item] = planRestore({
    state,
    launch: { args: ['ssh', 'ccfzf --session {id}'] },
    terminal: { command: 'wezterm-gui.exe', args: ['start', '--'] },
  });
  expect(item.command).toBe('wezterm-gui.exe');
  expect(item.args).toEqual(['start', '--', 'ssh', 'ccfzf --session s1']);
});
```

- [ ] **Step 7: Прогнать всё и закоммитить**

Run: `npm test && npm run lint`
Expected: PASS.

```bash
git add src/commands/claude-commands.js src/commands/claude-commands.test.js \
        src/claude-wt/project.js src/claude-wt/restore.js \
        src/claude-wt/restore-helpers.js src/claude-wt/restore-helpers.test.js
git commit -m "feat(claude-wt): терминал из просьбы главнее дефолта машины"
```

---

### Task 5: Окно WezTerm тоже терминал

**Files:**
- Modify: `src/claude-wt/daemon-helpers.js:49-51` (`isTerminalPath`)
- Modify: `src/claude-wt/daemon-helpers.test.js:82-92`
- Modify: `src/claude-wt/index.js:49-51` (`isTerminalWindow`)
- Modify: `config.example.cjs`

**Interfaces:**
- Consumes: `CLAUDE_WT_DEFAULTS` (Task 1) — рядом заводится
  `terminalExecutables`.
- Produces: `isTerminalPath(path: string, executables?: string[]): boolean`.

- [ ] **Step 1: Написать падающий тест**

В `src/claude-wt/daemon-helpers.test.js` в блоке `isTerminalPath` дописать:

```js
  it('окно WezTerm — тоже терминал', () => {
    expect(isTerminalPath('C:\\Program Files\\WezTerm\\wezterm-gui.exe')).toBe(true);
  });

  it('список исполняемых можно переопределить конфигом', () => {
    expect(isTerminalPath('C:\\x\\alacritty.exe', ['alacritty.exe'])).toBe(true);
    expect(isTerminalPath('C:\\x\\WindowsTerminal.exe', ['alacritty.exe'])).toBe(false);
  });

  it('почти совпавшее имя терминалом не считается', () => {
    expect(isTerminalPath('C:\\x\\wezterm-gui-helper.exe')).toBe(false);
  });
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/claude-wt/daemon-helpers.test.js -t isTerminalPath`
Expected: FAIL — WezTerm не признан терминалом.

- [ ] **Step 3: Реализовать**

В `src/claude-wt/daemon-helpers.js` заменить `isTerminalPath` на:

```js
/**
 * Окно терминала — по имени исполняемого файла.
 *
 * Список, а не регулярка по одному имени: терминалов теперь два, и оба обязаны
 * опознаваться. Не опознанное окно трекер терминалом не считает вовсе — сессия
 * откроется, но пропадёт из списка: ни пометки окна, ни фокуса, ни привязки.
 * Сверяется имя целиком, поэтому `WindowsTerminalHelper.exe` мимо.
 */
function isTerminalPath(path, executables = TERMINAL_EXECUTABLES) {
  const name = String(path ?? '').split(/[\\/]/).pop() ?? '';
  if (!name) return false;
  return executables.some(exe => exe.toLowerCase() === name.toLowerCase());
}
```

и рядом, до неё:

```js
const TERMINAL_EXECUTABLES = ['WindowsTerminal.exe', 'wezterm-gui.exe'];
```

Добавить `TERMINAL_EXECUTABLES` в экспорт файла и в `CLAUDE_WT_DEFAULTS`:

```js
  // Чьи окна считать окнами терминала. Пусто — встроенный список.
  terminalExecutables: [],
```

а в `mergeClaudeWtConfig`:

```js
    terminalExecutables: Array.isArray(cfg.terminalExecutables) && cfg.terminalExecutables.length
      ? cfg.terminalExecutables.map(String)
      : [...TERMINAL_EXECUTABLES],
```

- [ ] **Step 4: Прокинуть конфиг в опознание**

В `src/claude-wt/index.js`:

```js
function isTerminalWindow(w) {
  return isTerminalPath(w?.path, getClaudeWtConfig().terminalExecutables);
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 6: Показать в примере конфига и закоммитить**

В `config.example.cjs` рядом с `terminals`:

```js
    // Чьи окна считать окнами терминала. Пусто — WindowsTerminal.exe и
    // wezterm-gui.exe.
    terminalExecutables: [],
```

```bash
git add src/claude-wt/daemon-helpers.js src/claude-wt/daemon-helpers.test.js \
        src/claude-wt/index.js config.example.cjs
git commit -m "feat(claude-wt): окном терминала считается и WezTerm"
```

---

### Task 6: Выкатка и живая проверка

**Files:**
- Modify: `%APPDATA%\windows-mqtt\windows11-manager.config.js` на popstas-pc
  (не в репозитории — правится по ssh, с бэкапом)

**Interfaces:**
- Consumes: всё выше.
- Produces: работающая на живой машине пара wt + WezTerm.

- [ ] **Step 1: Открыть PR и выкатить ветку**

```bash
git push -u origin <branch>
gh pr create --fill --base master
```

Выкатить на popstas-pc тем способом, каким этот репозиторий выкатывается
(см. его `CLAUDE.md` / `AGENTS.md`), и перезапустить менеджер.

- [ ] **Step 2: Проверить, что старый конфиг не сломался**

До правки конфига: открыть сессию из пикера Enter'ом. Ожидание — Windows
Terminal, как и раньше, плюс строка в логе о том, что конфиг старый и выбор
терминала не действует.

- [ ] **Step 3: Переписать конфиг на новую форму**

Сделать бэкап (`windows11-manager.config.js.bak`), затем:
- убрать `command` из `launch` и `launchNew`;
- вынести терминальный префикс (`-w -1`) из их `args` — в `args` остаётся
  только ssh-хвост;
- добавить `terminal: 'wt'` и, если нужны свои пути, `terminals`;
- заменить `profile: '…'` у проектов на `profiles: { wt: '…' }` (можно
  оставить как есть — старое поле читается).

- [ ] **Step 4: Живая проверка по каждому терминалу**

Перезапустить менеджер и проверить обе стороны:
- в пикере выбран пресет Windows Terminal → Enter поднимает сессию в wt, `^N`
  заводит новую с профилем проекта;
- в пикере выбран пресет WezTerm → Enter поднимает сессию в WezTerm; окно
  видно трекеру (▣ в списке пикера), повторный Enter поднимает это окно, а не
  открывает второе.

- [ ] **Step 5: Дописать в PR результат живой проверки и позвать человека**

Отметить в описании PR, что проверено на popstas-pc и чем именно; merge и
релиз — только после его слова.
