import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  startTaskbarHide, returnTerminalTabs,
  TASKBAR_HIDE_TTL_MS, TASKBAR_REHIDE_MS, TASKBAR_REHIDE_TICKS_AFTER_TRAY, TASKBAR_STALE_GRACE_MS,
  MINIMIZED_HIDE_DELAY_MS,
} from './taskbar-hide.js';
import { createTaskbarHideStore } from '../claude-wt/taskbar-hide-store.js';
import { taskbarHideCommands } from '../commands/taskbar-hide-commands.js';

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
    blinking: new Set(),
    boundsOf: [],
  };
  const winMan = {
    hasTabControl: () => control,
    getVisibleWindowIds: vi.fn(() => world.windows.filter(w => !w.invisible).map(w => w.id)),
    getWindowById: vi.fn(id => {
      const w = world.windows.find(x => x.id === id);
      // Свёрнутое окно Windows паркует на x = -32000 (isMinimized).
      return w ? {
        path: w.path, getTitle: () => w.title,
        getBounds: () => {
          world.boundsOf.push(w.id);
          return { x: w.minimized ? -32000 : 0, y: 0, width: 800, height: 600 };
        },
      } : null;
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
        agentUpdated: world.agents[w.id]?.updated ?? 1,
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
    isBlinking: id => world.blinking.has(id),
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

  it('мигающее окно (кеш) не прячется и возвращается сразу', () => {
    // Скрытый пикер узнал бы о мигании только через минуты бэкоффа.
    const { svc, world, calls, shown, reset } = setup({ sessions: { 1: A, 2: B } });
    world.blinking.add(2);
    reset();
    svc.setSet({ sessions: [A, B] });
    expect(calls, 'мигающее окно в наборе не прячется').toEqual([['delete', 1]]);
    reset();
    world.blinking.add(1);
    svc.tick();
    expect(calls, 'мигание началось на спрятанной кнопке — addTab на том же тике').toEqual([['add', 1]]);
    expect(shown, 'resync — кадр мигания встанет на новую кнопку').toEqual([[1]]);
    reset();
    world.blinking.clear();
    svc.tick();
    expect(calls, 'мигание кончилось — набор снова прячет').toEqual([['delete', 1], ['delete', 2]]);
  });

  it('свёрнутое окно из набора прячется только через минуту', () => {
    // Решение Стаса (24.11): свёрнутое прячется через минуту после сворачивания.
    const { svc, world, calls, logs, advance, reset } = setup({ sessions: { 1: A } });
    world.windows[0].minimized = true;
    reset();
    svc.setSet({ sessions: [A] });
    expect(calls).toEqual([]);
    advance(MINIMIZED_HIDE_DELAY_MS - 1);
    svc.tick();
    expect(calls).toEqual([]);
    advance(1);
    svc.tick();
    expect(calls).toEqual([['delete', 1]]);
    expect(logs).toContain(`info: taskbar hide: 1 ${A} спрятана`);
    reset();
    advance(10 * 60_000);
    svc.tick();
    expect(calls.filter(c => c[0] === 'add'), 'свёрнутая спрятанная остаётся спрятанной').toEqual([]);
  });

  it('развёрнутое погашенное прячется сразу', () => {
    const { svc, calls, reset } = setup({ sessions: { 1: A } });
    reset();
    svc.setSet({ sessions: [A] });
    expect(calls).toEqual([['delete', 1]]);
  });

  it('явная hide свёрнутого — сразу', () => {
    const { svc, world, store, calls, reset } = setup({ sessions: { 1: A } });
    world.windows[0].minimized = true;
    store.set(A, 'hide');
    reset();
    svc.tick();
    expect(calls).toEqual([['delete', 1]]);
  });

  it('развернул до минуты — отсчёт сначала', () => {
    const { svc, world, calls, advance } = setup({ sessions: { 1: A, 2: B } });
    world.windows[0].minimized = true;
    svc.setSet({ sessions: [A, B] });
    advance(30_000);
    // Развернул: пикер счёл сессию живой и убрал из набора.
    world.windows[0].minimized = false;
    svc.setSet({ sessions: [B] });
    advance(10_000);
    world.windows[0].minimized = true;
    svc.setSet({ sessions: [A, B] });
    advance(MINIMIZED_HIDE_DELAY_MS - 1);
    svc.tick();
    const of1 = () => calls.filter(c => c[0] === 'delete' && c[1] === 1);
    expect(of1(), 'минута считается от нового сворачивания').toEqual([]);
    advance(1);
    svc.tick();
    expect(of1()).toEqual([['delete', 1]]);
  });

  it('развернул окно, ждавшее минуту, — не прячется до нового набора', () => {
    // Набор пикера считался при свёрнутом окне: разворот — человек смотрит.
    const { svc, world, calls, advance, reset } = setup({ sessions: { 1: A } });
    world.windows[0].minimized = true;
    svc.setSet({ sessions: [A] });
    advance(30_000);
    svc.tick();
    world.windows[0].minimized = false;
    reset();
    svc.tick();
    advance(5 * 60_000);
    svc.tick();
    expect(calls, 'старый набор развёрнутое не прячет').toEqual([]);
  });

  it('спрятанное свёрнутое развернули — кнопка вернулась до нового набора', () => {
    const { svc, world, calls, shown, logs, advance, reset } = setup({ sessions: { 1: A } });
    world.windows[0].minimized = true;
    svc.setSet({ sessions: [A] });
    advance(MINIMIZED_HIDE_DELAY_MS);
    svc.tick();
    expect(calls.filter(c => c[0] === 'delete')).toEqual([['delete', 1]]);
    world.windows[0].minimized = false;
    reset();
    advance(1000);
    svc.tick();
    expect(calls).toEqual([['add', 1]]);
    expect(shown).toEqual([[1]]);
    expect(logs).toContain(`info: taskbar hide: 1 ${A} возвращена`);
    reset();
    svc.tick();
    expect(calls).toEqual([]);
  });

  it('новый набор после разворота снова решает', () => {
    const { svc, world, calls, advance, reset } = setup({ sessions: { 1: A } });
    world.windows[0].minimized = true;
    svc.setSet({ sessions: [A] });
    advance(MINIMIZED_HIDE_DELAY_MS);
    svc.tick();
    world.windows[0].minimized = false;
    advance(1000);
    svc.tick();
    reset();
    advance(1000);
    // Пикер пересчитал после разворота и всё ещё считает сессию погашенной.
    svc.setSet({ sessions: [A] });
    expect(calls).toEqual([['delete', 1]]);
  });

  it('явная hide развёрнутого после сворачивания — по-прежнему спрятана', () => {
    const { svc, world, store, calls, reset } = setup({ sessions: { 1: A } });
    world.windows[0].minimized = true;
    store.set(A, 'hide');
    svc.tick();
    world.windows[0].minimized = false;
    reset();
    svc.tick();
    expect(calls).toEqual([]);
  });

  it('свёрнутость спрашивается только у кандидатов на прятание и спрятанных', () => {
    // Бюджет опроса: окнам вне набора — никогда.
    const { svc, world } = setup({ sessions: { 1: A, 2: B } });
    svc.setSet({ sessions: [A] });
    expect(world.boundsOf).toEqual([1]);
    svc.tick();
    expect(world.boundsOf, 'спрятанное — следить за разворотом').toEqual([1, 1]);
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

  it('явная hide, поставленная до записи хука о новом ходе, не снимается этим ходом', () => {
    // Живая проверка на nb: hide через 2 с после промпта, а тик ещё читал
    // review прошлого хода (кеш 3 с, запаздывание хука) — sawIdle, затем
    // active, и отметка снималась собственным ходом агента.
    const { svc, world, store, calls, advance, reset } = setup({
      sessions: { 1: A }, agents: { 1: { state: 'review', seen: true, updated: 50 } },
    });
    advance(100_000);
    store.set(A, 'hide');
    reset();
    svc.tick();
    expect(calls).toEqual([['delete', 1]]);
    expect(store.get(A), 'review записан до отметки — не пауза').toEqual({ mode: 'hide', hwnd: 1 });
    world.agents[1] = { state: 'active', updated: 101 };
    svc.tick();
    expect(store.get(A), 'свой ход отметку не снимает').toEqual({ mode: 'hide', hwnd: 1 });
    world.agents[1] = { state: 'review', seen: true, updated: 160 };
    svc.tick();
    expect(store.get(A), 'пауза после отметки засчитана').toEqual({ mode: 'hide', hwnd: 1, sawIdle: true });
    world.agents[1] = { state: 'active', updated: 200 };
    reset();
    svc.tick();
    expect(store.get(A), 'новый ход снял отметку').toBeUndefined();
    expect(calls).toEqual([['add', 1]]);
  });

  it('явная hide на простаивающей сессии снимается её следующим ходом', () => {
    // Голова прячет ребёнка, закончившего минуты назад: хук до следующего
    // промпта ничего не пишет, и чтение старше отметки — единственное. Его
    // отбрасывают только первые TASKBAR_STALE_GRACE_MS, дальше это пауза.
    const { svc, world, store, calls, advance, reset } = setup({
      sessions: { 1: A }, agents: { 1: { state: 'review', seen: true, updated: 50 } },
    });
    advance(100_000);
    store.set(A, 'hide');
    reset();
    svc.tick();
    expect(calls).toEqual([['delete', 1]]);
    expect(store.get(A), 'в пределах грации чтение старое').toEqual({ mode: 'hide', hwnd: 1 });
    advance(TASKBAR_STALE_GRACE_MS);
    svc.tick();
    expect(store.get(A), 'после грации простой — пауза').toEqual({ mode: 'hide', hwnd: 1, sawIdle: true });
    world.agents[1] = { state: 'active', updated: 200 };
    reset();
    svc.tick();
    expect(store.get(A), 'следующий ход снял отметку').toBeUndefined();
    expect(calls).toEqual([['add', 1]]);
    expect(TASKBAR_STALE_GRACE_MS, 'больше кеша loadProgress (3 с) и запаздывания хука').toBe(10_000);
  });

  it('после смены панели перепрятывание повторяется несколько тиков', () => {
    // Живая проверка на nb: explorer создаёт кнопки через секунды после
    // Shell_TrayWnd, и одно перепрятывание на первом тике приходилось в пустоту.
    const { svc, world, calls, reset } = setup({ sessions: { 1: A } });
    svc.setSet({ sessions: [A] });
    world.tray = 200;
    reset();
    for (let i = 0; i < TASKBAR_REHIDE_TICKS_AFTER_TRAY; i += 1) svc.tick();
    expect(calls).toEqual(Array(TASKBAR_REHIDE_TICKS_AFTER_TRAY).fill(['delete', 1]));
    expect(TASKBAR_REHIDE_TICKS_AFTER_TRAY * 3000, 'покрывает ~10 с при тике 3 с').toBeGreaterThanOrEqual(10_000);
    reset();
    svc.tick();
    expect(calls).toEqual([]);
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

  it('невидимое окно, вернувшись не нужным, получает addTab', () => {
    // Замер на nb: SW_HIDE и SW_SHOW кнопку не возвращают.
    const { svc, world, calls, shown, logs, reset } = setup({ sessions: { 1: A, 2: B } });
    svc.setSet({ sessions: [A] });
    world.windows[0].invisible = true;
    svc.tick();
    svc.setSet({ sessions: [] });
    reset();
    world.windows[0].invisible = false;
    svc.tick();
    expect(calls).toEqual([['add', 1]]);
    expect(shown, 'кнопка новая — значки ставятся заново').toEqual([[1]]);
    expect(logs).toContain(`info: taskbar hide: 1 ${A} возвращена`);
    reset();
    svc.tick();
    expect(calls, 'один раз').toEqual([]);
  });

  it('невидимое окно, вернувшись всё ещё нужным, прячется снова', () => {
    const { svc, world, calls, reset } = setup({ sessions: { 1: A } });
    svc.setSet({ sessions: [A] });
    world.windows[0].invisible = true;
    svc.tick();
    reset();
    world.windows[0].invisible = false;
    svc.tick();
    expect(calls).toEqual([['add', 1], ['delete', 1]]);
  });

  it('новое окно терминала получает addTab молча', () => {
    const { svc, world, calls, shown, logs, reset } = setup({ sessions: {} });
    reset();
    world.windows.push({ id: 4, path: WEZ, title: 'new' });
    svc.tick();
    expect(calls).toEqual([['add', 4]]);
    expect(shown).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('showAll возвращает кнопку и окну, пропадавшему из списка', () => {
    const { svc, world, calls, shown, reset } = setup({ sessions: { 1: A, 2: B } });
    svc.setSet({ sessions: [A] });
    world.windows[0].invisible = true;
    svc.tick();
    world.windows[0].invisible = false;
    reset();
    // Без тика между появлением и пунктом трея.
    expect(svc.showAll()).toBe(1);
    expect(calls).toEqual([['add', 1], ['add', 2]]);
    expect(shown).toEqual([[1]]);
  });

  it('явная отметка переживает невидимость окна, снимается, только когда окна нет', () => {
    const { svc, world, store } = setup({ sessions: { 1: A } });
    store.set(A, 'hide');
    svc.tick();
    world.windows[0].invisible = true;
    svc.tick();
    expect(store.get(A)).toEqual({ mode: 'hide', hwnd: 1 });
    world.windows = world.windows.slice(1);
    svc.tick();
    expect(store.get(A)).toBeUndefined();
  });

  it('набор опустел — спрятанная кнопка возвращена', () => {
    const { svc, calls, shown, reset } = setup({ sessions: { 1: A } });
    svc.setSet({ sessions: [A] });
    reset();
    svc.setSet({ sessions: [] });
    expect(calls).toEqual([['add', 1]]);
    expect(shown).toEqual([[1]]);
  });

  it('окно потеряло сессию — кнопка возвращена', () => {
    // Вкладка wt сменилась: заголовок больше не находит сессию.
    const { svc, world, calls, reset } = setup({ sessions: { 1: A } });
    svc.setSet({ sessions: [A] });
    reset();
    delete world.sessions[1];
    svc.tick();
    expect(calls).toEqual([['add', 1]]);
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

  it('claude-taskbar-hide строкой (MQTT) прячет', async () => {
    // client.js отдаёт роутеру payload строкой — объект приходит только по http.
    const { svc, store, calls, logs, reset } = setup({ sessions: { 1: A, 2: B } });
    const cmds = taskbarHideCommands({ store, service: svc, log: m => logs.push(m) });
    reset();
    expect(await cmds['claude-taskbar-hide'](JSON.stringify({ sessions: [A] }))).toEqual({ ok: true, count: 1 });
    expect(calls).toEqual([['delete', 1]]);
  });

  it('release возвращает кнопки, хранит отметки и больше не прячет', async () => {
    // Трей гасит службу kill-ом: перед ним он просит release, и отметки
    // должны дожить до следующего старта.
    const { svc, store, winMan, calls, logs, reset } = setup({ sessions: { 1: A, 2: B } });
    const cmds = taskbarHideCommands({ store, service: svc, log: m => logs.push(m) });
    store.set(B, 'hide');
    svc.setSet({ sessions: [A] });
    expect(calls.filter(c => c[0] === 'delete')).toEqual([['delete', 1], ['delete', 2]]);
    reset();
    expect(await cmds['claude-taskbar-release']({ startedAt: 0 })).toEqual({ ok: true, shown: 2 });
    expect(calls).toEqual([['add', 1], ['add', 2]]);
    expect(store.get(B), 'явная отметка цела').toEqual({ mode: 'hide', hwnd: 2 });
    reset();
    svc.tick();
    svc.setSet({ sessions: [A, B] });
    expect(calls, 'после release служба не прячет до перезапуска').toEqual([]);

    // Следующий старт службы с тем же хранилищем прячет по отметке снова.
    reset();
    startTaskbarHide({
      winMan, log: () => {}, store, setIntervalFn: () => 1, clearIntervalFn: () => {},
    });
    expect(calls).toEqual([['add', 1], ['add', 2], ['delete', 2]]);
  });

  it('отпущенная служба говорит об этом: statusOf, warn на набор, released в ответе', async () => {
    // Иначе выключенное прятание выглядело бы исправным: набор «принят», ok.
    const { svc, store, logs, reset } = setup({ sessions: { 1: A, 2: B } });
    const cmds = taskbarHideCommands({ store, service: svc, log: (m, level = 'info') => logs.push(`${level}: ${m}`) });
    expect((await cmds['claude-taskbar-hide']({ sessions: [A] })).released, 'до release — нет флага').toBeUndefined();
    svc.release();
    reset();
    expect(svc.statusOf(A)).toEqual({ applied: false, reason: 'released (restart the service)' });
    expect(svc.statusOf(B), 'и без отметки').toEqual({ applied: false, reason: 'released (restart the service)' });
    expect(await cmds['claude-taskbar-hide']({ sessions: [A] })).toEqual({ ok: true, count: 1, released: true });
    await cmds['claude-taskbar-hide']({ sessions: [A, B] });
    const warn = 'warn: taskbar hide: служба отпустила кнопки — набор не применяется до перезапуска';
    expect(logs.filter(l => l === warn), 'одна строка на период').toEqual([warn]);
  });

  it('release: сбой addTab одного окна не мешает остальным', () => {
    const { svc, winMan, calls, reset } = setup({ sessions: { 1: A, 2: B } });
    svc.setSet({ sessions: [A, B] });
    reset();
    winMan.addTab.mockImplementationOnce(() => { throw new Error('boom'); });
    expect(svc.release()).toBe(1);
    expect(calls).toEqual([['add', 2]]);
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

describe('returnTerminalTabs', () => {
  it('addTab всем окнам терминалов в обход службы', () => {
    // CLI зовёт это, когда служба не отвечает: убита из трея или упала.
    const { winMan, calls, reset } = setup({ sessions: { 1: A } });
    reset();
    winMan.addTab.mockImplementationOnce(() => { throw new Error('boom'); });
    expect(returnTerminalTabs(winMan)).toEqual({ supported: true, shown: 1 });
    expect(winMan.addTab).toHaveBeenLastCalledWith(2);
    expect(calls, 'окно не терминала не трогается').toEqual([['add', 2]]);
  });

  it('без DeleteTab/AddTab в аддоне — не поддерживается', () => {
    const { winMan } = setup({ control: false });
    expect(returnTerminalTabs(winMan)).toEqual({ supported: false, shown: 0 });
    expect(winMan.addTab).not.toHaveBeenCalled();
  });
});
