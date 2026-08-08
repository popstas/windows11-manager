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

  it('переключает виртуальный стол раньше, чем фокусирует окно', async () => {
    const d = deps();
    await claudeCommands(d)['claude-focus']({ id: 'abc' });
    expect(d.winMan.virtualDesktop.GoToDesktopNumber).toHaveBeenCalledWith(1);
    const switchOrder = d.winMan.virtualDesktop.GoToDesktopNumber.mock.invocationCallOrder[0];
    const focusOrder = d.winMan.focusWindowById.mock.invocationCallOrder[0];
    expect(switchOrder).toBeLessThan(focusOrder);
  });

  it('не переключает стол, если он неизвестен', async () => {
    const d = deps({
      winMan: {
        virtualDesktop: {
          GetWindowDesktopNumber: vi.fn().mockResolvedValue(null),
          GoToDesktopNumber: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
    await claudeCommands(d)['claude-focus']({ id: 'abc' });
    expect(d.winMan.virtualDesktop.GoToDesktopNumber).not.toHaveBeenCalled();
    expect(d.winMan.focusWindowById).toHaveBeenCalledWith(42);
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
