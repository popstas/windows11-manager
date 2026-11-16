import { describe, it, expect, vi } from 'vitest';
import { startWindowIcons } from './window-icons.js';
import { mergeClaudeWtConfig } from '../claude-wt/daemon-helpers.js';

const WEZ = 'C:\\Program Files\\WezTerm\\wezterm-gui.exe';
const WT = 'C:\\WindowsTerminal.exe';
const CHROME = 'C:\\chrome.exe';

function setup({ windows = [], sessions = {}, heads = [], config = {}, control = true, overlayControl = true } = {}) {
  const calls = [];
  const overlays = [];
  const logs = [];
  const published = [];
  let clock = 0;
  const world = {
    windows,
    sessions,
    heads: new Set(heads),
    tray: 100,
    cfg: mergeClaudeWtConfig({
      statePath: 's', sessionsFile: 'V:/.ccfzf.sessions.json', profile: 'popstas',
      windowIcons: { profiles: { home: 'C:/ico/me.ico', ExpertizeMe: 'C:/ico/exp.ico' } },
      projects: [
        { name: 'home', cwd: '/p/home', profile: 'home' },
        { name: 'exp', cwd: '/p/exp', profile: 'ExpertizeMe' },
      ],
      ...config,
    }),
  };
  const winMan = {
    hasWindowIconControl: () => control,
    getClaudeWtConfig: () => world.cfg,
    getVisibleWindowIds: vi.fn(() => world.windows.map(w => w.id)),
    getWindowById: vi.fn(id => {
      const w = world.windows.find(x => x.id === id);
      return w ? { path: w.path, getTitle: () => w.title } : null;
    }),
    isTerminalWindow: w => w.path === WEZ || w.path === WT,
    claudeWtWindowSessions: vi.fn(list => list
      .filter(w => world.sessions[w.id])
      .map(w => ({ id: w.id, ...world.sessions[w.id] }))),
    claudeWtHeadIds: vi.fn(() => world.heads),
    setWindowIcon: vi.fn((id, path) => { calls.push([id, path]); return true; }),
    hasOverlayIconControl: () => overlayControl,
    setOverlayIcon: vi.fn((id, path, description) => { overlays.push([id, path, description]); return true; }),
    getTaskbarWindow: vi.fn(() => world.tray),
  };
  const svc = startWindowIcons({
    winMan,
    log: (m, level = 'info') => logs.push(`${level}: ${m}`),
    repoRoot: 'C:/repo',
    now: () => clock,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    publishIcons: (cfg, icons) => published.push(icons),
  });
  return { svc, calls, overlays, logs, published, winMan, world, advance: ms => { clock += ms; } };
}

describe('startWindowIcons', () => {
  it('при старте ставит иконки окнам wt и WezTerm: head — иконка проекта и корона значком', () => {
    const { calls, overlays } = setup({
      windows: [
        { id: 1, path: WT, title: 'wezterm-switch-head' },
        { id: 2, path: WEZ, title: 'wez-try' },
        { id: 3, path: CHROME, title: 'chrome' },
      ],
      sessions: { 1: { sessionId: 'h', cwd: '/p/home' }, 2: { sessionId: 'c', cwd: '/p/exp' } },
      heads: ['h'],
    });
    expect(calls).toEqual([[1, 'C:/ico/me.ico'], [2, 'C:/ico/exp.ico']]);
    // Окну 2 значок не положен — на старте он снимается: его мог оставить
    // прошлый процесс, explorer держит значок сам.
    expect(overlays).toEqual([[1, 'C:/repo/icons/crown.ico', 'head'], [2, '', '']]);
  });

  it('режим replace — корона вместо иконки, значков нет', () => {
    const { calls, overlays } = setup({
      windows: [{ id: 1, path: WT, title: 'h' }, { id: 2, path: WEZ, title: 'c' }],
      sessions: { 1: { sessionId: 'h', cwd: '/p/home' }, 2: { sessionId: 'c', cwd: '/p/exp' } },
      heads: ['h'],
      config: { windowIcons: { headMode: 'replace', profiles: { home: 'C:/ico/me.ico', ExpertizeMe: 'C:/ico/exp.ico' } } },
    });
    expect(calls).toEqual([[1, 'C:/repo/icons/crown.ico'], [2, 'C:/ico/exp.ico']]);
    expect(overlays.filter(o => o[1])).toEqual([]);
  });

  it('смена режима в настройках применяется сразу, без перезапуска', () => {
    const { svc, calls, overlays, world } = setup({
      windows: [{ id: 1, path: WT, title: 'h' }], sessions: { 1: { sessionId: 'h', cwd: '/p/home' } }, heads: ['h'],
    });
    calls.length = 0;
    overlays.length = 0;
    world.cfg = mergeClaudeWtConfig({ ...world.cfg, windowIcons: { ...world.cfg.windowIcons, headMode: 'replace' } });
    svc.tick();
    expect(calls).toEqual([[1, 'C:/repo/icons/crown.ico']]);
    expect(overlays).toEqual([[1, '', '']]);
    calls.length = 0;
    overlays.length = 0;
    world.cfg = mergeClaudeWtConfig({ ...world.cfg, windowIcons: { ...world.cfg.windowIcons, headMode: 'overlay' } });
    svc.tick();
    expect(calls).toEqual([[1, 'C:/ico/me.ico']]);
    expect(overlays).toEqual([[1, 'C:/repo/icons/crown.ico', 'head']]);
  });

  it('перезапуск explorer — значок ставится заново сразу и на следующем обновлении', () => {
    const { svc, calls, overlays, world, advance, logs } = setup({
      windows: [{ id: 1, path: WT, title: 'h' }, { id: 2, path: WEZ, title: 'c' }],
      sessions: { 1: { sessionId: 'h', cwd: '/p/home' }, 2: { sessionId: 'c', cwd: '/p/exp' } },
      heads: ['h'],
    });
    calls.length = 0;
    overlays.length = 0;
    svc.tick();
    expect(overlays).toEqual([]);
    world.tray = 200;
    svc.tick();
    expect(overlays.filter(o => o[1])).toEqual([[1, 'C:/repo/icons/crown.ico', 'head']]);
    expect(calls).toEqual([]);
    expect(logs.some(l => l.includes('explorer'))).toBe(true);
    overlays.length = 0;
    advance(16000);
    svc.tick();
    expect(overlays.filter(o => o[1])).toEqual([[1, 'C:/repo/icons/crown.ico', 'head']]);
    overlays.length = 0;
    advance(16000);
    svc.tick();
    expect(overlays).toEqual([]);
  });

  it('панели задач нет (explorer лежит) — ждать, а не ставить в пустоту', () => {
    const { svc, overlays, world } = setup({
      windows: [{ id: 1, path: WT, title: 'h' }], sessions: { 1: { sessionId: 'h', cwd: '/p/home' } }, heads: ['h'],
    });
    overlays.length = 0;
    world.tray = 0;
    svc.tick();
    expect(overlays).toEqual([]);
    world.tray = 300;
    svc.tick();
    expect(overlays).toEqual([[1, 'C:/repo/icons/crown.ico', 'head']]);
  });

  it('значок не встал — повтор на следующем обновлении, предупреждение один раз', () => {
    const { svc, winMan, overlays, logs, advance, world } = setup({
      windows: [{ id: 2, path: WEZ, title: 'c' }], sessions: { 2: { sessionId: 'c', cwd: '/p/home' } },
    });
    winMan.setOverlayIcon.mockImplementation((id, path, d) => { overlays.push([id, path, d]); return false; });
    overlays.length = 0;
    world.heads.add('c');
    advance(16000);
    svc.tick();
    expect(overlays).toEqual([[2, 'C:/repo/icons/crown.ico', 'head']]);
    advance(16000);
    svc.tick();
    expect(overlays).toHaveLength(2);
    expect(logs.filter(l => l.startsWith('warn:') && l.includes('значок'))).toHaveLength(1);
  });

  it('аддон без setOverlayIcon — корона вместо иконки и одно предупреждение', () => {
    const { calls, overlays, logs } = setup({
      windows: [{ id: 1, path: WT, title: 'h' }], sessions: { 1: { sessionId: 'h', cwd: '/p/home' } }, heads: ['h'],
      overlayControl: false,
    });
    expect(calls).toEqual([[1, 'C:/repo/icons/crown.ico']]);
    expect(overlays).toEqual([]);
    expect(logs.filter(l => l.startsWith('warn:'))).toHaveLength(1);
  });

  it('ничего не изменилось — ни сети, ни вызовов до срока обновления', () => {
    const { svc, calls, winMan } = setup({
      windows: [{ id: 2, path: WEZ, title: 'a' }], sessions: { 2: { sessionId: 'c', cwd: '/p/home' } },
    });
    calls.length = 0;
    svc.tick();
    expect(winMan.claudeWtWindowSessions).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it('новая метка head замечается на обновлении', () => {
    const { svc, calls, overlays, world, advance } = setup({
      windows: [{ id: 2, path: WEZ, title: 'a' }], sessions: { 2: { sessionId: 'c', cwd: '/p/home' } },
    });
    calls.length = 0;
    overlays.length = 0;
    world.heads.add('c');
    advance(16000);
    svc.tick();
    // Главная иконка та же (проект), корона — значком.
    expect(calls).toEqual([]);
    expect(overlays).toEqual([[2, 'C:/repo/icons/crown.ico', 'head']]);
  });

  it('смена иконки проекта в настройках применяется сразу, без ожидания', () => {
    const { svc, calls, world } = setup({
      windows: [{ id: 2, path: WEZ, title: 'a' }], sessions: { 2: { sessionId: 'c', cwd: '/p/home' } },
    });
    calls.length = 0;
    world.cfg = mergeClaudeWtConfig({ ...world.cfg, projects: [{ name: 'home', cwd: '/p/home', icon: 'D:\\x.png' }] });
    svc.tick();
    expect(calls).toEqual([[2, 'D:\\x.png']]);
  });

  it('выключение одной строкой снимает поставленные иконки', () => {
    const { svc, calls, world } = setup({
      windows: [{ id: 2, path: WEZ, title: 'a' }], sessions: { 2: { sessionId: 'c', cwd: '/p/home' } },
    });
    calls.length = 0;
    world.cfg = mergeClaudeWtConfig({ ...world.cfg, windowIcons: { enabled: false } });
    svc.tick();
    expect(calls).toEqual([[2, '']]);
  });

  it('stop() снимает иконки', () => {
    const { svc, calls } = setup({
      windows: [{ id: 2, path: WEZ, title: 'a' }], sessions: { 2: { sessionId: 'c', cwd: '/p/home' } },
    });
    calls.length = 0;
    svc.stop();
    expect(calls).toEqual([[2, '']]);
  });

  it('аддон без setWindowIcon — одно предупреждение и ни одного вызова', () => {
    const { calls, logs } = setup({
      windows: [{ id: 2, path: WEZ, title: 'a' }], sessions: { 2: { sessionId: 'c', cwd: '/p/home' } }, control: false,
    });
    expect(calls).toEqual([]);
    expect(logs.filter(l => l.startsWith('warn:'))).toHaveLength(1);
  });

  it('файла нет — предупреждение один раз', () => {
    const { svc, winMan, logs, world, advance } = setup({
      windows: [{ id: 2, path: WEZ, title: 'a' }], sessions: { 2: { sessionId: 'c', cwd: '/p/home' } },
      config: { projects: [{ name: 'home', cwd: '/p/home', icon: 'D:\\missing.png' }] },
    });
    expect(logs.filter(l => l.startsWith('warn:'))).toHaveLength(0);
    winMan.setWindowIcon.mockImplementation(() => false);
    world.cfg = mergeClaudeWtConfig({ ...world.cfg, projects: [{ name: 'home', cwd: '/p/home', icon: 'D:\\gone.png' }] });
    svc.tick();
    advance(20000);
    world.windows.push({ id: 3, path: WEZ, title: 'b' });
    world.sessions[3] = { sessionId: 'd', cwd: '/p/home' };
    svc.tick();
    expect(logs.filter(l => l.startsWith('warn:') && l.includes('gone.png'))).toHaveLength(1);
  });

  it('решённые иконки уходят демону по sessionId, только когда изменились', () => {
    const { svc, published, world, advance } = setup({
      windows: [{ id: 1, path: WT, title: 'h' }, { id: 2, path: WEZ, title: 'c' }, { id: 4, path: WEZ, title: 'n' }],
      sessions: {
        1: { sessionId: 'h', cwd: '/p/home' }, 2: { sessionId: 'c', cwd: '/p/exp' }, 4: { sessionId: 'n', cwd: '/x' },
      },
      heads: ['h'],
      config: { profile: '' },
    });
    // head в режиме overlay — иконка проекта: корона только значком на панели.
    expect(published).toEqual([{ h: 'C:/ico/me.ico', c: 'C:/ico/exp.ico', n: '' }]);
    advance(16000);
    svc.tick();
    expect(published).toHaveLength(1);
    world.cfg = mergeClaudeWtConfig({ ...world.cfg, windowIcons: { ...world.cfg.windowIcons, headMode: 'replace' } });
    svc.tick();
    expect(published.at(-1)).toEqual({ h: 'C:/repo/icons/crown.ico', c: 'C:/ico/exp.ico', n: '' });
  });

  it('выключенные иконки — пустая карта демону', () => {
    const { svc, published, world } = setup({
      windows: [{ id: 2, path: WEZ, title: 'a' }], sessions: { 2: { sessionId: 'c', cwd: '/p/home' } },
    });
    world.cfg = mergeClaudeWtConfig({ ...world.cfg, windowIcons: { enabled: false } });
    svc.tick();
    expect(published.at(-1)).toEqual({});
  });
});
