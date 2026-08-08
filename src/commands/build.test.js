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
