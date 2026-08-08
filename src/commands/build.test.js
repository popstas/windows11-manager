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

  it('autoplace получает канал уведомлений, а не молчит в него', async () => {
    // Без проброса notify в windowCommands сообщение «Placed windows: N» с
    // notifyPlaced не уходило никуда: карта команд собирается здесь.
    const notify = vi.fn();
    const winMan = winManStub();
    winMan.placeWindows = vi.fn().mockResolvedValue([{ w: { path: 'C:\\x\\code.exe' } }]);
    await makeMap({ notify, winMan, config: { base: 'home/room/pc/windows', notifyPlaced: true } }).autoplace();
    expect(notify).toHaveBeenCalledWith('Placed windows: 1');
  });

  it('плитка гасится по разобранному номеру слота, а не по сырому телу', async () => {
    // `Number('{"slot":3}')` — NaN, slotOff не находил слота, и плитка на
    // панели оставалась гореть.
    vi.useFakeTimers();
    try {
      const slotOff = vi.fn();
      const haExport = { slots: () => [], slotOff, refresh: vi.fn() };
      await makeMap({ haExport })['claude-focus-slot']('{"slot":3}');
      vi.advanceTimersByTime(1000);
      expect(slotOff).toHaveBeenCalledWith(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('голый номер слота строкой гасит ту же плитку', async () => {
    vi.useFakeTimers();
    try {
      const slotOff = vi.fn();
      const haExport = { slots: () => [], slotOff, refresh: vi.fn() };
      await makeMap({ haExport })['claude-focus-slot']('3');
      vi.advanceTimersByTime(1000);
      expect(slotOff).toHaveBeenCalledWith('3');
    } finally {
      vi.useRealTimers();
    }
  });
});
