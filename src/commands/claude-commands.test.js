import { describe, it, expect, vi } from 'vitest';
import { claudeCommands } from './claude-commands.js';

const SESSION = { id: 'abc', windowId: 42, open: true, agentState: 'review' };

function deps(overrides = {}) {
  return {
    winMan: {
      claudeWtSessions: vi.fn().mockReturnValue({ ok: true, sessions: [SESSION] }),
      getWindowById: vi.fn().mockReturnValue({ id: 42 }),
      focusWindowById: vi.fn().mockReturnValue(true),
      // Столы этот модуль больше не трогает сам: попытку фокуса и, если она не
      // удалась, переход держит focusTerminalWindow — там же, где живёт
      // бесплатная проверка «окно уже переднее».
      focusTerminalWindow: vi.fn().mockResolvedValue(true),
      markSessionUnread: vi.fn().mockReturnValue({ ok: true, ids: ['abc'] }),
      restoreSnapshot: vi.fn().mockResolvedValue({ restored: ['abc'], skipped: [] }),
      restoreClaudeSessions: vi.fn().mockResolvedValue({ restored: ['abc'], skipped: [] }),
      arrangeClaudeWindows: vi.fn().mockResolvedValue({ ok: true, placed: 2 }),
      openClaudeProject: vi.fn().mockResolvedValue({ ok: true, action: 'focus' }),
      resumeClaudeSession: vi.fn().mockResolvedValue({ ok: true, action: 'resume', sessionId: 'zzz' }),
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
    expect(d.winMan.focusTerminalWindow).toHaveBeenCalledWith(42, expect.any(Function));
    expect(d.winMan.restoreClaudeSessions).not.toHaveBeenCalled();
  });

  it('принимает голый id строкой', async () => {
    const d = deps();
    await claudeCommands(d)['claude-focus']('abc');
    expect(d.winMan.focusTerminalWindow).toHaveBeenCalledWith(42, expect.any(Function));
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
    expect(d.winMan.focusTerminalWindow).not.toHaveBeenCalled();
  });

  // Прежние два теста стерегли здесь порядок «сначала стол, потом фокус» и
  // молчание при неизвестном столе. Оба переехали в focusTerminalWindow вместе
  // с самой логикой: этот модуль больше не спрашивает у VirtualDesktop11.exe
  // ничего, а запуск того процесса стоил 208 мс на каждый перевод фокуса — по
  // два на окно, которое чаще всего и так на текущем столе.
  it('список сессий читается кратким — состояние агента фокусу не нужно', async () => {
    // Прогресс и мета лежат на сетевом диске, файл на сессию: 1.43 с замером
    // на popstas-pc против 19 мс на всё остальное. Решается здесь «открыто ли
    // окно», и на это они не влияют никак — а ждал их человек на каждом
    // выборе уже открытой сессии.
    const d = deps();
    await claudeCommands(d)['claude-focus']({ id: 'abc' });
    expect(d.winMan.claudeWtSessions).toHaveBeenCalledWith(
      expect.objectContaining({ brief: true }),
    );
  });

  it('сам столов не трогает — за него это делает focusTerminalWindow', async () => {
    const d = deps();
    await claudeCommands(d)['claude-focus']({ id: 'abc' });
    expect(d.winMan.virtualDesktop.GetWindowDesktopNumber).not.toHaveBeenCalled();
    expect(d.winMan.virtualDesktop.GoToDesktopNumber).not.toHaveBeenCalled();
  });

  it('говорит про окно не на экране, когда фокус не дошёл', async () => {
    const d = deps({ winMan: { focusTerminalWindow: vi.fn().mockResolvedValue(false) } });
    await claudeCommands(d)['claude-focus']({ id: 'abc' });
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('is not on screen'), 'warn');
  });
});

describe('claude-focus-slot', () => {
  it('переводит номер строки в id по последней раскладке', async () => {
    const d = deps();
    await claudeCommands(d)['claude-focus-slot']('1');
    expect(d.winMan.focusTerminalWindow).toHaveBeenCalledWith(42, expect.any(Function));
  });

  it('принимает {slot: N}', async () => {
    const d = deps();
    await claudeCommands(d)['claude-focus-slot']({ slot: 1 });
    expect(d.winMan.focusTerminalWindow).toHaveBeenCalledWith(42, expect.any(Function));
  });

  it('молчит на пустой строке', async () => {
    const d = deps({ slots: () => [{ slot: 1, id: null }] });
    await claudeCommands(d)['claude-focus-slot']('1');
    expect(d.winMan.focusTerminalWindow).not.toHaveBeenCalled();
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
    expect(d.winMan.focusTerminalWindow).toHaveBeenCalledWith(42, expect.any(Function));
    expect(d.winMan.openClaudeProject).not.toHaveBeenCalled();
  });

  it('стол и фокус отдаёт focusTerminalWindow, а не разбирает сам', async () => {
    // Фокус с чужого стола Windows отдаёт молча и без результата, и порядок
    // «сначала стол, потом фокус» по-прежнему обязателен — но живёт он теперь
    // в одном месте на оба пути, вместе с бесплатной проверкой «окно уже
    // переднее», ради которой запуск VirtualDesktop11.exe чаще всего не нужен.
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ id: 'abc', action: 'terminal' });
    expect(d.winMan.focusTerminalWindow).toHaveBeenCalledWith(42, expect.any(Function));
    expect(d.winMan.virtualDesktop.GetWindowDesktopNumber).not.toHaveBeenCalled();
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

  it('сессию без слота поднимает по id, а не заводит чистую в её каталоге', async () => {
    // Живой случай 2026-08-17: окно сессии стоит на мак мини, слота на Windows
    // у неё нет и не было. Каталог тут известен, и раньше просьба уходила в
    // `openClaudeProject` — человек получал пустую `claude -n` вместо своей
    // сессии, причём молча: ответа у публикации в MQTT нет.
    const d = deps();
    await claudeCommands(d)['claude-session-open'](PROJECT);
    expect(d.winMan.resumeClaudeSession).toHaveBeenCalledWith({ id: 'zzz', cwd: '/p/site' });
    expect(d.winMan.openClaudeProject).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('сессию без слота поднимает и вовсе без каталога — id хватает', async () => {
    // Каталог в этой ветке нужен только ради профиля терминала: шаблон
    // возобновления (`ccfzf --session {id}`) знает конфиг, а не просьба.
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ id: 'zzz', action: 'terminal' });
    expect(d.winMan.resumeClaudeSession).toHaveBeenCalledWith({ id: 'zzz' });
    expect(d.winMan.openClaudeProject).not.toHaveBeenCalled();
  });

  it('отказ возобновления доходит до человека', async () => {
    const d = deps({
      winMan: {
        resumeClaudeSession: vi.fn().mockResolvedValue({ ok: false, reason: 'claudeWt.launch.args is empty' }),
      },
    });
    await claudeCommands(d)['claude-session-open'](PROJECT);
    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('launch.args'));
  });

  it('упавшее возобновление тоже слышно, а не только в журнале', async () => {
    const d = deps({
      winMan: {
        resumeClaudeSession: vi.fn().mockRejectedValue(new Error('wt.exe not found')),
      },
    });
    await claudeCommands(d)['claude-session-open'](PROJECT);
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('wt.exe not found'), 'error');
    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('wt.exe not found'));
  });

  it('нечитаемый список сессий не мешает поднять сессию по id', async () => {
    // Список — это про слоты; шаблон возобновления лежит в конфиге и от списка
    // не зависит. Но о поломке надо сказать: молча она неотличима от «сессии
    // тут нет», а это обычное дело.
    const d = deps({
      winMan: { claudeWtSessions: vi.fn().mockReturnValue({ ok: false, reason: 'statePath is not set' }) },
    });
    await claudeCommands(d)['claude-session-open'](PROJECT);
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('statePath is not set'), 'warn');
    expect(d.winMan.resumeClaudeSession).toHaveBeenCalledWith({ id: 'zzz', cwd: '/p/site' });
  });

  it('открывает проект и без id — по одному каталогу', async () => {
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ action: 'terminal', cwd: '/p/home' });
    expect(d.winMan.openClaudeProject).toHaveBeenCalledWith({ cwd: '/p/home', name: 'home' });
  });

  it('точка курсора доезжает до всех трёх дорог, кончающихся новым окном', async () => {
    // Экран для нового окна называет пикер: он один знает, где сейчас смотрит
    // человек. Забудь любую из трёх дорог — галка работала бы через раз, и
    // объяснить это было бы нечем: ответа у публикации нет.
    const cursor = { x: 2560, y: 300 };
    const at = { ...cursor, noAutoplace: false };
    const project = deps();
    await claudeCommands(project)['claude-session-open']({ action: 'terminal', cwd: '/p/home', cursor });
    expect(project.winMan.openClaudeProject)
      .toHaveBeenCalledWith({ cwd: '/p/home', name: 'home', cursor: at });

    const fresh = deps();
    await claudeCommands(fresh)['claude-session-open']({
      action: 'terminal-new', cwd: '/p/site', name: 'site-2', cursor,
    });
    expect(fresh.winMan.openClaudeProject).toHaveBeenCalledWith({
      cwd: '/p/site', name: 'site-2', reuseOpen: false, cursor: at,
    });

    const resumed = deps();
    await claudeCommands(resumed)['claude-session-open']({ ...PROJECT, cursor });
    expect(resumed.winMan.resumeClaudeSession).toHaveBeenCalledWith({
      id: 'zzz', cwd: '/p/site', cursor: at,
    });
  });

  it('просьба «не расставлять» доезжает теми же тремя дорогами', async () => {
    // Ctrl на строке пикера: окно встаёт под курсором и остаётся там. Ключ
    // едет рядом с точкой, и забудь мы его на одной из дорог — модификатор
    // работал бы через раз: строка сессии слушалась бы, а строка проекта нет.
    const cursor = { x: 2560, y: 300 };
    const pinned = { ...cursor, noAutoplace: true };
    const project = deps();
    await claudeCommands(project)['claude-session-open']({
      action: 'terminal', cwd: '/p/home', cursor, noAutoplace: true,
    });
    expect(project.winMan.openClaudeProject)
      .toHaveBeenCalledWith({ cwd: '/p/home', name: 'home', cursor: pinned });

    const fresh = deps();
    await claudeCommands(fresh)['claude-session-open']({
      action: 'terminal-new', cwd: '/p/site', name: 'site-2', cursor, noAutoplace: true,
    });
    expect(fresh.winMan.openClaudeProject).toHaveBeenCalledWith({
      cwd: '/p/site', name: 'site-2', reuseOpen: false, cursor: pinned,
    });

    const resumed = deps();
    await claudeCommands(resumed)['claude-session-open']({ ...PROJECT, cursor, noAutoplace: true });
    expect(resumed.winMan.resumeClaudeSession).toHaveBeenCalledWith({
      id: 'zzz', cwd: '/p/site', cursor: pinned,
    });
  });

  it('без точки ключа в просьбе нет вовсе — прежнее поведение', async () => {
    // Выключенная галка и пикер прежней версии обязаны выглядеть одинаково:
    // окно встаёт туда, куда его поставит терминал.
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ action: 'terminal', cwd: '/p/home' });
    expect(d.winMan.openClaudeProject).toHaveBeenCalledWith({ cwd: '/p/home', name: 'home' });
  });

  it('мусор вместо точки не доезжает до окна', async () => {
    // Тело пишет чужая машина. Строка или NaN здесь означали бы окно,
    // поставленное неизвестно куда, — а сказать об этом было бы некому.
    const d = deps();
    await claudeCommands(d)['claude-session-open']({
      action: 'terminal', cwd: '/p/home', cursor: { x: '10', y: 20 },
    });
    expect(d.winMan.openClaudeProject).toHaveBeenCalledWith({ cwd: '/p/home', name: 'home' });
  });

  it('поднятое окно точка не двигает: просьба про новые окна', async () => {
    const d = deps();
    await claudeCommands(d)['claude-session-open']({
      id: 'abc', action: 'terminal', cursor: { x: 2560, y: 300 },
    });
    expect(d.winMan.focusTerminalWindow).toHaveBeenCalledWith(42, expect.any(Function));
    expect(d.winMan.openClaudeProject).not.toHaveBeenCalled();
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
    expect(d.winMan.focusTerminalWindow).not.toHaveBeenCalled();
  });

  it('terminal-new с id всё равно про каталог, а не про сессию', async () => {
    // Пикер id сюда не шлёт, но если он появится, поднимать сессию нельзя:
    // просили обратного.
    const d = deps();
    await claudeCommands(d)['claude-session-open']({
      id: 'abc', action: 'terminal-new', cwd: '/p/site', name: 'site-2',
    });
    expect(d.winMan.focusTerminalWindow).not.toHaveBeenCalled();
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
    // Без id: имя осмысленно только там, где заводится новая сессия, а
    // возобновление называет её id.
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ action: 'terminal', cwd: '/p/site', name: 'мой сайт' });
    expect(d.winMan.openClaudeProject).toHaveBeenCalledWith({
      cwd: '/p/site', name: 'мой сайт',
    });
  });

  it('ни id, ни каталога — сообщает человеку, а не молчит', async () => {
    const d = deps();
    await claudeCommands(d)['claude-session-open']({ action: 'terminal' });
    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('id'));
    expect(d.winMan.openClaudeProject).not.toHaveBeenCalled();
    expect(d.winMan.resumeClaudeSession).not.toHaveBeenCalled();
    expect(d.winMan.focusTerminalWindow).not.toHaveBeenCalled();
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
    await claudeCommands(d)['claude-session-open']({ action: 'terminal', cwd: '/p/site' });
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
    expect(d.winMan.focusTerminalWindow).not.toHaveBeenCalled();
    expect(d.winMan.openClaudeProject).not.toHaveBeenCalled();
  });
});

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

  it('terminal доезжает и до восстановления мёртвой сессии — та же живая дорога Enter\'а', async () => {
    // Сессия трекеру известна, окна у неё нет — chooseAction отдаёт restore, и
    // без проброса дальше человек, выбравший WezTerm, получил бы wt молча.
    const d = deps({ winMan: { getWindowById: vi.fn().mockReturnValue(null) } });
    await claudeCommands(d)['claude-session-open']({
      id: 'abc', action: 'terminal', terminal: 'wezterm',
    });
    expect(d.winMan.restoreClaudeSessions).toHaveBeenCalledWith({ sessionIds: ['abc'], terminal: 'wezterm' });
  });

  it('terminal доезжает и до возобновления сессии без слота', async () => {
    const d = deps();
    await claudeCommands(d)['claude-session-open']({
      id: 'zzz', action: 'terminal', cwd: 'D:\\p\\site', terminal: 'wezterm',
    });
    expect(d.winMan.resumeClaudeSession).toHaveBeenCalledWith({
      id: 'zzz', cwd: 'D:\\p\\site', terminal: 'wezterm',
    });
  });

  it('без terminal восстановление зовётся как раньше — дефолт машины решает менеджер', async () => {
    const d = deps({ winMan: { getWindowById: vi.fn().mockReturnValue(null) } });
    await claudeCommands(d)['claude-session-open']({ id: 'abc', action: 'terminal' });
    expect(d.winMan.restoreClaudeSessions).toHaveBeenCalledWith({ sessionIds: ['abc'] });
  });
});

describe('claude-place', () => {
  it('передаёт раскладку и список из объекта', async () => {
    const d = deps();
    await claudeCommands(d)['claude-place']({ mode: 'tile', ids: ['a', 'b'] });
    expect(d.winMan.arrangeClaudeWindows).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'tile', ids: ['a', 'b'] }),
    );
  });

  // Так шлёт панель openHASP: голое слово в теле топика.
  it('принимает сырую строку', async () => {
    const d = deps();
    await claudeCommands(d)['claude-place']('cascade');
    expect(d.winMan.arrangeClaudeWindows).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'cascade', ids: [] }),
    );
  });

  it('незнакомая раскладка — жалоба в журнал и ни одного движения', async () => {
    const d = deps();
    await claudeCommands(d)['claude-place']('mosaic');
    expect(d.winMan.arrangeClaudeWindows).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('mosaic'), 'warn');
  });

  it('отказ раскладки доходит до человека', async () => {
    const d = deps({
      winMan: { arrangeClaudeWindows: vi.fn().mockResolvedValue({ ok: false, reason: 'открытых сессий claude нет' }) },
    });
    await claudeCommands(d)['claude-place']('tile');
    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('открытых сессий claude нет'));
  });

  it('исключение не роняет обработчик', async () => {
    const d = deps({
      winMan: { arrangeClaudeWindows: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    await claudeCommands(d)['claude-place']('tile');
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('boom'), 'error');
    expect(d.notify).toHaveBeenCalled();
  });
});
