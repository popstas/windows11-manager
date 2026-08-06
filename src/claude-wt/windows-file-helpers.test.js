import { describe, it, expect } from 'vitest';
import {
  WINDOWS_FILE_HEARTBEAT_MS,
  buildWindowsFile,
  windowsFingerprint,
  shouldWriteWindowsFile,
} from './windows-file-helpers.js';

const WINDOWS = [
  { id: 11, title: 'ccfzf-picker', sessionId: 'aaa' },
  { id: 12, title: 'shell', sessionId: null },
  { id: 13, title: 'notes', sessionId: 'bbb' },
];

const SLOTS = {
  aaa: { titles: ['ccfzf-picker'], desktop: 2, lastSeen: 1700 },
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
    expect(out.windows.aaa).toEqual({ title: 'ccfzf-picker', desktop: 2, lastSeen: 1700 });
  });

  it('carries host, pid and a generated stamp in seconds', () => {
    const out = buildWindowsFile({
      windows: [], slots: {}, host: 'pc', pid: 42, nowMs: 1_800_500,
    });
    expect(out).toEqual({ host: 'pc', pid: 42, generated: 1800, windows: {} });
  });

  it('survives a window whose session has no slot yet', () => {
    const out = buildWindowsFile({
      windows: [{ title: 'fresh', sessionId: 'zzz' }], slots: {}, host: 'pc', pid: 1, nowMs: 0,
    });
    expect(out.windows.zzz).toEqual({ title: 'fresh', desktop: null, lastSeen: 0 });
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
