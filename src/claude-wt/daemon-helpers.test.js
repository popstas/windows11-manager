import { describe, it, expect } from 'vitest';
import {
  CLAUDE_WT_DEFAULTS,
  mergeClaudeWtConfig,
  isTerminalPath,
  desktopOnlyActions,
  layoutFingerprint,
  focusedSessionIds,
  unresolvedTitles,
} from './daemon-helpers.js';

describe('mergeClaudeWtConfig', () => {
  it('returns the defaults for a missing block', () => {
    expect(mergeClaudeWtConfig(undefined)).toEqual(CLAUDE_WT_DEFAULTS);
    expect(mergeClaudeWtConfig(null)).toEqual(CLAUDE_WT_DEFAULTS);
  });

  it('overrides only the keys that were given', () => {
    const cfg = mergeClaudeWtConfig({ interval: 2000 });
    expect(cfg.interval).toBe(2000);
    expect(cfg.stableTicks).toBe(CLAUDE_WT_DEFAULTS.stableTicks);
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

  it('does not leak edits back into the defaults', () => {
    mergeClaudeWtConfig({}).launch.args.push('mutated');
    expect(CLAUDE_WT_DEFAULTS.launch.args).toEqual([]);
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
