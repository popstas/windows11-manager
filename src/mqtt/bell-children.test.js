import { describe, it, expect, vi } from 'vitest';
import { startBellChildren } from './bell-children.js';
import { BELL_HEADER } from '../claude-wt/bell-children-helpers.js';

const WEZ = 'C:\\Program Files\\WezTerm\\wezterm-gui.exe';
const CHROME = 'C:\\chrome.exe';

function setup({ windows = [], sessions = {}, children = [], registry = [], enabled = true } = {}) {
  let clock = 1_000_000_000;
  const writes = [];
  const removed = [];
  const logs = [];
  const world = { windows, sessions, children: new Set(children), registry, enabled };
  world.write = (file, text) => writes.push([file, text]);
  const winMan = {
    getClaudeWtConfig: () => ({ enabled: world.enabled, sessionsFile: 'V:/.ccfzf.sessions.json' }),
    getVisibleWindowIds: vi.fn(() => world.windows.map(w => w.id)),
    getWindowById: vi.fn(id => {
      const w = world.windows.find(x => x.id === id);
      return w ? { path: w.path ?? WEZ, getTitle: () => world.windows.find(x => x.id === id)?.title ?? '' } : null;
    }),
    isTerminalWindow: w => w.path === WEZ,
    claudeWtWindowSessions: vi.fn(list => list
      .filter(w => world.sessions[w.id])
      .map(w => ({ id: w.id, sessionId: world.sessions[w.id] }))),
    claudeWtHeadIds: vi.fn(() => world.children),
  };
  const svc = startBellChildren({
    winMan,
    log: (m, level = 'info') => logs.push(`${level}: ${m}`),
    file: 'H:/.wezterm-bell-children',
    readRegistry: () => world.registry,
    now: () => clock,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    write: (file, text) => world.write(file, text),
    remove: file => removed.push(file),
  });
  return {
    svc, winMan, world, writes, removed, logs,
    advance: ms => { clock += ms; },
    last: () => writes.at(-1)?.[1],
  };
}

describe('startBellChildren', () => {
  it('пишет ключи окон детей и время в секундах на старте', () => {
    const t = setup({
      windows: [{ id: 1, title: '✳ kid' }, { id: 2, title: '✳ boss' }],
      sessions: { 1: 'k', 2: 'b' },
      children: ['k'],
    });
    expect(t.writes).toHaveLength(1);
    expect(t.writes[0][0]).toBe('H:/.wezterm-bell-children');
    expect(t.last()).toBe(`${BELL_HEADER} 1000000\nkid\n`);
    expect(t.winMan.claudeWtHeadIds).toHaveBeenCalledWith('V:/.ccfzf/children');
  });

  it('без детей — файл с одним заголовком', () => {
    const t = setup({ windows: [{ id: 1, title: 'boss' }], sessions: { 1: 'b' } });
    expect(t.last()).toBe(`${BELL_HEADER} 1000000\n`);
  });

  it('не терминал не учитывается', () => {
    const t = setup({
      windows: [{ id: 1, title: 'kid' }, { id: 2, title: 'kid', path: CHROME }],
      sessions: { 1: 'k' },
      children: ['k'],
    });
    expect(t.last()).toBe(`${BELL_HEADER} 1000000\nkid\n`);
  });

  it('без перемен не переписывает и в сеть не ходит', () => {
    const t = setup({ windows: [{ id: 1, title: 'kid' }], sessions: { 1: 'k' }, children: ['k'] });
    t.advance(3000);
    t.svc.tick();
    expect(t.writes).toHaveLength(1);
    expect(t.winMan.claudeWtHeadIds).toHaveBeenCalledTimes(1);
    expect(t.winMan.claudeWtWindowSessions).toHaveBeenCalledTimes(1);
  });

  it('смена заголовка — пересчёт и запись сразу', () => {
    const t = setup({ windows: [{ id: 1, title: 'kid' }], sessions: { 1: 'k' }, children: ['k'] });
    t.world.windows = [{ id: 1, title: 'kid2' }];
    t.advance(3000);
    t.svc.tick();
    expect(t.writes).toHaveLength(2);
    expect(t.last()).toBe(`${BELL_HEADER} 1000003\nkid2\n`);
  });

  it('новый ребёнок в каталоге виден на обновлении раз в 15 с', () => {
    const t = setup({ windows: [{ id: 1, title: 'kid' }], sessions: { 1: 'k' } });
    t.world.children = new Set(['k']);
    t.advance(3000);
    t.svc.tick();
    expect(t.writes).toHaveLength(1);
    t.advance(12_000);
    t.svc.tick();
    expect(t.last()).toBe(`${BELL_HEADER} 1000015\nkid\n`);
  });

  it('свежая запись местного реестра — сразу, до каталога и привязки', () => {
    const t = setup({ windows: [{ id: 7, title: 'fresh' }] });
    t.world.registry = [{ sessionId: 'f', headId: 'h', windowId: 7, at: 1_000_000_000 }];
    t.advance(3000);
    t.svc.tick();
    expect(t.last()).toBe(`${BELL_HEADER} 1000003\nfresh\n`);
  });

  it('сердцебиение: тот же список переписывается раз в минуту со свежим временем', () => {
    const t = setup({ windows: [{ id: 1, title: 'kid' }], sessions: { 1: 'k' }, children: ['k'] });
    for (let i = 0; i < 19; i += 1) { t.advance(3000); t.svc.tick(); }
    expect(t.writes).toHaveLength(1);
    t.advance(3000);
    t.svc.tick();
    expect(t.writes).toHaveLength(2);
    expect(t.last()).toBe(`${BELL_HEADER} 1000060\nkid\n`);
  });

  it('claudeWt выключен — файл убирается, звенят все', () => {
    const t = setup({ windows: [{ id: 1, title: 'kid' }], sessions: { 1: 'k' }, children: ['k'] });
    t.world.enabled = false;
    t.svc.tick();
    expect(t.removed).toEqual(['H:/.wezterm-bell-children']);
    t.svc.tick();
    expect(t.removed).toHaveLength(1);
    t.world.enabled = true;
    t.svc.tick();
    expect(t.last()).toBe(`${BELL_HEADER} 1000000\nkid\n`);
  });

  it('stop убирает файл', () => {
    const t = setup({ windows: [{ id: 1, title: 'kid' }], sessions: { 1: 'k' }, children: ['k'] });
    t.svc.stop();
    expect(t.removed).toEqual(['H:/.wezterm-bell-children']);
  });

  it('сбой записи — одна строка в журнал, следующий тик пробует снова', () => {
    const t = setup({ windows: [{ id: 1, title: 'kid' }], sessions: { 1: 'k' }, children: ['k'] });
    const fail = () => { throw new Error('EACCES'); };
    t.world.write = fail;
    t.world.windows = [{ id: 1, title: 'kid2' }];
    t.svc.tick();
    t.svc.tick();
    expect(t.logs.filter(l => l.includes('EACCES'))).toHaveLength(1);
    t.world.write = (file, text) => t.writes.push([file, text]);
    t.svc.tick();
    expect(t.last()).toBe(`${BELL_HEADER} 1000000\nkid2\n`);
  });

  it('сбой пересчёта — сердцебиение не идёт, старый список протухает', () => {
    const t = setup({ windows: [{ id: 1, title: 'kid' }], sessions: { 1: 'k' }, children: ['k'] });
    t.winMan.claudeWtWindowSessions.mockImplementation(() => { throw new Error('index broken'); });
    t.world.windows = [{ id: 1, title: 'kid2' }];
    for (let i = 0; i < 100; i += 1) { t.advance(3000); t.svc.tick(); }
    expect(t.writes).toHaveLength(1);
    expect(t.logs.filter(l => l.includes('index broken'))).toHaveLength(1);
  });

  it('без getVisibleWindowIds служба не заводится', () => {
    const svc = startBellChildren({ winMan: {}, log: () => {} });
    expect(() => { svc.tick(); svc.stop(); }).not.toThrow();
  });
});
