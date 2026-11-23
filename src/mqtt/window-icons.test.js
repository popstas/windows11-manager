import { describe, it, expect, vi } from 'vitest';
import { startWindowIcons } from './window-icons.js';
import { mergeClaudeWtConfig } from '../claude-wt/daemon-helpers.js';
import { createSessionIconStore } from '../claude-wt/session-icons.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WEZ = 'C:\\Program Files\\WezTerm\\wezterm-gui.exe';
const WT = 'C:\\WindowsTerminal.exe';
const CHROME = 'C:\\chrome.exe';

function setup({ windows = [], sessions = {}, heads = [], config = {}, control = true, overlayControl = true, store } = {}) {
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
    store,
  });
  return { svc, calls, overlays, logs, published, winMan, world, advance: ms => { clock += ms; } };
}

describe('startWindowIcons', () => {
  it('при старте ставит иконки окнам wt и WezTerm: head — иконка проекта и значок head на кнопке', () => {
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
    expect(overlays).toEqual([[1, 'C:/repo/icons/head-badge.ico', 'head'], [2, '', '']]);
  });

  it('режим icon — значок head вместо иконки, значков на кнопках нет', () => {
    const { calls, overlays } = setup({
      windows: [{ id: 1, path: WT, title: 'h' }, { id: 2, path: WEZ, title: 'c' }],
      sessions: { 1: { sessionId: 'h', cwd: '/p/home' }, 2: { sessionId: 'c', cwd: '/p/exp' } },
      heads: ['h'],
      config: { windowIcons: { headMode: 'icon', profiles: { home: 'C:/ico/me.ico', ExpertizeMe: 'C:/ico/exp.ico' } } },
    });
    expect(calls).toEqual([[1, 'C:/repo/icons/head-badge.ico'], [2, 'C:/ico/exp.ico']]);
    expect(overlays.filter(o => o[1])).toEqual([]);
  });

  it('смена режима в настройках применяется сразу, без перезапуска', () => {
    const { svc, calls, overlays, world } = setup({
      windows: [{ id: 1, path: WT, title: 'h' }], sessions: { 1: { sessionId: 'h', cwd: '/p/home' } }, heads: ['h'],
    });
    calls.length = 0;
    overlays.length = 0;
    world.cfg = mergeClaudeWtConfig({ ...world.cfg, windowIcons: { ...world.cfg.windowIcons, headMode: 'icon' } });
    svc.tick();
    expect(calls).toEqual([[1, 'C:/repo/icons/head-badge.ico']]);
    expect(overlays).toEqual([[1, '', '']]);
    calls.length = 0;
    overlays.length = 0;
    world.cfg = mergeClaudeWtConfig({ ...world.cfg, windowIcons: { ...world.cfg.windowIcons, headMode: 'badge' } });
    svc.tick();
    expect(calls).toEqual([[1, 'C:/ico/me.ico']]);
    expect(overlays).toEqual([[1, 'C:/repo/icons/head-badge.ico', 'head']]);
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
    expect(overlays.filter(o => o[1])).toEqual([[1, 'C:/repo/icons/head-badge.ico', 'head']]);
    expect(calls).toEqual([]);
    expect(logs.some(l => l.includes('explorer'))).toBe(true);
    overlays.length = 0;
    advance(16000);
    svc.tick();
    expect(overlays.filter(o => o[1])).toEqual([[1, 'C:/repo/icons/head-badge.ico', 'head']]);
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
    expect(overlays).toEqual([[1, 'C:/repo/icons/head-badge.ico', 'head']]);
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
    expect(overlays).toEqual([[2, 'C:/repo/icons/head-badge.ico', 'head']]);
    advance(16000);
    svc.tick();
    expect(overlays).toHaveLength(2);
    expect(logs.filter(l => l.startsWith('warn:') && l.includes('значок'))).toHaveLength(1);
  });

  it('аддон без setOverlayIcon — значок head вместо иконки и одно предупреждение', () => {
    const { calls, overlays, logs } = setup({
      windows: [{ id: 1, path: WT, title: 'h' }], sessions: { 1: { sessionId: 'h', cwd: '/p/home' } }, heads: ['h'],
      overlayControl: false,
    });
    expect(calls).toEqual([[1, 'C:/repo/icons/head-badge.ico']]);
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
    // Главная иконка та же (проект), значок head — на кнопке.
    expect(calls).toEqual([]);
    expect(overlays).toEqual([[2, 'C:/repo/icons/head-badge.ico', 'head']]);
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

  describe('значки проекта по заголовку', () => {
    const projects = icon => [
      { name: 'home', cwd: '/p/home', profile: 'home', badges: [{ match: '([', icon: 'C:\\ico\\bad.ico' }, { match: '-tg-', icon }] },
      { name: 'exp', cwd: '/p/exp', profile: 'ExpertizeMe' },
    ];

    it('окно с совпавшим заголовком получает значок проекта', () => {
      const { overlays } = setup({
        windows: [{ id: 1, path: WT, title: 'foo-tg-bar' }],
        sessions: { 1: { sessionId: 'c', cwd: '/p/home', title: 'foo-tg-bar' } },
        config: { projects: projects('C:\\ico\\telegram.ico') },
      });
      expect(overlays).toEqual([[1, 'C:\\ico\\telegram.ico', 'telegram']]);
    });

    it('правка badges без смены окон переставляет значок на следующем тике', () => {
      const { svc, overlays, world } = setup({
        windows: [{ id: 1, path: WT, title: 'foo-tg-bar' }],
        sessions: { 1: { sessionId: 'c', cwd: '/p/home', title: 'foo-tg-bar' } },
        config: { projects: projects('C:\\ico\\telegram.ico') },
      });
      overlays.length = 0;
      world.cfg = mergeClaudeWtConfig({ ...world.cfg, projects: projects('C:\\ico\\tg2.ico') });
      svc.tick();
      expect(overlays).toEqual([[1, 'C:\\ico\\tg2.ico', 'tg2']]);
    });

    // Без SetOverlayIcon в аддоне значку класть некуда: служба не должна
    // ни звать его, ни предупреждать «нет файла» — причина была бы ложной.
    it('аддон без setOverlayIcon — значков проекта нет, лишних предупреждений нет', () => {
      const { overlays, logs } = setup({
        windows: [{ id: 1, path: WT, title: 'foo-tg-bar' }],
        sessions: { 1: { sessionId: 'c', cwd: '/p/home', title: 'foo-tg-bar' } },
        config: { projects: projects('C:\\ico\\telegram.ico').map(p => ({ ...p, badges: p.badges?.slice(1) })) },
        overlayControl: false,
      });
      expect(overlays.filter(o => o[1])).toEqual([]);
      expect(logs.filter(l => l.startsWith('warn:'))).toHaveLength(1);
    });

    it('кривой регэксп — один warn за несколько тиков, тик не падает', () => {
      const { svc, overlays, logs, advance } = setup({
        windows: [{ id: 1, path: WT, title: 'foo-tg-bar' }],
        sessions: { 1: { sessionId: 'c', cwd: '/p/home', title: 'foo-tg-bar' } },
        config: { projects: projects('C:\\ico\\telegram.ico') },
      });
      advance(60_000);
      svc.tick();
      advance(60_000);
      svc.tick();
      expect(logs.filter(l => l === 'warn: window icons: кривой регэксп в badges: ([')).toHaveLength(1);
      expect(overlays[0]).toEqual([1, 'C:\\ico\\telegram.ico', 'telegram']);
    });
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
    // head в режиме badge — иконка проекта: значок head только на кнопке панели.
    expect(published).toEqual([{ h: 'C:/ico/me.ico', c: 'C:/ico/exp.ico', n: '' }]);
    advance(16000);
    svc.tick();
    expect(published).toHaveLength(1);
    world.cfg = mergeClaudeWtConfig({ ...world.cfg, windowIcons: { ...world.cfg.windowIcons, headMode: 'icon' } });
    svc.tick();
    expect(published.at(-1)).toEqual({ h: 'C:/repo/icons/head-badge.ico', c: 'C:/ico/exp.ico', n: '' });
  });

  it('выключенные иконки — пустая карта демону', () => {
    const { svc, published, world } = setup({
      windows: [{ id: 2, path: WEZ, title: 'a' }], sessions: { 2: { sessionId: 'c', cwd: '/p/home' } },
    });
    world.cfg = mergeClaudeWtConfig({ ...world.cfg, windowIcons: { enabled: false } });
    svc.tick();
    expect(published.at(-1)).toEqual({});
  });

  describe('явная иконка и значок из claude-wt CLI', () => {
    const tmpStore = () => createSessionIconStore({
      file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'w11m-wi-')), 'session-icons.json'),
    });
    const TG = 'C:\\images\\ico\\telegram.ico';
    const PF = 'C:\\images\\ico\\planfix.ico';
    const two = {
      windows: [{ id: 1, path: WT, title: 'h' }, { id: 2, path: WEZ, title: 'c' }],
      sessions: { 1: { sessionId: 'h', cwd: '/p/home' }, 2: { sessionId: 'c', cwd: '/p/exp' } },
      heads: ['h'],
    };

    it('явная иконка перебивает иконку проекта и попадает демону', () => {
      const store = tmpStore();
      store.set('c', 'icon', TG);
      const { calls, published } = setup({ ...two, store });
      expect(calls).toEqual([[1, 'C:/ico/me.ico'], [2, TG]]);
      expect(published.at(-1).c).toBe(TG);
    });

    it('явная иконка у head в режиме icon — явная, не значок head', () => {
      const store = tmpStore();
      store.set('h', 'icon', TG);
      const { calls } = setup({
        ...two, store,
        config: { windowIcons: { headMode: 'icon', profiles: { home: 'C:/ico/me.ico', ExpertizeMe: 'C:/ico/exp.ico' } } },
      });
      expect(calls).toContainEqual([1, TG]);
    });

    it('явный значок перебивает значок head и правило badges', () => {
      const store = tmpStore();
      store.set('h', 'badge', PF);
      store.set('c', 'badge', PF);
      const { overlays } = setup({
        windows: [{ id: 1, path: WT, title: 'h' }, { id: 2, path: WEZ, title: 'x-tg-y' }],
        sessions: { 1: { sessionId: 'h', cwd: '/p/home' }, 2: { sessionId: 'c', cwd: '/p/home', title: 'x-tg-y' } },
        heads: ['h'],
        store,
        config: { projects: [{ name: 'home', cwd: '/p/home', profile: 'home', badges: [{ match: '-tg-', icon: TG }] }] },
      });
      expect(overlays).toEqual([[1, PF, 'planfix'], [2, PF, 'planfix']]);
    });

    it('снятие явного значка возвращает автоматику', () => {
      const store = tmpStore();
      store.set('h', 'badge', PF);
      const { svc, overlays } = setup({ ...two, store });
      overlays.length = 0;
      store.set('h', 'badge', null);
      svc.tick();
      expect(overlays).toEqual([[1, 'C:/repo/icons/head-badge.ico', 'head']]);
    });

    it('правка хранилища замечается на следующем тике, не через refreshMs', () => {
      const store = tmpStore();
      const { svc, calls } = setup({ ...two, store });
      calls.length = 0;
      store.set('c', 'icon', TG);
      svc.tick();
      expect(calls).toEqual([[2, TG]]);
    });

    it('statusOf: applied у окна на экране; no window без окна; icons disabled; no overlay support', () => {
      const store = tmpStore();
      store.set('c', 'badge', PF);
      store.set('c', 'icon', TG);
      const { svc, world } = setup({ ...two, store });
      expect(svc.statusOf('c', 'badge')).toEqual({ applied: true });
      expect(svc.statusOf('c', 'icon')).toEqual({ applied: true });
      // Снятое — встало, раз окно на экране.
      expect(svc.statusOf('h', 'icon')).toEqual({ applied: true });
      expect(svc.statusOf('gone', 'icon')).toEqual({ applied: false, reason: 'no window' });
      world.cfg = mergeClaudeWtConfig({ ...world.cfg, windowIcons: { enabled: false } });
      svc.tick();
      expect(svc.statusOf('c', 'icon')).toEqual({ applied: false, reason: 'icons disabled' });

      const noOverlay = setup({ ...two, store, overlayControl: false });
      expect(noOverlay.svc.statusOf('c', 'badge')).toEqual({ applied: false, reason: 'no overlay support' });
      expect(noOverlay.svc.statusOf('c', 'icon')).toEqual({ applied: true });
    });

    it('statusOf: not applied, если setOverlayIcon вернул false', () => {
      const store = tmpStore();
      const { svc, winMan } = setup({ ...two, store });
      winMan.setOverlayIcon.mockImplementation(() => false);
      store.set('c', 'badge', PF);
      svc.tick();
      expect(svc.statusOf('c', 'badge')).toEqual({ applied: false, reason: 'not applied (see tray log)' });
    });

    it('аддон без setWindowIcon — statusOf говорит no icon service', () => {
      const { svc } = setup({ ...two, store: tmpStore(), control: false });
      expect(svc.statusOf('c', 'icon')).toEqual({ applied: false, reason: 'no icon service' });
    });

    it('touch зовётся с sessionId окон на экране', () => {
      const store = tmpStore();
      const touch = vi.spyOn(store, 'touch');
      setup({ ...two, store });
      expect([...touch.mock.calls[0][0]]).toEqual(['h', 'c']);
    });

    it('сбой записи хранилища не останавливает расстановку иконок', () => {
      const store = tmpStore();
      store.touch = () => { throw new Error('EACCES'); };
      const { calls, logs } = setup({ ...two, store });
      expect(calls).toEqual([[1, 'C:/ico/me.ico'], [2, 'C:/ico/exp.ico']]);
      expect(logs.filter(l => l.includes('EACCES'))).toHaveLength(1);
    });

    it('заданное до перезапуска службы встаёт без повторной команды', () => {
      const store = tmpStore();
      store.set('c', 'badge', PF);
      const { overlays } = setup({ ...two, store });
      expect(overlays).toContainEqual([2, PF, 'planfix']);
    });
  });
});
