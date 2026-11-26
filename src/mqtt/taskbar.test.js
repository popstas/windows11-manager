import { describe, it, expect, vi } from 'vitest';
import { startTaskbarState } from './taskbar.js';

const WEZ = 'C:\\Program Files\\WezTerm\\wezterm-gui.exe';
const WT = 'C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal\\WindowsTerminal.exe';

function setup({ windows = [], agents = {}, control = true, bellQuiet } = {}) {
  const calls = [];
  const logs = [];
  const world = { windows, agents, seen: {}, updated: {}, shell: {}, quiet: {}, unread: {}, foreground: 0, now: 0 };
  const timers = [];
  const cleared = [];
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
        shell: Boolean(world.shell?.[w.id]),
        agentQuiet: Boolean(world.quiet?.[w.id]), agentUnread: Boolean(world.unread?.[w.id]),
      }))),
    getActiveWindowId: vi.fn(() => world.foreground ?? 0),
    setTaskbarProgress: vi.fn((id, state, value) => calls.push(['progress', id, state, value])),
    flashWindow: vi.fn((id, on) => calls.push(['flash', id, on])),
  };
  const svc = startTaskbarState({
    winMan,
    log: (m, level = 'info') => logs.push(`${level}: ${m}`),
    setIntervalFn: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearIntervalFn: t => cleared.push(t),
    nowSec: () => world.now,
    ...(bellQuiet ? { bellQuiet } : {}),
  });
  return { svc, calls, logs, winMan, world, timers, cleared };
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

  it('dismiss гасит и сессию в idle (Shift+клик через минуту после конца хода)', () => {
    // Так и было у Стаса 16.11: ход закончился, через минуту хук поставил idle,
    // и отметка «отпущено» тонула в правиле «idle мигание не трогает».
    const { svc, winMan, world } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'review' } });
    world.updated[1] = 1;
    svc.tick();
    world.agents[1] = 'idle';
    world.updated[1] = 2;
    svc.tick();
    winMan.flashWindow.mockClear();
    svc.dismiss('s1');
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

  it('markUnread зажигает просмотренную сессию в idle и держит, пока хук не напишет новое', () => {
    const { svc, winMan, world } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'idle' } });
    world.updated[1] = 1;
    world.seen[1] = true;
    svc.tick();
    winMan.flashWindow.mockClear();
    svc.markUnread('s1');
    expect(winMan.flashWindow.mock.calls).toEqual([[1, true]]);
    svc.tick();
    expect(winMan.flashWindow.mock.calls).toEqual([[1, true]]);
    world.agents[1] = 'active';
    world.updated[1] = Math.floor(Date.now() / 1000) + 60;
    svc.tick();
    expect(winMan.flashWindow.mock.calls).toEqual([[1, true], [1, false]]);
  });

  it('markUnread после dismiss зажигает снова, dismiss после markUnread гасит', () => {
    const { svc, winMan, world } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'review' } });
    world.updated[1] = 1;
    svc.tick();
    svc.dismiss('s1');
    winMan.flashWindow.mockClear();
    svc.markUnread('s1');
    svc.dismiss('s1');
    expect(winMan.flashWindow.mock.calls).toEqual([[1, true], [1, false]]);
  });

  it('dismiss сессии без окна ничего не ломает и не зовёт аддон', () => {
    const { svc, winMan } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'active' } });
    svc.tick();
    winMan.flashWindow.mockClear();
    svc.dismiss('nope');
    svc.markUnread('nope');
    expect(winMan.flashWindow).not.toHaveBeenCalled();
  });

  it('фоновая команда при законченном ходе — зелёная полоса на 2%, её конец снимает полосу', () => {
    const { svc, calls, world } = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'idle' } });
    world.shell[1] = true;
    world.seen[1] = true;
    calls.length = 0;
    svc.tick();
    expect(calls).toEqual([['progress', 1, 2, 2]]);
    calls.length = 0;
    svc.tick();
    expect(calls).toEqual([]);
    world.shell[1] = false;
    svc.tick();
    expect(calls).toEqual([['progress', 1, 0, 0]]);
  });

  it('resync([id]) — вид кнопки этого окна ставится заново', () => {
    // После addTab кнопка новая: полоса и подсветка старой пропали.
    const { svc, calls } = setup({
      windows: [{ id: 1, path: WEZ, title: 'a' }, { id: 2, path: WEZ, title: 'b' }],
      agents: { 1: 'question', 2: 'active' },
    });
    svc.tick();
    calls.length = 0;
    svc.tick();
    expect(calls, 'без resync тик ничего не ставит').toEqual([]);
    svc.resync([1]);
    svc.tick();
    expect(calls).toEqual([['progress', 1, 8, 22], ['flash', 1, true]]);
  });

  it('заглушка тоже умеет resync', () => {
    const { svc } = setup({ control: false });
    expect(() => svc.resync([1])).not.toThrow();
  });
});

describe('тихий конец хода (quiet)', () => {
  const quietSpy = () => {
    const writes = [];
    return { writes, drops: { n: 0 }, update(keys) { writes.push(keys); }, drop() { this.drops.n += 1; } };
  };

  it('тихий review не зажигает кнопку, а уже горящую гасит', () => {
    const { svc, calls, world } = setup({ windows: [{ id: 1, path: WEZ, title: 'h' }], agents: { 1: 'review' } });
    calls.length = 0;
    svc.tick();
    expect(calls).toEqual([['progress', 1, 0, 0], ['flash', 1, true]]);
    world.agents[1] = 'idle';
    world.quiet[1] = true;
    calls.length = 0;
    svc.tick();
    expect(calls).toEqual([['progress', 1, 0, 0], ['flash', 1, false]]);
  });

  it('тихий с первого тика — ничего не зажигается', () => {
    const { svc, calls, world } = setup({ windows: [{ id: 1, path: WEZ, title: 'h' }], agents: { 1: 'active' } });
    svc.tick();
    world.agents[1] = 'review';
    world.quiet[1] = true;
    calls.length = 0;
    svc.tick();
    expect(calls).toEqual([['progress', 1, 0, 0]]);
  });

  it('«непросмотрено» в слоте сильнее тихого', () => {
    const { svc, calls, world } = setup({ windows: [{ id: 1, path: WEZ, title: 'h' }], agents: { 1: 'active' } });
    svc.tick();
    Object.assign(world, { agents: { 1: 'review' }, quiet: { 1: true }, unread: { 1: true } });
    calls.length = 0;
    svc.tick();
    expect(calls).toEqual([['progress', 1, 0, 0], ['flash', 1, true]]);
  });

  it('markUnread зажигает тихую сессию', () => {
    const { svc, calls, world } = setup({ windows: [{ id: 1, path: WEZ, title: 'h' }], agents: { 1: 'idle' } });
    world.quiet[1] = true;
    svc.tick();
    calls.length = 0;
    world.now = 5;
    svc.markUnread('s1');
    expect(calls).toContainEqual(['flash', 1, true]);
  });

  it('пишет ключи тихих окон WezTerm в список звонка', () => {
    const spy = quietSpy();
    const { svc, world } = setup({
      windows: [{ id: 1, path: WEZ, title: '✳ pf-inbox-head' }, { id: 2, path: WEZ, title: 'kid' }],
      agents: { 1: 'review', 2: 'active' }, bellQuiet: spy,
    });
    world.quiet[1] = true;
    svc.tick();
    expect(spy.writes.at(-1)).toEqual(['pf-inbox-head']);
    world.unread[1] = true;
    svc.tick();
    expect(spy.writes.at(-1)).toEqual([]);
  });

  it('без окон WezTerm — пустой список (сердцебиение), stop() и сбой тика его убирают', () => {
    const spy = quietSpy();
    const { svc, winMan } = setup({ windows: [{ id: 2, path: WT, title: 'b' }], bellQuiet: spy });
    svc.tick();
    expect(spy.writes.at(-1)).toEqual([]);
    winMan.getVisibleWindowIds.mockImplementation(() => { throw new Error('boom'); });
    svc.tick();
    expect(spy.drops.n).toBe(1);
    svc.stop();
    expect(spy.drops.n).toBe(2);
  });

  it('аддон без управления кнопками — список убирается, звенят все', () => {
    const spy = quietSpy();
    setup({ control: false, bellQuiet: spy });
    expect(spy.drops.n).toBe(1);
  });
});

describe('cacheWarn — мигание перед остыванием кеша', () => {
  const AT = 1_000_000;
  const END = AT + 3595;
  const body = (warnMin = 10) => JSON.stringify({ warnMin, sessions: [{ id: 's1', cacheAt: AT }] });
  function waiting(state = 'review') {
    const t = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: state } });
    t.world.updated[1] = AT;
    t.world.now = END - 300;
    t.svc.tick();
    t.calls.length = 0;
    return t;
  }
  const blinkTimer = timers => timers.find(t => t.ms === 750);

  it('окно на пороге получает paused 100, через кадр — свою полосу', () => {
    const { svc, calls, timers } = waiting();
    svc.cacheWarn(body());
    expect(calls).toEqual([['progress', 1, 8, 100]]);
    calls.length = 0;
    blinkTimer(timers).fn();
    expect(calls).toEqual([['progress', 1, 0, 0]]);
    calls.length = 0;
    blinkTimer(timers).fn();
    expect(calls).toEqual([['progress', 1, 8, 100]]);
  });

  it('isBlinking — мигает ли окно сейчас (для прятания кнопок)', () => {
    const { svc, world } = waiting();
    expect(svc.isBlinking(1)).toBe(false);
    svc.cacheWarn(body());
    expect(svc.isBlinking(1)).toBe(true);
    expect(svc.isBlinking(2)).toBe(false);
    world.foreground = 1;
    svc.tick();
    svc.cacheWarn(body());
    svc.stop();
    expect(svc.isBlinking(1), 'stop гасит мигание').toBe(false);
    expect(setup({ control: false }).svc.isBlinking(1), 'заглушка').toBe(false);
  });

  it('до порога не мигает', () => {
    const { svc, calls, timers, world } = waiting();
    world.now = END - 601;
    svc.cacheWarn(body());
    expect(calls).toEqual([]);
    expect(blinkTimer(timers)).toBeUndefined();
  });

  it('окно впереди снимает мигание, и тот же набор повтором его не зажигает', () => {
    const { svc, calls, timers, world } = waiting();
    svc.cacheWarn(body());
    world.foreground = 1;
    calls.length = 0;
    blinkTimer(timers).fn();
    expect(calls).toEqual([['progress', 1, 0, 0]]);
    world.foreground = 0;
    calls.length = 0;
    svc.cacheWarn(body());
    svc.tick();
    expect(calls).toEqual([]);
  });

  it('новая метка кеша после снятия мигает снова', () => {
    const { svc, calls, timers, world } = waiting();
    svc.cacheWarn(body());
    world.foreground = 1;
    blinkTimer(timers).fn();
    world.foreground = 0;
    world.now += 600;
    world.updated[1] = AT + 600;
    calls.length = 0;
    svc.cacheWarn(JSON.stringify({ warnMin: 10, sessions: [{ id: 's1', cacheAt: AT + 600 }] }));
    expect(calls).toEqual([['progress', 1, 8, 100]]);
  });

  it('warnMin 0 гасит уже мигающее окно и возвращает вид question (paused 22)', () => {
    const { svc, calls, cleared } = waiting('question');
    svc.cacheWarn(body());
    calls.length = 0;
    svc.cacheWarn(body(0));
    expect(calls).toEqual([['progress', 1, 8, 22]]);
    expect(cleared.length).toBeGreaterThan(0);
  });

  it('фоновая команда: фаза «выкл» — зелёная 2%', () => {
    const t = setup({ windows: [{ id: 1, path: WEZ, title: 'a' }], agents: { 1: 'idle' } });
    t.world.updated[1] = AT;
    t.world.shell[1] = true;
    t.world.now = END - 300;
    t.svc.tick();
    t.svc.cacheWarn(body());
    t.calls.length = 0;
    blinkTimer(t.timers).fn();
    expect(t.calls).toEqual([['progress', 1, 2, 2]]);
  });

  it('Mark seen снимает мигание', () => {
    const { svc, calls } = waiting();
    svc.cacheWarn(body());
    calls.length = 0;
    svc.dismiss('s1');
    expect(calls).toContainEqual(['progress', 1, 0, 0]);
    expect(calls).not.toContainEqual(['progress', 1, 8, 100]);
    calls.length = 0;
    svc.cacheWarn(body());
    expect(calls).toEqual([]);
  });

  it('работа агента гасит мигание, не дожидаясь нового набора', () => {
    const { svc, calls, world } = waiting();
    svc.cacheWarn(body());
    world.agents[1] = 'active';
    calls.length = 0;
    svc.tick();
    expect(calls).toContainEqual(['progress', 1, 2, 100]);
    expect(calls).not.toContainEqual(['progress', 1, 8, 100]);
  });

  it('кеш истёк — мигание кончается само', () => {
    const { svc, calls, world, cleared } = waiting();
    svc.cacheWarn(body());
    world.now = END;
    calls.length = 0;
    svc.tick();
    expect(calls).toEqual([['progress', 1, 0, 0]]);
    expect(cleared.length).toBeGreaterThan(0);
  });

  it('новый ход, ушедший в idle, не зажигает мигание на старой метке кеша', () => {
    // Ответ на 40-й минуте без фокуса окна (head пишет исполнителю), через
    // минуту хук переводит сессию в idle — старый набор ещё у службы.
    const { svc, calls, world } = waiting();
    world.now = END - 1200;
    svc.cacheWarn(body());
    world.agents[1] = 'active';
    world.updated[1] = AT + 2400;
    svc.tick();
    world.agents[1] = 'review';
    world.updated[1] = AT + 2460;
    svc.tick();
    world.agents[1] = 'idle';
    world.updated[1] = AT + 2520;
    svc.tick();
    world.now = END - 300;
    calls.length = 0;
    svc.tick();
    expect(calls).not.toContainEqual(['progress', 1, 8, 100]);
  });

  it('Mark seen до порога не отменяет будущее мигание', () => {
    const { svc, calls, world } = waiting();
    world.now = END - 3000;
    svc.cacheWarn(body());
    svc.dismiss('s1');
    world.now = END - 300;
    calls.length = 0;
    svc.tick();
    expect(calls).toContainEqual(['progress', 1, 8, 100]);
  });

  it('stop() снимает полосу и у мигающего окна без вида в applied', () => {
    const { svc, calls, world } = waiting();
    world.seen[1] = true;
    svc.tick();
    svc.cacheWarn(body());
    calls.length = 0;
    svc.stop();
    expect(calls).toContainEqual(['progress', 1, 0, 0]);
  });

  it('ошибка аддона в кадре мигания не роняет таймер', () => {
    const { svc, timers, winMan, logs } = waiting();
    svc.cacheWarn(body());
    winMan.setTaskbarProgress.mockImplementation(() => { throw new Error('boom'); });
    expect(() => blinkTimer(timers).fn()).not.toThrow();
    expect(logs.some(l => l.includes('boom'))).toBe(true);
  });

  it('без мигающих таймер мигания не заведён, stop() его снимает', () => {
    const { svc, timers, cleared } = waiting();
    expect(blinkTimer(timers)).toBeUndefined();
    svc.cacheWarn(body());
    const id = timers.indexOf(blinkTimer(timers)) + 1;
    svc.stop();
    expect(cleared).toContain(id);
  });
});
