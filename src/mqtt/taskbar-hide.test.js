import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTaskbarHide, TASKBAR_HIDE_TTL_MS, TASKBAR_REHIDE_MS } from './taskbar-hide.js';
import { createTaskbarHideStore } from '../claude-wt/taskbar-hide-store.js';

const WEZ = 'C:\\Program Files\\WezTerm\\wezterm-gui.exe';
const WT = 'C:\\WindowsTerminal.exe';
const CHROME = 'C:\\chrome.exe';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function setup({ windows, sessions = {}, agents = {}, control = true, withStore = true } = {}) {
  const logs = [];
  const shown = [];
  const calls = [];
  const timers = [];
  const cleared = [];
  let clock = 0;
  const world = {
    windows: windows ?? [
      { id: 1, path: WT, title: 'a' },
      { id: 2, path: WEZ, title: 'b' },
      { id: 3, path: CHROME, title: 'chrome' },
    ],
    sessions,
    agents,
    tray: 100,
  };
  const winMan = {
    hasTabControl: () => control,
    getVisibleWindowIds: vi.fn(() => world.windows.map(w => w.id)),
    getWindowById: vi.fn(id => {
      const w = world.windows.find(x => x.id === id);
      return w ? { path: w.path, getTitle: () => w.title } : null;
    }),
    isTerminalWindow: w => w.path === WEZ || w.path === WT,
    claudeWtWindowSessions: vi.fn(list => list
      .filter(w => world.sessions[w.id])
      .map(w => ({ id: w.id, sessionId: world.sessions[w.id], title: w.title }))),
    claudeWtWindowAgents: vi.fn(list => list
      .filter(w => world.sessions[w.id])
      .map(w => ({
        id: w.id, sessionId: world.sessions[w.id], title: w.title,
        agentState: world.agents[w.id]?.state ?? null, agentSeen: Boolean(world.agents[w.id]?.seen),
      }))),
    getTaskbarWindow: vi.fn(() => world.tray),
    deleteTab: vi.fn(id => { calls.push(['delete', id]); return true; }),
    addTab: vi.fn(id => { calls.push(['add', id]); return true; }),
  };
  let store = null;
  if (withStore) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskbar-hide-'));
    dirs.push(dir);
    store = createTaskbarHideStore({ file: path.join(dir, 'session-taskbar.json'), now: () => clock });
  }
  const svc = startTaskbarHide({
    winMan,
    log: (m, level = 'info') => logs.push(`${level}: ${m}`),
    store,
    onShown: ids => shown.push(ids),
    now: () => clock,
    setIntervalFn: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearIntervalFn: t => cleared.push(t),
  });
  const reset = () => { calls.length = 0; shown.length = 0; logs.length = 0; };
  return {
    svc, winMan, world, store, logs, shown, calls, timers, cleared, reset,
    advance: ms => { clock += ms; },
  };
}

describe('startTaskbarHide', () => {
  it('старт возвращает кнопки всем окнам терминалов', () => {
    // Прошлый процесс мог быть убит taskkill и не вернуть спрятанное.
    const { winMan, calls, timers } = setup();
    expect(calls).toEqual([['add', 1], ['add', 2]]);
    expect(winMan.addTab).not.toHaveBeenCalledWith(3);
    expect(timers.map(t => t.ms)).toEqual([3000]);
  });

  it('набор прячет, сигнал возвращает', () => {
    const { svc, world, calls, shown, logs, reset } = setup({ sessions: { 1: A, 2: B } });
    reset();
    expect(svc.setSet({ sessions: [A] })).toBe(1);
    expect(calls).toEqual([['delete', 1]]);
    expect(logs).toContain(`info: taskbar hide: 1 ${A} спрятана`);
    reset();
    svc.tick();
    expect(calls, 'спрятанное второй раз не прячется').toEqual([]);
    world.agents[1] = { state: 'question' };
    svc.tick();
    expect(calls).toEqual([['add', 1]]);
    expect(shown).toEqual([[1]]);
    expect(logs).toContain(`info: taskbar hide: 1 ${A} возвращена`);
  });

  it('непросмотренный итог возвращает кнопку, просмотренный — нет', () => {
    const { svc, world, calls, reset } = setup({ sessions: { 1: A }, agents: { 1: { state: 'review', seen: true } } });
    reset();
    svc.setSet({ sessions: [A] });
    expect(calls).toEqual([['delete', 1]]);
    world.agents[1] = { state: 'review', seen: false };
    reset();
    svc.tick();
    expect(calls).toEqual([['add', 1]]);
  });

  it('набор старше 20 минут — кнопки вернулись', () => {
    const { svc, calls, shown, logs, advance, reset } = setup({ sessions: { 1: A } });
    reset();
    svc.setSet({ sessions: [A] });
    advance(TASKBAR_HIDE_TTL_MS);
    svc.tick();
    expect(calls.filter(c => c[0] === 'add'), 'ровно на сроке набор ещё жив').toEqual([]);
    advance(1);
    calls.length = 0;
    svc.tick();
    expect(calls).toEqual([['add', 1]]);
    expect(shown).toEqual([[1]]);
    expect(logs.filter(l => l.includes('набор протух'))).toEqual(['info: taskbar hide: набор протух']);
    svc.tick();
    expect(logs.filter(l => l.includes('набор протух')), 'строка — один раз').toHaveLength(1);
  });

  it('свежий набор после протухшего снова прячет', () => {
    const { svc, calls, advance, reset } = setup({ sessions: { 1: A } });
    svc.setSet({ sessions: [A] });
    advance(TASKBAR_HIDE_TTL_MS + 1);
    svc.tick();
    reset();
    svc.setSet({ sessions: [A] });
    expect(calls).toEqual([['delete', 1]]);
  });

  it('смена hwnd панели задач — спрятанные спрятаны снова', () => {
    // Замер на nb: кнопку возвращает только перезапуск explorer.
    const { svc, world, calls, logs, reset } = setup({ sessions: { 1: A, 2: B } });
    svc.setSet({ sessions: [A] });
    reset();
    world.tray = 0;
    svc.tick();
    expect(calls, 'панели нет — ждать, а не прятать в пустоту').toEqual([]);
    world.tray = 200;
    svc.tick();
    expect(calls).toEqual([['delete', 1]]);
    expect(logs.filter(l => l.includes('спрятана')), 'перепрятывание не пишет строку на окно').toEqual([]);
    reset();
    svc.tick();
    expect(calls).toEqual([]);
  });

  it('панели задач нет — набор ждёт её, а не прячет в пустоту', () => {
    const { svc, world, calls, reset } = setup({ sessions: { 1: A } });
    reset();
    world.tray = 0;
    svc.setSet({ sessions: [A] });
    expect(calls).toEqual([]);
    world.tray = 300;
    svc.tick();
    expect(calls).toEqual([['delete', 1]]);
  });

  it('через 60 с без событий спрятанные прячутся снова, раньше — нет', () => {
    const { svc, calls, advance, reset } = setup({ sessions: { 1: A, 2: B } });
    advance(5000);
    svc.setSet({ sessions: [A] });
    reset();
    advance(TASKBAR_REHIDE_MS - 1);
    svc.tick();
    expect(calls, 'отсчёт идёт от того, как кнопка спрятана, а не от старта').toEqual([]);
    advance(1);
    svc.tick();
    expect(calls).toEqual([['delete', 1]]);
    reset();
    advance(TASKBAR_REHIDE_MS - 1);
    svc.tick();
    expect(calls).toEqual([]);
    advance(1);
    svc.tick();
    expect(calls).toEqual([['delete', 1]]);
  });

  it('явная hide снимается новым ходом', () => {
    const { svc, world, store, calls, shown, reset } = setup({ sessions: { 1: A }, agents: { 1: { state: 'active' } } });
    store.set(A, 'hide');
    reset();
    svc.tick();
    expect(calls).toEqual([['delete', 1]]);
    expect(store.get(A), 'отметка получила hwnd окна').toEqual({ mode: 'hide', hwnd: 1 });
    world.agents[1] = { state: 'review', seen: true };
    svc.tick();
    expect(store.get(A)).toEqual({ mode: 'hide', hwnd: 1, sawIdle: true });
    world.agents[1] = { state: 'active' };
    reset();
    svc.tick();
    expect(calls).toEqual([['add', 1]]);
    expect(shown).toEqual([[1]]);
    expect(store.get(A), 'запись из store ушла').toBeUndefined();
  });

  it('явная hide переживает свой же ход', () => {
    // Агент спрятал окно посреди своего хода — этим ходом отметка не снимается.
    const { svc, store, calls, reset } = setup({ sessions: { 1: A }, agents: { 1: { state: 'active' } } });
    store.set(A, 'hide');
    reset();
    svc.tick();
    svc.tick();
    expect(calls).toEqual([['delete', 1]]);
    expect(store.get(A)).toEqual({ mode: 'hide', hwnd: 1 });
  });

  it('состояние агента неизвестно — sawIdle не ставится', () => {
    // nextExplicit считает «не active» паузой: null без этой проверки снял бы
    // отметку собственным ходом агента.
    const { svc, store, winMan } = setup({ sessions: { 1: A } });
    store.set(A, 'hide');
    svc.tick();
    expect(store.get(A), 'agentState: null').toEqual({ mode: 'hide', hwnd: 1 });
    winMan.claudeWtWindowAgents.mockImplementation(() => []);
    svc.tick();
    expect(store.get(A)).toEqual({ mode: 'hide', hwnd: 1 });
  });

  it('явная hide не перебивает сигнал', () => {
    const { svc, store, calls, reset } = setup({ sessions: { 1: A }, agents: { 1: { state: 'question' } } });
    store.set(A, 'hide');
    reset();
    svc.tick();
    expect(calls).toEqual([]);
    expect(svc.statusOf(A)).toEqual({ applied: false, reason: 'session needs attention' });
  });

  it('явная show держит кнопку сессии из набора', () => {
    const { svc, store, calls, reset } = setup({ sessions: { 1: A } });
    store.set(A, 'show');
    reset();
    svc.setSet({ sessions: [A] });
    expect(calls).toEqual([]);
    expect(svc.statusOf(A)).toEqual({ applied: true });
  });

  it('закрытое окно снимает явную отметку', () => {
    const { svc, world, store, calls, reset } = setup({ sessions: { 1: A, 2: B } });
    store.set(A, 'hide');
    store.set(B, 'show');
    svc.tick();
    expect(store.get(A)).toEqual({ mode: 'hide', hwnd: 1 });
    expect(store.get(B)).toEqual({ mode: 'show', hwnd: 2 });
    world.windows = [];
    reset();
    svc.tick();
    expect(store.get(A)).toBeUndefined();
    expect(store.get(B)).toBeUndefined();
    expect(calls, 'закрытому окну кнопку не возвращают').toEqual([]);
  });

  it('смена вкладки wt не снимает отметку: окно живо', () => {
    const { svc, world, store } = setup({ sessions: { 1: A } });
    store.set(A, 'hide');
    svc.tick();
    delete world.sessions[1];
    svc.tick();
    expect(store.get(A)).toEqual({ mode: 'hide', hwnd: 1 });
  });

  it('отметка без окна ждёт его', () => {
    const { svc, world, store, calls, reset } = setup({ sessions: {} });
    store.set(A, 'hide');
    svc.tick();
    expect(store.get(A)).toEqual({ mode: 'hide' });
    world.sessions[2] = A;
    reset();
    svc.tick();
    expect(store.get(A)).toEqual({ mode: 'hide', hwnd: 2 });
    expect(calls).toEqual([['delete', 2]]);
  });

  it('showAll и stop возвращают всё', () => {
    const { svc, store, calls, shown, timers, cleared, reset } = setup({ sessions: { 1: A, 2: B } });
    store.set(B, 'hide');
    svc.setSet({ sessions: [A] });
    expect(calls.filter(c => c[0] === 'delete')).toEqual([['delete', 1], ['delete', 2]]);
    reset();
    expect(svc.showAll()).toBe(2);
    expect(calls).toEqual([['add', 1], ['add', 2]]);
    expect(shown, 'вернувшиеся кнопки новые — значки ставятся заново').toEqual([[1, 2]]);
    expect(store.ids(), 'явные отметки сброшены').toEqual([]);
    reset();
    svc.tick();
    expect(calls, 'набор сброшен тоже').toEqual([]);

    svc.setSet({ sessions: [A, B] });
    reset();
    svc.stop();
    expect(cleared).toEqual([timers.length]);
    expect(calls).toEqual([['add', 1], ['add', 2]]);
  });

  it('пустой набор и нет отметок — сеть не трогается', () => {
    const { svc, winMan } = setup({ sessions: { 1: A } });
    svc.tick();
    svc.setSet({ sessions: [] });
    expect(winMan.claudeWtWindowSessions).not.toHaveBeenCalled();
    expect(winMan.claudeWtWindowAgents).not.toHaveBeenCalled();
  });

  it('состояние агента спрашивается только у кандидатов', () => {
    const { svc, winMan } = setup({ sessions: { 1: A, 2: B } });
    svc.setSet({ sessions: [A] });
    expect(winMan.claudeWtWindowAgents).toHaveBeenLastCalledWith([{ id: 1, title: 'a' }]);
  });

  it('неудавшийся deleteTab повторяется, неудавшийся addTab — тоже', () => {
    const { svc, world, winMan, calls, shown, reset } = setup({ sessions: { 1: A } });
    winMan.deleteTab.mockImplementationOnce(id => { calls.push(['delete', id]); return false; });
    reset();
    svc.setSet({ sessions: [A] });
    svc.tick();
    expect(calls).toEqual([['delete', 1], ['delete', 1]]);
    world.agents[1] = { state: 'question' };
    winMan.addTab.mockImplementationOnce(id => { calls.push(['add', id]); return false; });
    reset();
    svc.tick();
    expect(shown).toEqual([]);
    svc.tick();
    expect(calls).toEqual([['add', 1], ['add', 1]]);
    expect(shown).toEqual([[1]]);
  });

  it('statusOf: auto, нет окна, спрятана', () => {
    const { svc, store } = setup({ sessions: { 1: A } });
    expect(svc.statusOf(A), 'без отметки решает пикер — встало').toEqual({ applied: true });
    store.set(B, 'hide');
    svc.tick();
    expect(svc.statusOf(B)).toEqual({ applied: false, reason: 'no window' });
    store.set(A, 'hide');
    svc.tick();
    expect(svc.statusOf(A)).toEqual({ applied: true });
    store.set(A, null);
    store.set(B, null);
    svc.tick();
    expect(svc.statusOf(A), 'auto после ранней выписки — не «нет окна»').toEqual({ applied: true });
  });

  it('без DeleteTab/AddTab в аддоне — заглушка и одна строка warn', () => {
    const { svc, winMan, logs } = setup({ control: false });
    expect(winMan.addTab).not.toHaveBeenCalled();
    expect(logs.filter(l => l.startsWith('warn:'))).toHaveLength(1);
    expect(svc.setSet({ sessions: [A] })).toBe(0);
    expect(svc.statusOf(A)).toEqual({ applied: false, reason: 'no taskbar tab support' });
    expect(svc.showAll()).toBe(0);
    svc.tick();
    svc.stop();
    expect(winMan.deleteTab).not.toHaveBeenCalled();
  });

  it('сбой тика пишется один раз и не роняет службу', () => {
    const { svc, winMan, logs } = setup({ sessions: { 1: A } });
    svc.setSet({ sessions: [A] });
    winMan.claudeWtWindowSessions.mockImplementation(() => { throw new Error('V: недоступен'); });
    expect(() => { svc.tick(); svc.tick(); }).not.toThrow();
    expect(logs.filter(l => l.includes('V: недоступен'))).toEqual(['warn: taskbar hide: V: недоступен']);
  });
});
