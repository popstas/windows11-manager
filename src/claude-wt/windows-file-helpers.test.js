import { describe, it, expect } from 'vitest';
import {
  WINDOWS_FILE_HEARTBEAT_MS,
  buildWindowsFile,
  windowsFingerprint,
  shouldWriteWindowsFile,
} from './windows-file-helpers.js';

const WINDOWS = [
  { id: 11, title: 'ccfzf-picker', sessionId: 'aaa', app: 'WindowsTerminal.exe' },
  { id: 12, title: 'shell', sessionId: null, app: 'WindowsTerminal.exe' },
  { id: 13, title: 'notes', sessionId: 'bbb', app: 'wezterm-gui.exe' },
];

const SLOTS = {
  aaa: { titles: ['ccfzf-picker'], desktop: 2, lastSeen: 1700, focusedAt: 1650 },
  bbb: { titles: ['notes'], desktop: null, lastSeen: 1690 },
  // Сессия, чьё окно закрыли: слот остался, окна нет.
  ccc: { titles: ['gone'], desktop: 1, lastSeen: 900 },
};

describe('buildWindowsFile', () => {
  it('publishes only sessions that have a window right now', () => {
    const out = buildWindowsFile({
      windows: WINDOWS, slots: SLOTS, host: 'pc', pid: 42, nowMs: 1_800_000,
    });
    expect(Object.keys(out.windows).sort()).toEqual(['aaa', 'bbb']);
  });

  it('takes the title from the window and the desktop from the slot', () => {
    const out = buildWindowsFile({
      windows: WINDOWS, slots: SLOTS, host: 'pc', pid: 42, nowMs: 1_800_000,
    });
    expect(out.windows.aaa).toEqual({
      title: 'ccfzf-picker', desktop: 2, lastSeen: 1700, focusedAt: 1650,
      app: 'WindowsTerminal.exe', minimized: false,
    });
  });

  // Отметка «человек посмотрел на это окно» едет читателю на другой машине: у
  // него своей нет вовсе, а без неё его список продолжает звать к сессии, на
  // которую уже сходили.
  it('carries focusedAt from the slot, zero when the slot never had focus', () => {
    const out = buildWindowsFile({
      windows: WINDOWS, slots: SLOTS, host: 'pc', pid: 42, nowMs: 1_800_000,
    });
    expect(out.windows.aaa.focusedAt).toBe(1650);
    expect(out.windows.bbb.focusedAt).toBe(0);
  });

  // Читатель различает терминалы в строке поимённо, и узнать их имя ему
  // неоткуда: окон он не видит. Одной пометки «окно есть» не хватает — на этой
  // машине рядом живут Windows Terminal и WezTerm.
  it('names the terminal of each window, and stays empty when it is unknown', () => {
    const out = buildWindowsFile({
      windows: WINDOWS, slots: SLOTS, host: 'pc', pid: 42, nowMs: 1_800_000,
    });
    expect(out.windows.aaa.app).toBe('WindowsTerminal.exe');
    expect(out.windows.bbb.app).toBe('wezterm-gui.exe');
    const older = buildWindowsFile({
      windows: [{ title: 'x', sessionId: 'aaa' }], slots: SLOTS, host: 'pc', pid: 42, nowMs: 0,
    });
    expect(older.windows.aaa.app).toBe('');
  });

  // Свёрнутость окна знает только трекер: у читателя окон нет вовсе, а нужна
  // она ему затем, чтобы гасить строку и не звать её в раскладку. Правило
  // свёрнутости здесь не своё, а то же самое, по которому её пропускает сам
  // тик (`isMinimized` в tracker-helpers): вторая копия разошлась бы с первой
  // молча — трекер продолжал бы игнорировать окно при расстановке, а список у
  // читателя показывал бы его обычным.
  it('publishes whether the window is minimized, by the tracker rule', () => {
    const windows = [
      { title: 'hidden', sessionId: 'aaa', bounds: { x: -32000, y: -32000, width: 800, height: 600 } },
      { title: 'shown', sessionId: 'bbb', bounds: { x: 100, y: 100, width: 800, height: 600 } },
    ];
    const out = buildWindowsFile({ windows, slots: SLOTS, host: 'pc', pid: 1, nowMs: 0 });
    expect(out.windows.aaa.minimized).toBe(true);
    expect(out.windows.bbb.minimized).toBe(false);
  });

  // Окно без границ приходит из тестов и из старого состояния; «не знаю» обязано
  // читаться как «окно обычное»: гашёная строка у открытого окна дороже, чем
  // негашёная у свёрнутого.
  it('reads a window without bounds as an ordinary one', () => {
    const out = buildWindowsFile({
      windows: [{ title: 'x', sessionId: 'aaa' }], slots: SLOTS, host: 'pc', pid: 1, nowMs: 0,
    });
    expect(out.windows.aaa.minimized).toBe(false);
  });

  it('carries host, pid and a generated stamp in seconds', () => {
    const out = buildWindowsFile({
      windows: [], slots: {}, host: 'pc', pid: 42, nowMs: 1_800_500,
    });
    expect(out).toEqual({ host: 'pc', pid: 42, generated: 1800, windows: {}, snapshots: [], projects: [] });
  });

  it('survives a window whose session has no slot yet', () => {
    const out = buildWindowsFile({
      windows: [{ title: 'fresh', sessionId: 'zzz' }], slots: {}, host: 'pc', pid: 1, nowMs: 0,
    });
    expect(out.windows.zzz).toEqual({
      title: 'fresh', desktop: null, lastSeen: 0, focusedAt: 0, app: '', minimized: false,
    });
  });

  it('survives missing windows and slots', () => {
    expect(buildWindowsFile({ host: 'pc', pid: 1, nowMs: 0 }).windows).toEqual({});
  });
});

describe('windowsFingerprint', () => {
  it('ignores the order of sessions', () => {
    const a = { one: { desktop: 1, title: 'x' }, two: { desktop: 2, title: 'y' } };
    const b = { two: { desktop: 2, title: 'y' }, one: { desktop: 1, title: 'x' } };
    expect(windowsFingerprint(a)).toBe(windowsFingerprint(b));
  });

  it('notices a moved desktop, a renamed window and a closed one', () => {
    const base = { one: { desktop: 1, title: 'x' } };
    expect(windowsFingerprint({ one: { desktop: 2, title: 'x' } })).not.toBe(windowsFingerprint(base));
    expect(windowsFingerprint({ one: { desktop: 1, title: 'y' } })).not.toBe(windowsFingerprint(base));
    expect(windowsFingerprint({})).not.toBe(windowsFingerprint(base));
  });

  // Иначе взгляд на окно доезжал бы до читателя только сердцебиением, раз в
  // тридцать секунд: кружок в чужом списке гас бы через полминуты после того,
  // как на сессию сходили, а возврат в непрочитанное — столько же держался бы
  // погашенным.
  it('notices a fresh focus stamp', () => {
    const base = { one: { desktop: 1, title: 'x', focusedAt: 100 } };
    expect(windowsFingerprint({ one: { desktop: 1, title: 'x', focusedAt: 200 } }))
      .not.toBe(windowsFingerprint(base));
  });

  // Без этого свёрнутое окно доезжало бы до читателя только сердцебиением, до
  // тридцати секунд: человек убрал окно в панель задач, а строка в чужом
  // списке ещё полминуты стоит яркой.
  it('notices a window that has just been minimized', () => {
    const base = { one: { desktop: 1, title: 'x', minimized: false } };
    expect(windowsFingerprint({ one: { desktop: 1, title: 'x', minimized: true } }))
      .not.toBe(windowsFingerprint(base));
  });

  it('does not confuse two layouts whose titles differ only by a space', () => {
    const a = { one: { desktop: 1, title: 'a b' }, two: { desktop: 1, title: 'c' } };
    const b = { one: { desktop: 1, title: 'a' }, two: { desktop: 1, title: 'b c' } };
    expect(windowsFingerprint(a)).not.toBe(windowsFingerprint(b));
  });
});

describe('shouldWriteWindowsFile', () => {
  const args = { fingerprint: 'x', lastFingerprint: 'x', lastWriteMs: 1000, nowMs: 2000 };

  it('writes the very first time', () => {
    expect(shouldWriteWindowsFile({ ...args, lastWriteMs: 0 })).toBe(true);
  });

  it('writes when the layout changed', () => {
    expect(shouldWriteWindowsFile({ ...args, fingerprint: 'y' })).toBe(true);
  });

  it('stays quiet while nothing changed', () => {
    expect(shouldWriteWindowsFile(args)).toBe(false);
  });

  it('writes anyway once the heartbeat is due', () => {
    const nowMs = 1000 + WINDOWS_FILE_HEARTBEAT_MS;
    expect(shouldWriteWindowsFile({ ...args, nowMs })).toBe(true);
    expect(shouldWriteWindowsFile({ ...args, nowMs: nowMs - 1 })).toBe(false);
  });
});

const SNAPSHOTS = [{
  id: 'snap-1',
  created: 1_700_000,
  sessions: [
    { id: 'aaa', title: 'ccfzf-picker', cwd: '/home/user/projects/js/ccfzf-picker',
      bounds: { x: 0, y: 0, width: 800, height: 600 }, desktop: 2, monitor: 0 },
    { id: 'ccc', title: 'gone', cwd: '/home/user/projects/js/notes',
      bounds: { x: 10, y: 10, width: 400, height: 300 }, desktop: 1, monitor: 1 },
  ],
}];

describe('buildWindowsFile — снимки', () => {
  it('кладёт снимки обрезанными: без bounds, desktop и monitor', () => {
    // Геометрия нужна только восстановлению, а оно живёт на этой же машине и
    // читает свой файл. Читателю она ехала бы в каждом тике --state, раз в
    // секунду.
    const out = buildWindowsFile({
      windows: WINDOWS, slots: SLOTS, host: 'pc', pid: 42,
      nowMs: 1_800_000, snapshots: SNAPSHOTS,
    });
    expect(out.snapshots).toEqual([{
      id: 'snap-1',
      created: 1_700_000,
      sessions: [
        { id: 'aaa', title: 'ccfzf-picker', cwd: '/home/user/projects/js/ccfzf-picker' },
        { id: 'ccc', title: 'gone', cwd: '/home/user/projects/js/notes' },
      ],
    }]);
  });

  it('без снимков поле есть и пустое', () => {
    // Ключ на месте всегда: читателю дешевле пустой массив, чем проверка на
    // отсутствие ключа при каждом использовании.
    const out = buildWindowsFile({
      windows: WINDOWS, slots: SLOTS, host: 'pc', pid: 42, nowMs: 1_800_000,
    });
    expect(out.snapshots).toEqual([]);
  });
});

describe('windowsFingerprint — снимки', () => {
  it('новый снимок меняет отпечаток', () => {
    // Иначе снимок доезжал бы до читателя только сердцебиением — до тридцати
    // секунд. Снимки редкие (debounce 60 с), лишних записей это не даёт.
    const windows = buildWindowsFile({
      windows: WINDOWS, slots: SLOTS, host: 'pc', pid: 42, nowMs: 1_800_000,
    }).windows;
    const before = windowsFingerprint(windows, []);
    const after = windowsFingerprint(windows, [{ id: 'snap-1', created: 1_700_000 }]);
    expect(after).not.toBe(before);
  });

  it('отпечаток без снимков совпадает с прежним', () => {
    // Второй аргумент необязателен: вызовов windowsFingerprint(windows) в
    // тестах и коде хватает, и все они должны остаться верными.
    const windows = buildWindowsFile({
      windows: WINDOWS, slots: SLOTS, host: 'pc', pid: 42, nowMs: 1_800_000,
    }).windows;
    expect(windowsFingerprint(windows, [])).toBe(windowsFingerprint(windows));
  });
});

describe('buildWindowsFile — projects', () => {
  // Хоткеи едут читателю на другую машину: единственный их источник — конфиг
  // здесь, а регистрирует клавиши ccfzf-picker там. Записи без хоткея не едут
  // вовсе — читателю они не говорят ничего, а список проектов он и так знает.
  it('publishes only projects that carry a hotkey', () => {
    const out = buildWindowsFile({
      windows: [], slots: {}, host: 'pc', pid: 42, nowMs: 0,
      projects: [
        { name: 'home', cwd: '/p/home', hotkey: 'Ctrl+F11', profile: 'home' },
        { name: 'plain', cwd: '/p/plain', profile: 'work' },
      ],
    });
    expect(out.projects).toEqual([{ cwd: '/p/home', name: 'home', hotkey: 'Ctrl+F11' }]);
  });

  // profile — знание про Windows Terminal на этой машине; читателю оно
  // бесполезно, а лишнее поле в чужом файле рано или поздно кто-нибудь прочтёт.
  it('does not leak the terminal profile to the reader', () => {
    const out = buildWindowsFile({
      windows: [], slots: {}, host: 'pc', pid: 42, nowMs: 0,
      projects: [{ name: 'home', cwd: '/p/home', hotkey: 'Ctrl+F11', profile: 'home' }],
    });
    expect(out.projects[0].profile).toBeUndefined();
  });

  // Ключ на месте всегда — читателю дешевле пустой массив, чем проверка на
  // отсутствие ключа при каждом использовании. То же правило, что у snapshots.
  it('keeps the key even with nothing to publish', () => {
    expect(buildWindowsFile({ host: 'pc', pid: 1, nowMs: 0 }).projects).toEqual([]);
  });
});

describe('windowsFingerprint — projects', () => {
  // Без этого смена хоткея в конфиге доезжала бы до читателя только
  // сердцебиением — до тридцати секунд, — а если расклад окон при этом не
  // менялся, то и вовсе ждала бы чужого движения.
  it('notices a changed hotkey', () => {
    const win = { one: { desktop: 1, title: 'x', focusedAt: 0 } };
    const a = [{ cwd: '/p/home', name: 'home', hotkey: 'Ctrl+F11' }];
    const b = [{ cwd: '/p/home', name: 'home', hotkey: 'Ctrl+F12' }];
    expect(windowsFingerprint(win, [], a)).not.toBe(windowsFingerprint(win, [], b));
  });

  it('notices a project that gained or lost its hotkey', () => {
    const win = { one: { desktop: 1, title: 'x', focusedAt: 0 } };
    const one = [{ cwd: '/p/home', name: 'home', hotkey: 'Ctrl+F11' }];
    expect(windowsFingerprint(win, [], [])).not.toBe(windowsFingerprint(win, [], one));
  });
});
