import { describe, it, expect } from 'vitest';
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
  applyPendingUnread,
  desktopRelearnTarget,
  desktopFollowTarget,
  relearnedDesktop,
  FOLLOW_GRACE_MS,
} from './daemon-helpers.js';
import { TERMINAL_DEFAULTS } from './terminal-helpers.js';

describe('mergeClaudeWtConfig', () => {
  it('returns the defaults for a missing block', () => {
    // terminals в CLAUDE_WT_DEFAULTS пуст намеренно (умолчания живут в
    // terminal-helpers.js), а слияние всегда разворачивает его до реестра —
    // поэтому сверяем не с самим CLAUDE_WT_DEFAULTS, а с ним же плюс реестр.
    const expected = { ...CLAUDE_WT_DEFAULTS, terminals: TERMINAL_DEFAULTS };
    expect(mergeClaudeWtConfig(undefined)).toEqual(expected);
    expect(mergeClaudeWtConfig(null)).toEqual(expected);
  });

  it('overrides only the keys that were given', () => {
    const cfg = mergeClaudeWtConfig({ interval: 2000 });
    expect(cfg.interval).toBe(2000);
    expect(cfg.stableTicks).toBe(CLAUDE_WT_DEFAULTS.stableTicks);
  });

  it('normalizes configured projects', () => {
    const cfg = mergeClaudeWtConfig({
      projects: [
        { name: 'home', cwd: '/p/home', hotkey: ' Ctrl+F11 ', profile: ' home ' },
        { name: 'missing-cwd' },
      ],
    });
    expect(cfg.projects).toEqual([
      { name: 'home', cwd: '/p/home', hotkey: 'Ctrl+F11', profile: 'home' },
    ]);
  });

  it('merges the nested launch and restore blocks instead of replacing them', () => {
    // Задать один windowTimeoutMs, не продублировав auto, должно быть можно.
    const cfg = mergeClaudeWtConfig({
      launch: { args: ['-w', '-1'] },
      restore: { windowTimeoutMs: 5000 },
    });
    expect(cfg.launch).toEqual({ command: 'wt.exe', args: ['-w', '-1'] });
    expect(cfg.restore).toEqual({
      auto: false, windowTimeoutMs: 5000, launchDelayMs: 2000, settleMs: 500,
    });
  });

  it('merges launchNew the same way as launch', () => {
    const cfg = mergeClaudeWtConfig({
      launchNew: { args: ['ssh', '-t', "cd '{cwd}' && claude -n '{name}'"] },
    });
    expect(cfg.launchNew).toEqual({
      command: 'wt.exe',
      args: ['ssh', '-t', "cd '{cwd}' && claude -n '{name}'"],
    });
  });

  it('does not leak edits back into the defaults', () => {
    mergeClaudeWtConfig({}).launch.args.push('mutated');
    mergeClaudeWtConfig({}).launchNew.args.push('mutated');
    mergeClaudeWtConfig({}).projects.push({ name: 'mutated', cwd: '/mutated' });
    expect(CLAUDE_WT_DEFAULTS.launch.args).toEqual([]);
    expect(CLAUDE_WT_DEFAULTS.launchNew.args).toEqual([]);
    expect(CLAUDE_WT_DEFAULTS.projects).toEqual([]);
  });
});

describe('умолчания реестра терминалов', () => {
  it('пустой конфиг даёт оба встроенных терминала и дефолт wt', () => {
    const cfg = mergeClaudeWtConfig({});
    expect(cfg.terminal).toBe('wt');
    expect(Object.keys(cfg.terminals).sort()).toEqual(['wezterm', 'wt']);
  });
});

describe('isTerminalPath', () => {
  it('matches Windows Terminal', () => {
    expect(isTerminalPath('C:\\Program Files\\WindowsApps\\wt\\WindowsTerminal.exe')).toBe(true);
    expect(isTerminalPath('c:/x/windowsterminal.exe')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isTerminalPath('C:\\Windows\\explorer.exe')).toBe(false);
    expect(isTerminalPath('C:\\x\\WindowsTerminalHelper.exe')).toBe(false);
    expect(isTerminalPath('')).toBe(false);
    expect(isTerminalPath(undefined)).toBe(false);
  });
});

describe('desktopOnlyActions', () => {
  const slots = { a1: { desktop: 2 }, b2: { desktop: null } };
  const tracked = (over = {}) => ({ id: 1, sessionId: 'a1', stableTitle: 'ccfzf', ...over });
  // Окно, вышедшее из сессии: заголовок устоялся на приглашении шелла.
  const atShell = (over = {}) => tracked({ sessionId: null, stableTitle: 'x@y: ~', ...over });

  it('returns the desktop of a session entered in a window that needs no move', () => {
    // step() подавляет action, когда координаты уже совпадают, и вместе с ним
    // теряется номер стола: окно на месте, но на чужом столе, назад не вернётся.
    const out = desktopOnlyActions({
      prevWindows: [atShell()],
      nextWindows: [tracked()],
      slots,
      actions: [],
    });
    expect(out).toEqual([{ windowId: 1, desktop: 2 }]);
  });

  it('stays out of the way when step already emitted a move for that window', () => {
    const out = desktopOnlyActions({
      prevWindows: [atShell()],
      nextWindows: [tracked()],
      slots,
      actions: [{ windowId: 1, bounds: {}, desktop: 2 }],
    });
    expect(out).toEqual([]);
  });

  it('ignores a window that was already bound to the same session', () => {
    const out = desktopOnlyActions({
      prevWindows: [tracked()],
      nextWindows: [tracked()],
      slots,
      actions: [],
    });
    expect(out).toEqual([]);
  });

  it('ignores windows the tracker saw for the first time this tick', () => {
    const out = desktopOnlyActions({
      prevWindows: [],
      nextWindows: [tracked()],
      slots,
      actions: [],
    });
    expect(out).toEqual([]);
  });

  it('ignores a window whose title had not settled yet on the previous tick', () => {
    // Перезапуск демона: на первом тике заголовок ещё не устоялся, на втором
    // окно разом сообщает о привязке. Растащить всё открытое по рабочим столам
    // — совсем не то, чего ждут от перезапуска; на живом прогоне так и уехало
    // окно b2b-kpi со стола 1 на стол 2.
    const out = desktopOnlyActions({
      prevWindows: [tracked({ sessionId: null, stableTitle: null })],
      nextWindows: [tracked()],
      slots,
      actions: [],
    });
    expect(out).toEqual([]);
  });

  it('ignores a slot with no remembered desktop', () => {
    const out = desktopOnlyActions({
      prevWindows: [atShell()],
      nextWindows: [tracked({ sessionId: 'b2' })],
      slots,
      actions: [],
    });
    expect(out).toEqual([]);
  });

  it('ignores an unbound window', () => {
    const out = desktopOnlyActions({
      prevWindows: [tracked()],
      nextWindows: [atShell()],
      slots,
      actions: [],
    });
    expect(out).toEqual([]);
  });
});

describe('layoutFingerprint', () => {
  const state = { version: 1, slots: { a1: { titles: ['x'] } }, lastLayout: ['a1'], updated: 100 };

  it('ignores the updated stamp', () => {
    // Иначе дедупликация записи не работает вообще: updated меняется каждый тик,
    // и демон переписывал бы файл раз в секунду.
    expect(layoutFingerprint(state)).toBe(layoutFingerprint({ ...state, updated: 999 }));
  });

  it('changes when a slot changes', () => {
    expect(layoutFingerprint(state)).not.toBe(
      layoutFingerprint({ ...state, slots: { a1: { titles: ['y'] } } }));
  });

  it('changes when the layout changes', () => {
    expect(layoutFingerprint(state)).not.toBe(layoutFingerprint({ ...state, lastLayout: [] }));
  });
});

describe('unresolvedTitles', () => {
  it('lists settled titles that were not attributed to a session', () => {
    const out = unresolvedTitles([
      { id: 1, stableTitle: 'ccfzf', sessionId: 'a1' },
      { id: 2, stableTitle: 'popstas@pc-virt: ~', sessionId: null },
      { id: 3, stableTitle: null, sessionId: null },
    ]);
    expect(out).toEqual(['popstas@pc-virt: ~']);
  });

  it('reports a title shared by two windows only once', () => {
    const out = unresolvedTitles([
      { id: 1, stableTitle: 'same', sessionId: null },
      { id: 2, stableTitle: 'same', sessionId: null },
    ]);
    expect(out).toEqual(['same']);
  });
});

describe('focusedSessionIds', () => {
  const windows = [
    { id: 1, sessionId: 'alpha' },
    { id: 2, sessionId: 'beta' },
    { id: 3, sessionId: null },
  ];
  const slots = {
    alpha: { titles: ['work'] },
    beta: { titles: ['other'] },
    'alpha-old': { titles: ['work'] },
    'alpha-older': { titles: ['work'] },
  };

  it('names the session whose window just came to the front', () => {
    expect(focusedSessionIds({ activeWindowId: 2, prevActiveWindowId: 1, windows, slots }))
      .toEqual(['beta']);
  });

  it('marks every slot that shares the focused title', () => {
    // The same work reopened leaves a slot per session id, but only one window
    // with that title is ever on screen — the one being looked at. Leaving the
    // twins out would keep them orange forever.
    expect(focusedSessionIds({ activeWindowId: 1, prevActiveWindowId: 0, windows, slots }).sort())
      .toEqual(['alpha', 'alpha-old', 'alpha-older']);
  });

  it('falls back to the session alone when its slot has no title', () => {
    expect(focusedSessionIds({ activeWindowId: 1, prevActiveWindowId: 0, windows, slots: { alpha: {} } }))
      .toEqual(['alpha']);
  });

  it('stays silent while the same window keeps the focus', () => {
    // Stamping every tick would rewrite the state file once a second for as
    // long as the window sits in front: layoutFingerprint() covers the slots
    // whole, so every stamp is a disk write.
    expect(focusedSessionIds({ activeWindowId: 2, prevActiveWindowId: 2, windows, slots })).toEqual([]);
  });

  it('ignores a window that belongs to no session', () => {
    expect(focusedSessionIds({ activeWindowId: 3, prevActiveWindowId: 1, windows, slots })).toEqual([]);
  });

  it('ignores a foreground window the tracker does not follow', () => {
    expect(focusedSessionIds({ activeWindowId: 99, prevActiveWindowId: 1, windows, slots })).toEqual([]);
  });

  it('ignores an empty foreground handle', () => {
    // GetForegroundWindow returns 0 when the foreground is being handed over.
    expect(focusedSessionIds({ activeWindowId: 0, prevActiveWindowId: 1, windows, slots })).toEqual([]);
  });
});

describe('desktopRelearnTarget', () => {
  const windows = [
    { id: 1, sessionId: 'alpha' },
    { id: 2, sessionId: 'beta' },
    { id: 3, sessionId: null },
  ];
  const slots = {
    alpha: { titles: ['work'], desktop: 2 },
    beta: { titles: ['other'], desktop: null },
    'alpha-old': { titles: ['work'], desktop: 2 },
  };

  it('называет окно, которое только что вышло вперёд', () => {
    expect(desktopRelearnTarget({ activeWindowId: 1, prevActiveWindowId: 9, windows, slots }))
      .toEqual({ windowId: 1, sessionId: 'alpha' });
  });

  it('молчит, пока окно остаётся впереди', () => {
    // Чтение спавнит VirtualDesktop11.exe: раз на переход, а не раз в секунду.
    expect(desktopRelearnTarget({ activeWindowId: 1, prevActiveWindowId: 1, windows, slots }))
      .toBeNull();
  });

  it('не трогает слот, у которого номер стола ещё не читали', () => {
    // Это работа bindings; двойное чтение на одном тике ничего не добавит.
    expect(desktopRelearnTarget({ activeWindowId: 2, prevActiveWindowId: 1, windows, slots }))
      .toBeNull();
  });

  it('переучивает только своё окно, не близнецов по заголовку', () => {
    // Отметку «просмотрено» близнецы делят, а стол — нет: два окна с одним
    // заголовком законно живут на разных столах, и чужой номер затёр бы их.
    const out = desktopRelearnTarget({ activeWindowId: 1, prevActiveWindowId: 9, windows, slots });
    expect(out.sessionId).toBe('alpha');
  });

  it('пропускает окно без сессии, чужое окно и пустой хэндл', () => {
    expect(desktopRelearnTarget({ activeWindowId: 3, prevActiveWindowId: 1, windows, slots })).toBeNull();
    expect(desktopRelearnTarget({ activeWindowId: 99, prevActiveWindowId: 1, windows, slots })).toBeNull();
    expect(desktopRelearnTarget({ activeWindowId: 0, prevActiveWindowId: 1, windows, slots })).toBeNull();
  });
});

describe('desktopFollowTarget', () => {
  const base = { activeWindowId: 7, startedAt: 1000, nowMs: 1000 + FOLLOW_GRACE_MS + 1 };

  it('уводит вслед за окном, с которым человек работает', () => {
    const moves = [{ windowId: 7, desktop: 2 }];
    expect(desktopFollowTarget({ ...base, moves })).toBe(2);
  });

  it('не трогает вид, когда уехало фоновое окно', () => {
    // Чужое окно, уносимое на свой стол, — не повод выдёргивать человека с
    // того стола, где он сейчас работает.
    const moves = [{ windowId: 8, desktop: 2 }];
    expect(desktopFollowTarget({ ...base, moves })).toBeNull();
  });

  it('молчит на переносе без стола и на пустом списке', () => {
    expect(desktopFollowTarget({ ...base, moves: [{ windowId: 7 }] })).toBeNull();
    expect(desktopFollowTarget({ ...base, moves: [] })).toBeNull();
  });

  it('молчит первые секунды после старта демона', () => {
    // На перезапуске каждое открытое окно привязывается заново и часть из них
    // едет на свой стол; переключать вид на последнее из них — не то, что
    // должен делать поднявшийся трекер позиций.
    const moves = [{ windowId: 7, desktop: 2 }];
    expect(desktopFollowTarget({ ...base, moves, nowMs: 1000 + FOLLOW_GRACE_MS - 1 })).toBeNull();
  });

  it('молчит, когда переднего окна нет', () => {
    const moves = [{ windowId: 0, desktop: 2 }];
    expect(desktopFollowTarget({ ...base, moves, activeWindowId: 0 })).toBeNull();
  });

  it('берёт последний перенос своего окна, если их было несколько', () => {
    const moves = [{ windowId: 7, desktop: 2 }, { windowId: 8, desktop: 1 }, { windowId: 7, desktop: 3 }];
    expect(desktopFollowTarget({ ...base, moves })).toBe(3);
  });
});

describe('relearnedDesktop', () => {
  it('переводит 0-based ответ VirtualDesktop11 в номер слота', () => {
    expect(relearnedDesktop('0')).toBe(1);
    expect(relearnedDesktop(1)).toBe(2);
  });

  it('молчит, когда номер прочитать не удалось', () => {
    // vd11Command отдаёт undefined на непрочитанный вывод и null на stderr —
    // ни то, ни другое не должно затирать запомненный стол нулём или NaN.
    expect(relearnedDesktop(undefined)).toBeNull();
    expect(relearnedDesktop(null)).toBeNull();
    expect(relearnedDesktop('')).toBeNull();
    expect(relearnedDesktop('boom')).toBeNull();
  });
});

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

  it('не запущен — возраста нет', () => {
    // stopClaudeWt() обнуляет startedAt, и разница с началом эпохи давала в
    // логе сторожа «последний тик 1785000000s назад».
    const h = claudeWtHealth({ ...base, running: false, lastTickAt: 0, startedAt: 0 });
    expect(h.ageMs).toBe(0);
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

describe('isStaleTick', () => {
  it('тик своего поколения — свежий', () => {
    expect(isStaleTick(3, 3)).toBe(false);
  });

  it('тик, переживший перезапуск, — отставший', () => {
    // Зависший тик досчитывается после подъёма сторожем. Не отгородить его —
    // и он запишет дореcтартовое состояние поверх нового, а заодно отметит
    // успешный тик новому поколению, после чего сторож ослепнет навсегда.
    expect(isStaleTick(3, 4)).toBe(true);
  });

  it('ручной тик без поколения не отгораживается', () => {
    expect(isStaleTick(null, 7)).toBe(false);
  });
});

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

describe('applyPendingUnread', () => {
  const slots = {
    alpha: { titles: ['work'], cwd: '/a', bounds: null, desktop: null, focusedAt: 100, lastSeen: 5 },
    beta: { titles: ['other'], cwd: '/b', bounds: null, desktop: null, focusedAt: 200, lastSeen: 9 },
  };

  it('stamps focusedAt on a slot that made it into the map the tick carries out', () => {
    const next = applyPendingUnread(slots, { alpha: 42 });
    expect(next.alpha.focusedAt).toBe(42);
  });

  it('ignores an id that fell out of the slots the tick is about to keep', () => {
    const next = applyPendingUnread(slots, { gamma: 1 });
    expect(next).toEqual(slots);
  });

  it('returns the same slots when nothing is pending', () => {
    expect(applyPendingUnread(slots, {})).toBe(slots);
  });

  it('leaves the rest of the slot and neighbouring slots untouched', () => {
    const next = applyPendingUnread(slots, { alpha: 42 });
    expect(next.alpha).toEqual({ ...slots.alpha, focusedAt: 42 });
    expect(next.beta).toBe(slots.beta);
  });
});
