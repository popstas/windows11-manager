import { describe, it, expect, vi } from 'vitest';
import { startWindowIcons } from './window-icons.js';
import { mergeClaudeWtConfig } from '../claude-wt/daemon-helpers.js';

const WEZ = 'C:\\Program Files\\WezTerm\\wezterm-gui.exe';
const WT = 'C:\\WindowsTerminal.exe';
const CHROME = 'C:\\chrome.exe';

function setup({ windows = [], sessions = {}, heads = [], config = {}, control = true } = {}) {
  const calls = [];
  const logs = [];
  let clock = 0;
  const world = {
    windows,
    sessions,
    heads: new Set(heads),
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
  };
  const svc = startWindowIcons({
    winMan,
    log: (m, level = 'info') => logs.push(`${level}: ${m}`),
    repoRoot: 'C:/repo',
    now: () => clock,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });
  return { svc, calls, logs, winMan, world, advance: ms => { clock += ms; } };
}

describe('startWindowIcons', () => {
  it('при старте ставит иконки окнам wt и WezTerm: head — корона, остальным — по проекту', () => {
    const { calls } = setup({
      windows: [
        { id: 1, path: WT, title: 'wezterm-switch-head' },
        { id: 2, path: WEZ, title: 'wez-try' },
        { id: 3, path: CHROME, title: 'chrome' },
      ],
      sessions: { 1: { sessionId: 'h', cwd: '/p/home' }, 2: { sessionId: 'c', cwd: '/p/exp' } },
      heads: ['h'],
    });
    expect(calls).toEqual([[1, 'C:/repo/icons/crown.ico'], [2, 'C:/ico/exp.ico']]);
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
    const { svc, calls, world, advance } = setup({
      windows: [{ id: 2, path: WEZ, title: 'a' }], sessions: { 2: { sessionId: 'c', cwd: '/p/home' } },
    });
    calls.length = 0;
    world.heads.add('c');
    advance(16000);
    svc.tick();
    expect(calls).toEqual([[2, 'C:/repo/icons/crown.ico']]);
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
});
