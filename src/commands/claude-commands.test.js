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

  it('удавшееся восстановление оставляет след в журнале', async () => {
    // Слова те же, что были в windows-mqtt/src/modules/windows.js: успех был
    // единственным исходом, о котором не сообщал никто.
    const d = deps({ winMan: { getWindowById: vi.fn().mockReturnValue(null) } });
    await claudeCommands(d)['claude-focus']({ id: 'abc' });
    expect(d.log).toHaveBeenCalledWith('claude-wt restored 1, skipped 0');
    expect(d.notify).not.toHaveBeenCalled();
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
  const PROJECT = { id: 'zzz', action: 'terminal', cwd: '/p/site' };

  it('действие terminal поднимает окно, а не открывает второе', async () => {
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ id: 'abc', action: 'terminal' });
    expect(d.winMan.focusWindowById).toHaveBeenCalledWith(42);
    expect(d.winMan.openClaudeProject).not.toHaveBeenCalled();
  });

  it('переключает виртуальный стол раньше, чем фокусирует окно', async () => {
    // Фокус с чужого стола Windows отдаёт молча и без результата — тот же
    // порядок, что у claude-focus, и здесь он тоже обязателен.
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ id: 'abc', action: 'terminal' });
    const switchOrder = d.winMan.virtualDesktop.GoToDesktopNumber.mock.invocationCallOrder[0];
    const focusOrder = d.winMan.focusWindowById.mock.invocationCallOrder[0];
    expect(switchOrder).toBeLessThan(focusOrder);
  });

  it('знакомую сессию с закрытым окном возвращает восстановлением, а не новым терминалом', async () => {
    // Восстановление поднимает ту же сессию (`claude --resume {id}`) на её
    // прежнее место и с тем же профилем; терминал по каталогу дал бы вместо
    // неё пустую новую.
    const d = deps({ winMan: { getWindowById: vi.fn().mockReturnValue(null) } });
    await claudeCommands(d)['claude-session-open']({ ...PROJECT, id: 'abc' });
    expect(d.winMan.restoreClaudeSessions).toHaveBeenCalledWith({ sessionIds: ['abc'] });
    expect(d.winMan.openClaudeProject).not.toHaveBeenCalled();
  });

  it('незнакомую трекеру сессию открывает по каталогу проекта', async () => {
    // Ради этого случая просьба и заведена: список пикера приезжает от ccfzf
    // с ssh-хоста и знает сессии, которых на Windows не открывали ни разу.
    const d = deps();
    await claudeCommands(d)['claude-session-open'](PROJECT);
    expect(d.winMan.openClaudeProject).toHaveBeenCalledWith({
      cwd: '/p/site', name: 'site',
    });
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('открывает проект и без id — по одному каталогу', async () => {
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ action: 'terminal', cwd: '/p/home' });
    expect(d.winMan.openClaudeProject).toHaveBeenCalledWith({ cwd: '/p/home', name: 'home' });
  });

  it('terminal-new заводит сессию, не поднимая открытую', async () => {
    // `^N` в пикере нажимают именно потому, что сессия уже есть: искать её
    // здесь значило бы поднять ту самую, рядом с которой просили открыть новую.
    const d = deps();
    await claudeCommands(d)['claude-session-open']({
      action: 'terminal-new', cwd: '/p/site', name: 'site-2',
    });
    expect(d.winMan.openClaudeProject).toHaveBeenCalledWith({
      cwd: '/p/site', name: 'site-2', reuseOpen: false,
    });
    expect(d.winMan.focusWindowById).not.toHaveBeenCalled();
  });

  it('terminal-new с id всё равно про каталог, а не про сессию', async () => {
    // Пикер id сюда не шлёт, но если он появится, поднимать сессию нельзя:
    // просили обратного.
    const d = deps();
    await claudeCommands(d)['claude-session-open']({
      id: 'abc', action: 'terminal-new', cwd: '/p/site', name: 'site-2',
    });
    expect(d.winMan.focusWindowById).not.toHaveBeenCalled();
    expect(d.winMan.openClaudeProject).toHaveBeenCalledWith({
      cwd: '/p/site', name: 'site-2', reuseOpen: false,
    });
  });

  it('terminal-new без каталога — сообщает человеку, а не молчит', async () => {
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ action: 'terminal-new', name: 'site-2' });
    expect(d.winMan.openClaudeProject).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('cwd'));
  });

  it('неизвестное действие по-прежнему отклоняется вслух', async () => {
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ action: 'terminal-old', cwd: '/p/site' });
    expect(d.winMan.openClaudeProject).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('terminal-old'), 'warn');
    // Отказ должен быть слышен не только в журнале — иначе он неотличим от
    // тишины, которую спека прямо запрещает.
    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('terminal-old'));
  });

  it('имя из тела просьбы побеждает имя каталога', async () => {
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ ...PROJECT, name: 'мой сайт' });
    expect(d.winMan.openClaudeProject).toHaveBeenCalledWith({
      cwd: '/p/site', name: 'мой сайт',
    });
  });

  it('ни знакомого id, ни каталога — сообщает человеку, а не молчит', async () => {
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ id: 'zzz', action: 'terminal' });
    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('zzz'));
    expect(d.winMan.openClaudeProject).not.toHaveBeenCalled();
    expect(d.winMan.focusWindowById).not.toHaveBeenCalled();
  });

  it('пустое тело — тоже сообщает', async () => {
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ action: 'terminal', cwd: '   ' });
    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('cwd'));
  });

  it('отказ открытия доходит до человека', async () => {
    const d = deps({
      winMan: {
        openClaudeProject: vi.fn().mockResolvedValue({ ok: false, reason: 'claudeWt.launchNew.command is not set in config' }),
      },
    });
    await claudeCommands(d)['claude-session-open'](PROJECT);
    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('launchNew'));
  });

  it('чужое действие не открывает ничего', async () => {
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ ...PROJECT, action: 'cursor' });
    expect(d.winMan.openClaudeProject).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('cursor'), 'warn');
    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('cursor'));
  });

  it('без action ничего не делает', async () => {
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ id: 'abc' });
    expect(d.winMan.focusWindowById).not.toHaveBeenCalled();
    expect(d.winMan.openClaudeProject).not.toHaveBeenCalled();
  });
});
