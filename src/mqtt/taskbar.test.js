import { describe, it, expect, vi } from 'vitest';
import { startTaskbarState } from './taskbar.js';

const WEZ = 'C:\\Program Files\\WezTerm\\wezterm-gui.exe';
const WT = 'C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal\\WindowsTerminal.exe';

function setup({ windows = [], agents = {}, control = true } = {}) {
  const calls = [];
  const logs = [];
  const world = { windows, agents };
  const winMan = {
    hasTaskbarControl: () => control,
    getVisibleWindowIds: vi.fn(() => world.windows.map(w => w.id)),
    getWindowById: vi.fn(id => {
      const w = world.windows.find(x => x.id === id);
      return w ? { path: w.path, getTitle: () => w.title } : null;
    }),
    claudeWtWindowAgents: vi.fn(list => list
      .filter(w => world.agents[w.id] !== undefined)
      .map(w => ({ id: w.id, sessionId: `s${w.id}`, agentState: world.agents[w.id] }))),
    setTaskbarProgress: vi.fn((id, state, value) => calls.push(['progress', id, state, value])),
    flashWindow: vi.fn((id, on) => calls.push(['flash', id, on])),
  };
  const svc = startTaskbarState({
    winMan,
    log: (m, level = 'info') => logs.push(`${level}: ${m}`),
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });
  return { svc, calls, logs, winMan, world };
}

describe('startTaskbarState', () => {
  it('на старте снимает закраску со всех окон WezTerm, окна wt не трогает', () => {
    // Трей гасит службу через kill: прежний процесс сбросить ничего не успел.
    const { calls } = setup({ windows: [
      { id: 1, path: WEZ, title: 'a' },
      { id: 2, path: WT, title: 'b' },
    ] });
    expect(calls).toEqual([['progress', 1, 0, 0], ['flash', 1, false]]);
  });

  it('без окон WezTerm в сеть не ходит', () => {
    const { svc, winMan } = setup({ windows: [{ id: 2, path: WT, title: 'b' }] });
    svc.tick();
    expect(winMan.claudeWtWindowAgents).not.toHaveBeenCalled();
  });

  it('работа — зелёная полоса, вопрос — жёлтая и мигание, ответ — сброс', () => {
    const { svc, calls, world } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'active' } });
    calls.length = 0;
    svc.tick();
    expect(calls).toEqual([['progress', 1, 2, 100]]);
    world.agents[1] = 'question';
    calls.length = 0;
    svc.tick();
    expect(calls).toEqual([['progress', 1, 8, 22], ['flash', 1, true]]);
    calls.length = 0;
    svc.tick();
    expect(calls).toEqual([]);
    world.agents[1] = 'review';
    svc.tick();
    expect(calls).toEqual([['progress', 1, 0, 0], ['flash', 1, false]]);
  });

  it('путь к exe читается один раз на hwnd', () => {
    const { svc, winMan } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'active' } });
    svc.tick();
    svc.tick();
    expect(winMan.getWindowById).toHaveBeenCalledTimes(1);
  });

  it('stop() снимает то, что закрашено', () => {
    const { svc, calls } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'question' } });
    svc.tick();
    calls.length = 0;
    svc.stop();
    expect(calls).toEqual([['progress', 1, 0, 0], ['flash', 1, false]]);
  });

  it('аддон без новых функций — одно предупреждение и ни одного вызова', () => {
    const { svc, calls, logs } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], control: false });
    svc.tick();
    expect(calls).toEqual([]);
    expect(logs.filter(l => l.startsWith('warn:'))).toHaveLength(1);
  });

  it('повторяющаяся ошибка пишется в журнал один раз', () => {
    const { svc, winMan, logs } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }] });
    winMan.claudeWtWindowAgents.mockImplementation(() => { throw new Error('V: недоступен'); });
    svc.tick();
    svc.tick();
    expect(logs.filter(l => l.includes('V: недоступен'))).toHaveLength(1);
  });
});
