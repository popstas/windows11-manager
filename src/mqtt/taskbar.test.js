import { describe, it, expect, vi } from 'vitest';
import { startTaskbarState } from './taskbar.js';

const WEZ = 'C:\\Program Files\\WezTerm\\wezterm-gui.exe';
const WT = 'C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal\\WindowsTerminal.exe';

function setup({ windows = [], agents = {}, control = true } = {}) {
  const calls = [];
  const logs = [];
  const world = { windows, agents, seen: {}, updated: {}, foreground: 0 };
  const winMan = {
    hasTaskbarControl: () => control,
    getVisibleWindowIds: vi.fn(() => world.windows.map(w => w.id)),
    getWindowById: vi.fn(id => {
      const w = world.windows.find(x => x.id === id);
      return w ? { path: w.path, getTitle: () => w.title } : null;
    }),
    claudeWtWindowAgents: vi.fn(list => list
      .filter(w => world.agents[w.id] !== undefined)
      .map(w => ({
        id: w.id, sessionId: `s${w.id}`, agentState: world.agents[w.id],
        agentSeen: Boolean(world.seen?.[w.id]), agentUpdated: world.updated?.[w.id] ?? 1,
      }))),
    getActiveWindowId: vi.fn(() => world.foreground ?? 0),
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

  it('работа — зелёная полоса, вопрос — жёлтая и мигание, ответ — мигание остаётся без полосы', () => {
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
    // Мигание с вопроса не перезапускается: Windows держит его до фокуса.
    expect(calls).toEqual([['progress', 1, 0, 0]]);
  });

  it('конец хода мигает один раз на переход, а не на каждом тике', () => {
    // Повторный FlashWindowEx перезапустил бы мигание и вернул оранжевый окну,
    // которое человек только что смотрел, — до того как focusedAt доедет.
    const { svc, winMan, world } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'active' } });
    svc.tick();
    winMan.flashWindow.mockClear();
    world.agents[1] = 'review';
    svc.tick();
    svc.tick();
    svc.tick();
    expect(winMan.flashWindow.mock.calls).toEqual([[1, true]]);
  });

  it('переход review → idle (уведомление о простое) мигание не гасит', () => {
    // Хук переводит сессию в idle через минуту после конца хода, хотя окно
    // никто не смотрел; оранжевый должен держаться до фокуса, как в wt.
    const { svc, calls, world } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'review' } });
    svc.tick();
    world.agents[1] = 'idle';
    calls.length = 0;
    svc.tick();
    svc.tick();
    expect(calls).toEqual([]);
    world.agents[1] = 'active';
    svc.tick();
    expect(calls).toEqual([['progress', 1, 2, 100], ['flash', 1, false]]);
  });

  it('простой без мигания до него ничего не зажигает', () => {
    const { svc, calls } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'idle' } });
    calls.length = 0;
    svc.tick();
    expect(calls).toEqual([]);
  });

  it('просмотренный конец хода гасит мигание и не зажигает его снова', () => {
    const { svc, calls, world } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'review' } });
    calls.length = 0;
    svc.tick();
    expect(calls).toEqual([['progress', 1, 0, 0], ['flash', 1, true]]);
    world.seen[1] = true;
    calls.length = 0;
    svc.tick();
    svc.tick();
    expect(calls).toEqual([['progress', 1, 0, 0], ['flash', 1, false]]);
  });

  it('после перезапуска службы мигает только непросмотренный конец хода', () => {
    const { svc, calls } = (() => {
      const s = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }, { id: 2, path: WEZ, title: 'b' }],
        agents: { 1: 'review', 2: 'review' } });
      s.world.seen[2] = true;
      return s;
    })();
    calls.length = 0;
    svc.tick();
    expect(calls).toEqual([['progress', 1, 0, 0], ['flash', 1, true]]);
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

  it('окно, которое и так впереди, не зажигается', () => {
    const { svc, winMan, logs, world } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'active' } });
    svc.tick();
    winMan.flashWindow.mockClear();
    world.foreground = 1;
    world.agents[1] = 'review';
    svc.tick();
    expect(winMan.flashWindow).not.toHaveBeenCalled();
    expect(logs.at(-1)).toMatch(/flash skip \(foreground\)/);
    // И потом, когда человек уйдёт с окна, — тоже: он его видел.
    world.foreground = 2;
    svc.tick();
    expect(winMan.flashWindow).not.toHaveBeenCalled();
  });

  it('dismiss гасит подсветку сразу, без ожидания тика, и держит её погашенной', () => {
    const { svc, winMan, world } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'review' } });
    world.updated[1] = 1;
    svc.tick();
    winMan.flashWindow.mockClear();
    svc.dismiss('s1');
    expect(winMan.flashWindow.mock.calls).toEqual([[1, false]]);
    svc.tick();
    svc.tick();
    expect(winMan.flashWindow.mock.calls).toEqual([[1, false]]);
  });

  it('следующий законченный ход после dismiss загорается снова', () => {
    const { svc, winMan, world } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'review' } });
    world.updated[1] = 1;
    svc.tick();
    svc.dismiss('s1');
    world.agents[1] = 'active';
    world.updated[1] = Math.floor(Date.now() / 1000) + 60;
    svc.tick();
    winMan.flashWindow.mockClear();
    world.agents[1] = 'review';
    world.updated[1] += 10;
    svc.tick();
    expect(winMan.flashWindow.mock.calls).toEqual([[1, true]]);
  });

  it('undismiss возвращает подсветку непросмотренному ходу', () => {
    const { svc, winMan, world } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'review' } });
    world.updated[1] = 1;
    svc.tick();
    svc.dismiss('s1');
    winMan.flashWindow.mockClear();
    svc.undismiss('s1');
    expect(winMan.flashWindow.mock.calls).toEqual([[1, true]]);
  });

  it('dismiss сессии без окна ничего не ломает и не зовёт аддон', () => {
    const { svc, winMan } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'active' } });
    svc.tick();
    winMan.flashWindow.mockClear();
    svc.dismiss('nope');
    svc.undismiss('nope');
    expect(winMan.flashWindow).not.toHaveBeenCalled();
  });
});
