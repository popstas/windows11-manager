import { describe, it, expect, vi } from 'vitest';

// Нативные модули и конфиг здесь не нужны: все внешние вызовы — через deps.
vi.mock('./view.js', () => ({ claudeWtSessions: vi.fn() }));
vi.mock('../windows.js', () => ({ getWindowById: vi.fn(), getActiveWindowId: vi.fn() }));
vi.mock('../placement.js', () => ({ placeWindow: vi.fn() }));
vi.mock('../virtual-desktop.js', () => ({ virtualDesktop: {} }));
vi.mock('../no-autoplace.js', () => ({ markNoAutoplace: vi.fn() }));
vi.mock('./index.js', () => ({ getClaudeWtConfig: vi.fn(), isTerminalWindow: vi.fn() }));
vi.mock('./head-zones.js', () => ({ resolveHeadLayout: vi.fn() }));

const { placeChildWindow } = await import('./child-place.js');

// Числа с popstas-nb, нумерация кода: 1 ноутбук, 2 вертикальный, 3 правый.
const R = {
  '1:3': { x: -8, y: 0, width: 916, height: 1208 },
  '1:4': { x: 892, y: 0, width: 838, height: 1208 },
  '2:1': { x: -1088, y: -534, width: 1096, height: 938 },
  '2:2': { x: -1088, y: 396, width: 1096, height: 936 },
  '3:1': { x: 2036, y: 0, width: 1096, height: 1168 },
  '3:4': { x: 2752, y: 0, width: 1096, height: 1168 },
};
const LAYOUT = {
  monitors: [
    { monitor: 1, rect: { x: 0, y: 0, width: 1722, height: 1200 } },
    { monitor: 2, rect: { x: -1080, y: -534, width: 1080, height: 1880 } },
    { monitor: 3, rect: { x: 1920, y: 0, width: 1920, height: 1160 } },
  ],
  zones: Object.entries(R).map(([k, rect]) => {
    const [monitor, position] = k.split(':').map(Number);
    return { monitor, position, rect };
  }),
};
const HZ = { 1: [3, 4], 2: [1, 2], 3: [1, 4] };
const NOW = 1_800_000_000_000;
const third = (zone, i) => {
  const h = Math.floor(zone.height / 3);
  return { x: zone.x, y: zone.y + i * h, width: zone.width, height: i === 2 ? zone.height - 2 * h : h };
};

// Окно помнит, куда его поставили: следующий хвост видит его уже на месте.
const win = (id, bounds, extra = {}) => {
  const w = { id, bounds, getBounds: () => w.bounds, ...extra };
  return w;
};

/**
 * Машина: head, его дети из реестра, чужие сессии. `windows` — hwnd → окно.
 * Стол head — 1, текущий стол — `current` (1-based).
 */
function harness({
  headBounds = R['1:3'], children = [], foreign = [], current = 1, childPlacement = 'stack',
  headDesktop = 1, layout = LAYOUT, extraEntries = [],
} = {}) {
  const NEW = win(100, { x: 300, y: 300, width: 800, height: 600 });
  const windows = new Map([[100, NEW], [1, win(1, headBounds)]]);
  const sessions = [{ id: 'head', open: true, windowId: 1, desktop: headDesktop }];
  const entries = [...extraEntries];
  children.forEach((c, i) => {
    const id = 10 + i;
    windows.set(id, win(id, c.bounds, { terminal: c.terminal !== false }));
    if (c.gone) windows.delete(id);
    entries.push({ sessionId: `c${i}`, headId: 'head', windowId: id, desktop: c.desktop ?? headDesktop, at: NOW });
    if (!c.gone) sessions.push({ id: `c${i}`, open: true, windowId: id, desktop: c.desktop ?? headDesktop });
  });
  foreign.forEach((f, i) => {
    const id = 50 + i;
    windows.set(id, win(id, f.bounds));
    sessions.push({ id: `f${i}`, open: true, windowId: id, desktop: f.desktop ?? headDesktop });
  });
  const placed = [];
  const deps = {
    cfg: () => ({ headZones: HZ, headZonesProblems: [], childPlacement }),
    layout: vi.fn(() => layout),
    sessions: vi.fn(() => ({ ok: true, sessions })),
    getWindow: id => windows.get(id),
    activeId: () => 100,
    desktopOf: async () => current - 1,
    place: vi.fn(async ({ w, rule }) => {
      placed.push({ id: w.id, ...rule });
      w.bounds = rule.pos;
      return { changes: [{ name: 'bounds' }] };
    }),
    markNoAutoplace: vi.fn(),
    readChildren: () => entries,
    recordChild: vi.fn(),
    isTerminal: w => w.terminal !== false,
    now: () => NOW,
  };
  const log = vi.fn();
  const run = (opts = {}) => placeChildWindow(NEW, {
    sessionId: 'new', headId: 'head', zone: null, name: 'task', log, ...opts,
  }, deps);
  return { run, deps, placed, log, NEW };
}

describe('placeChildWindow', () => {
  it('stack: head в 1:3 — ребёнок в 1:4 целиком, head не двигается', async () => {
    const h = harness();
    expect(await h.run()).toEqual({ desktop: 1, focus: true });
    expect(h.placed).toEqual([{ id: 100, pos: R['1:4'], desktop: 1 }]);
    expect(h.deps.markNoAutoplace).toHaveBeenCalledWith(100);
    expect(h.deps.recordChild).toHaveBeenCalledWith({ sessionId: 'new', headId: 'head', windowId: 100, desktop: 1 });
  });

  it('stack: в 1:4 уже двое своих — переставлены на трети, новый третий', async () => {
    const half = { x: 892, y: 604, width: 838, height: 604 };
    const top = { x: 892, y: 0, width: 838, height: 604 };
    const h = harness({ children: [{ bounds: half }, { bounds: top }] });
    await h.run();
    const Z = R['1:4'];
    expect(h.placed).toEqual([
      { id: 11, pos: third(Z, 0) },
      { id: 10, pos: third(Z, 1) },
      { id: 100, pos: third(Z, 2), desktop: 1 },
    ]);
  });

  it('stack: четвёртый ребёнок — поверх первого места, никто не двигается', async () => {
    const Z = R['1:4'];
    const h = harness({ children: [0, 1, 2].map(i => ({ bounds: third(Z, i) })) });
    await h.run();
    expect(h.placed).toEqual([{ id: 100, pos: third(Z, 0), desktop: 1 }]);
  });

  it('head вне основной зоны — вторая зона пары', async () => {
    const h = harness({ headBounds: { x: 100, y: 100, width: 1400, height: 900 } });
    await h.run();
    expect(h.placed.at(-1).pos).toEqual(R['1:4']);
  });

  it('head на правом мониторе в 3:4 — ребёнок в 3:1', async () => {
    const h = harness({ headBounds: R['3:4'] });
    await h.run();
    expect(h.placed.at(-1).pos).toEqual(R['3:1']);
  });

  it('head на мониторе без зон в раскладке — null и warn', async () => {
    const layout = { ...LAYOUT, zones: LAYOUT.zones.filter(z => z.monitor !== 1) };
    const h = harness({ layout });
    expect(await h.run()).toBeNull();
    expect(h.placed).toEqual([]);
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('task'), 'warn');
  });

  it('head не найден и зоны нет — null и warn, ничего не двигается', async () => {
    const h = harness();
    expect(await h.run({ headId: 'nobody' })).toBeNull();
    expect(h.placed).toEqual([]);
    expect(h.log.mock.calls[0][1]).toBe('warn');
  });

  it('раскладки нет — null', async () => {
    const h = harness({ layout: null });
    expect(await h.run()).toBeNull();
  });

  it('free: свободная зона на мониторе head', async () => {
    const h = harness({ childPlacement: 'free' });
    await h.run();
    expect(h.placed.at(-1).pos).toEqual(R['1:4']);
  });

  it('free: развёрнутый head занимает обе зоны своего монитора', async () => {
    const h = harness({ childPlacement: 'free', headBounds: { x: -8, y: 0, width: 1738, height: 1208 } });
    await h.run();
    expect(h.placed.at(-1).pos).toEqual(R['2:1']);
  });

  it('free: свободная на другом мониторе', async () => {
    const h = harness({ childPlacement: 'free', foreign: [{ bounds: R['1:4'] }] });
    await h.run();
    expect(h.placed.at(-1).pos).toEqual(R['2:1']);
  });

  it('free: свободных нет — делится зона своих, чужие не двигаются', async () => {
    const foreign = ['2:1', '2:2', '3:1', '3:4'].map(k => ({ bounds: R[k] }));
    const h = harness({ childPlacement: 'free', foreign, children: [{ bounds: R['1:4'] }] });
    await h.run();
    expect(h.placed).toEqual([
      { id: 10, pos: { x: 892, y: 0, width: 838, height: 604 } },
      { id: 100, pos: { x: 892, y: 604, width: 838, height: 604 }, desktop: 1 },
    ]);
  });

  it('free: везде чужие — overlay, moves пуст', async () => {
    const foreign = ['1:4', '2:1', '2:2', '3:1', '3:4', '3:4'].map(k => ({ bounds: R[k] }));
    const h = harness({ childPlacement: 'free', foreign });
    await h.run();
    // 1:4 и прочие — по одному чужому; первая по кандидатам — 1:4, поверх места 2
    expect(h.placed).toEqual([{ id: 100, pos: third(R['1:4'], 1), desktop: 1 }]);
  });

  // Режим deck (Стас 12.11): ребёнок во второй зоне целиком, братья стоят.
  it('deck: ребёнок в 1:4 целиком, братья не двигаются', async () => {
    const top = { x: 892, y: 0, width: 838, height: 604 };
    const bottom = { x: 892, y: 604, width: 838, height: 604 };
    const h = harness({ childPlacement: 'deck', children: [{ bounds: top }, { bounds: bottom }] });
    expect(await h.run()).toEqual({ desktop: 1, focus: true });
    expect(h.placed).toEqual([{ id: 100, pos: R['1:4'], desktop: 1 }]);
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('(deck), место 1 из 1'));
  });

  it('deck: пятый ребёнок — вся зона', async () => {
    const h = harness({ childPlacement: 'deck', children: [0, 1, 2, 3].map(() => ({ bounds: R['1:4'] })) });
    await h.run();
    expect(h.placed).toEqual([{ id: 100, pos: R['1:4'], desktop: 1 }]);
  });

  it('deck: head вне основной зоны — вторая зона пары', async () => {
    const h = harness({ childPlacement: 'deck', headBounds: { x: 100, y: 100, width: 1400, height: 900 } });
    await h.run();
    expect(h.placed.at(-1).pos).toEqual(R['1:4']);
  });

  it('deck с явной zone — вся зона, свои не двигаются', async () => {
    const h = harness({ childPlacement: 'deck', children: [{ bounds: R['3:4'] }] });
    await h.run({ zone: { monitor: 3, position: 4 } });
    expect(h.placed).toEqual([{ id: 100, pos: R['3:4'], desktop: 1 }]);
  });

  it('явная zone без headId — целиком в зону, стол не задан', async () => {
    const h = harness();
    const res = await h.run({ headId: null, zone: { monitor: 3, position: 4 } });
    expect(h.placed).toEqual([{ id: 100, pos: R['3:4'] }]);
    expect(res).toEqual({ desktop: null, focus: true });
    expect(h.deps.recordChild).not.toHaveBeenCalled();
  });

  it('явная zone с head — стопка своих в этой зоне', async () => {
    const h = harness({ children: [{ bounds: R['3:1'] }] });
    await h.run({ zone: { monitor: 3, position: 1 } });
    expect(h.placed.map(p => p.id)).toEqual([10, 100]);
    expect(h.placed[1].pos).toEqual({ x: 2036, y: 584, width: 1096, height: 584 });
  });

  it('явная zone на отключённом мониторе — null и warn', async () => {
    const layout = { ...LAYOUT, zones: LAYOUT.zones.filter(z => z.monitor !== 2) };
    const h = harness({ layout });
    expect(await h.run({ zone: { monitor: 2, position: 1 } })).toBeNull();
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('2:1'), 'warn');
  });

  it('чужой стол: без фокуса и без подъёма', async () => {
    const h = harness({ current: 2, headDesktop: 1 });
    expect(await h.run()).toEqual({ desktop: 1, focus: false });
    expect(h.placed.at(-1).desktop).toBe(1);
  });

  // Ревью: текущий стол не узнался (пустой стол, впереди оболочка) — фокус
  // увёл бы человека на стол head через GoToDesktopNumber. Отказ от фокуса.
  it('текущий стол неизвестен, стол head известен — без фокуса', async () => {
    const h = harness();
    h.deps.desktopOf = async () => undefined;
    expect(await h.run()).toEqual({ desktop: 1, focus: false });
  });

  it('дети с другого стола в k не считаются', async () => {
    const h = harness({ children: [{ bounds: R['1:4'], desktop: 3 }] });
    await h.run();
    expect(h.placed).toEqual([{ id: 100, pos: R['1:4'], desktop: 1 }]);
  });

  it('закрытый ребёнок не занимает место', async () => {
    const h = harness({ children: [{ bounds: R['1:4'], gone: true }, { bounds: R['1:4'], terminal: false }] });
    await h.run();
    expect(h.placed).toEqual([{ id: 100, pos: R['1:4'], desktop: 1 }]);
  });

  it('второй хвост ждёт первый', async () => {
    const h = harness();
    let release;
    const gate = new Promise(r => { release = r; });
    const order = [];
    // реестр живой: что записал первый, видит второй
    const entries = [];
    h.deps.readChildren = () => entries;
    h.deps.recordChild = vi.fn((e) => { entries.push({ ...e, at: NOW }); });
    const NEW2 = win(101, { x: 0, y: 0, width: 10, height: 10 });
    const real = h.deps.getWindow;
    h.deps.getWindow = id => (id === 101 ? NEW2 : real(id));
    h.deps.place = vi.fn(async ({ w, rule }) => {
      order.push(`place:${w.id}`);
      if (w.id === 100 && order.length === 2) await gate;
      h.placed.push({ id: w.id, ...rule });
      w.bounds = rule.pos;
    });
    const sessionsBefore = h.deps.sessions;
    h.deps.sessions = vi.fn((...a) => { order.push('sessions'); return sessionsBefore(...a); });

    const first = h.run();
    const second = placeChildWindow(NEW2, { sessionId: 'new2', headId: 'head', zone: null, name: 'task2', log: h.log }, h.deps);
    await new Promise(r => setTimeout(r, 0));
    expect(order).toEqual(['sessions', 'place:100']);
    release();
    await Promise.all([first, second]);
    // второй увидел первого в реестре: k = 1, первый переставлен наверх
    expect(order).toEqual(['sessions', 'place:100', 'sessions', 'place:100', 'place:101']);
    expect(h.placed.at(-1)).toEqual({ id: 101, pos: { x: 892, y: 604, width: 838, height: 604 }, desktop: 1 });
  });

  it('ошибка одного хвоста не рвёт очередь', async () => {
    const h = harness();
    h.deps.sessions = vi.fn(() => { throw new Error('state.json'); });
    await expect(h.run()).rejects.toThrow('state.json');
    h.deps.sessions = vi.fn(() => ({ ok: true, sessions: [{ id: 'head', open: true, windowId: 1, desktop: 1 }] }));
    expect(await h.run()).toEqual({ desktop: 1, focus: true });
  });
});
