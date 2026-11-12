import { describe, it, expect, vi } from 'vitest';

vi.mock('./view.js', () => ({ claudeWtSessions: vi.fn() }));
vi.mock('../windows.js', () => ({ getWindowById: vi.fn(), getActiveWindowId: vi.fn(), focusWindowById: vi.fn() }));
vi.mock('../placement.js', () => ({ placeWindow: vi.fn() }));
vi.mock('../virtual-desktop.js', () => ({ virtualDesktop: {} }));
vi.mock('./index.js', () => ({ getClaudeWtConfig: vi.fn() }));
vi.mock('./head-zones.js', () => ({ resolveHeadLayout: vi.fn() }));

const { arrangeGroup } = await import('./group-layout.js');

// Числа с popstas-nb, нумерация кода: 1 ноутбук, 2 вертикальный, 3 правый.
const R = {
  '1:3': { x: -8, y: 0, width: 916, height: 1208 },
  '1:4': { x: 892, y: 0, width: 838, height: 1208 },
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
const HZ = { 1: [3, 4], 3: [1, 4] };
const third = (z, i) => {
  const h = Math.floor(z.height / 3);
  return { x: z.x, y: z.y + i * h, width: z.width, height: i === 2 ? z.height - 2 * h : h };
};
const win = (id, bounds) => {
  const w = { id, bounds, getBounds: () => w.bounds, bringToTop: vi.fn() };
  return w;
};

/** head h на стол 1, дети c0..cN, чужая сессия x. */
function harness({ headBounds = R['3:4'], kids = 4, kidOverrides = {}, current = 1, active = 1, headZones = HZ } = {}) {
  const windows = new Map([[1, win(1, headBounds)], [90, win(90, { x: 100, y: 100, width: 500, height: 400 })]]);
  const sessions = [
    { id: 'h', title: 'head-session', open: true, windowId: 1, desktop: 1 },
    { id: 'x', title: 'чужая', open: true, windowId: 90, desktop: 1 },
  ];
  for (let i = 0; i < kids; i += 1) {
    const o = kidOverrides[i] ?? {};
    const id = 10 + i;
    windows.set(id, win(id, o.bounds ?? { x: 50 * i, y: 50, width: 600, height: 400 }));
    sessions.push({ id: `c${i}`, title: `c${i}`, open: o.closed ? false : true, windowId: id, desktop: o.desktop ?? 1 });
  }
  const placed = [];
  const deps = {
    cfg: () => ({ headZones, headZonesProblems: [] }),
    layout: () => LAYOUT,
    sessions: () => ({ ok: true, sessions }),
    getWindow: id => windows.get(id),
    activeId: () => active,
    desktopOf: async () => current - 1,
    place: vi.fn(async ({ w, rule }) => { placed.push({ id: w.id, ...rule }); w.bounds = rule.pos; return { changes: [{ name: 'bounds' }] }; }),
    focus: vi.fn(() => true),
  };
  const log = vi.fn();
  const group = ['h', ...Array.from({ length: kids }, (_, i) => `c${i}`)];
  return { deps, placed, log, windows, group };
}

describe('arrangeGroup', () => {
  it('4 ребёнка — head в 3:1, дети в 3:4, четвёртый на месте первого', async () => {
    const h = harness();
    const res = await arrangeGroup({ groups: [h.group], selected: 'c2', log: h.log }, h.deps);
    expect(res).toEqual({ ok: true, placed: 5 });
    const Z = R['3:4'];
    expect(h.placed).toEqual([
      { id: 1, pos: R['3:1'] },
      { id: 10, pos: third(Z, 0) },
      { id: 11, pos: third(Z, 1) },
      { id: 12, pos: third(Z, 2) },
      { id: 13, pos: third(Z, 0) },
    ]);
    expect(h.log).toHaveBeenCalledWith('claude-place group: head head-session, детей 4 из 4');
  });

  it('selected важнее активного окна', async () => {
    const h = harness({ kids: 1, active: 10 });
    const other = ['x', 'c0'];
    await arrangeGroup({ groups: [other, h.group], selected: 'h', log: h.log }, h.deps);
    expect(h.placed[0].id).toBe(1);
  });

  it('без selected — группа активного окна', async () => {
    const h = harness({ kids: 1, active: 10 });
    await arrangeGroup({ groups: [['x', 'zz'], h.group], selected: null, log: h.log }, h.deps);
    expect(h.placed[0].id).toBe(1);
  });

  it('ни selected, ни активное окно не в группах — отказ без движения', async () => {
    const h = harness({ active: 90 });
    const res = await arrangeGroup({ groups: [h.group], selected: null, log: h.log }, h.deps);
    expect(res.ok).toBe(false);
    expect(h.placed).toEqual([]);
  });

  it('head на мониторе вне headZones — наименьший монитор и warn', async () => {
    const h = harness({ kids: 1, headBounds: { x: -1000, y: 0, width: 500, height: 500 } });
    await arrangeGroup({ groups: [h.group], selected: 'h', log: h.log }, h.deps);
    expect(h.placed).toEqual([{ id: 1, pos: R['1:3'] }, { id: 10, pos: R['1:4'] }]);
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('монитор'), 'warn');
  });

  it('свёрнутый ребёнок пропущен, остальные плотно', async () => {
    const h = harness({ kids: 3, kidOverrides: { 1: { bounds: { x: -32000, y: -32000, width: 160, height: 28 } } } });
    const res = await arrangeGroup({ groups: [h.group], selected: 'h', log: h.log }, h.deps);
    expect(h.placed.map(p => p.id)).toEqual([1, 10, 12]);
    expect(h.placed[2].pos).toEqual({ x: 2752, y: 584, width: 1096, height: 584 });
    expect(res.placed).toBe(3);
    expect(h.log).toHaveBeenCalledWith('claude-place group: head head-session, детей 2 из 3');
  });

  it('ребёнок с другого стола уезжает на стол head', async () => {
    const h = harness({ kids: 2, kidOverrides: { 1: { desktop: 2 } } });
    await arrangeGroup({ groups: [h.group], selected: 'h', log: h.log }, h.deps);
    expect(h.placed[1]).not.toHaveProperty('desktop');
    expect(h.placed[2].desktop).toBe(1);
  });

  it('на столе head — подъём и фокус', async () => {
    const h = harness({ kids: 1 });
    await arrangeGroup({ groups: [h.group], selected: 'h', log: h.log }, h.deps);
    expect(h.windows.get(1).bringToTop).toHaveBeenCalled();
    expect(h.deps.focus).toHaveBeenCalledWith(1);
  });

  it('чужой стол — без подъёма и фокуса', async () => {
    const h = harness({ kids: 1, current: 2, active: 90 });
    await arrangeGroup({ groups: [h.group], selected: 'h', log: h.log }, h.deps);
    expect(h.placed).toHaveLength(2);
    expect(h.windows.get(1).bringToTop).not.toHaveBeenCalled();
    expect(h.deps.focus).not.toHaveBeenCalled();
  });

  // Ревью: текущий стол читался после переносов — активный ребёнок уже уехал
  // на стол head, и подъём утаскивал человека туда же.
  it('активный ребёнок на другом столе — стол читается до переносов, подъёма нет', async () => {
    const h = harness({ kids: 2, kidOverrides: { 0: { desktop: 2 } }, active: 10 });
    const desk = new Map([[1, 1], [10, 2], [11, 1], [90, 1]]);
    h.deps.desktopOf = async id => desk.get(id) - 1;
    const place = h.deps.place;
    h.deps.place = vi.fn(async (opts) => {
      if (opts.rule.desktop) desk.set(opts.w.id, opts.rule.desktop);
      return place(opts);
    });
    await arrangeGroup({ groups: [h.group], selected: 'h', log: h.log }, h.deps);
    expect(h.placed.find(p => p.id === 10).desktop).toBe(1);
    expect(h.windows.get(1).bringToTop).not.toHaveBeenCalled();
    expect(h.deps.focus).not.toHaveBeenCalled();
  });

  it('текущий стол неизвестен — без подъёма и фокуса', async () => {
    const h = harness({ kids: 1 });
    h.deps.desktopOf = async () => undefined;
    await arrangeGroup({ groups: [h.group], selected: 'h', log: h.log }, h.deps);
    expect(h.placed).toHaveLength(2);
    expect(h.windows.get(1).bringToTop).not.toHaveBeenCalled();
    expect(h.deps.focus).not.toHaveBeenCalled();
  });

  // deck (Стас 12.11): дети во второй зоне целиком, выбранный ребёнок сверху.
  describe('deck', () => {
    function deckHarness(opts) {
      const h = harness(opts);
      h.deps.cfg = () => ({ headZones: HZ, headZonesProblems: [], childPlacement: 'deck' });
      const raised = [];
      for (const w of h.windows.values()) w.bringToTop = vi.fn(() => raised.push(w.id));
      return { ...h, raised };
    }

    it('дети во второй зоне целиком', async () => {
      const h = deckHarness();
      await arrangeGroup({ groups: [h.group], selected: 'h', log: h.log }, h.deps);
      expect(h.placed).toEqual([
        { id: 1, pos: R['3:1'] },
        ...[10, 11, 12, 13].map(id => ({ id, pos: R['3:4'] })),
      ]);
    });

    it('выбранный ребёнок поднят последним, остальные дети не поднимаются', async () => {
      const h = deckHarness();
      await arrangeGroup({ groups: [h.group], selected: 'c1', log: h.log }, h.deps);
      expect(h.raised).toEqual([1, 11]);
      expect(h.deps.focus).toHaveBeenCalledWith(11);
    });

    // Ревью 12.11: по хоткею пикер скрыт, selected — null. Фокус обязан
    // остаться у ребёнка, в котором человек работал, а не уйти к head.
    it('selected null, активен ребёнок — он сверху и с фокусом', async () => {
      const h = deckHarness({ active: 12 });
      await arrangeGroup({ groups: [h.group], selected: null, log: h.log }, h.deps);
      expect(h.raised).toEqual([1, 12]);
      expect(h.deps.focus).toHaveBeenCalledWith(12);
    });

    it('выбран head — дети не поднимаются', async () => {
      const h = deckHarness();
      await arrangeGroup({ groups: [h.group], selected: 'h', log: h.log }, h.deps);
      expect(h.raised).toEqual([1]);
    });
  });

  it('пустые groups — отказ без единого placeWindow', async () => {
    const h = harness();
    const res = await arrangeGroup({ groups: [], selected: null, log: h.log }, h.deps);
    expect(res).toEqual({ ok: false, reason: 'группы не переданы' });
    expect(h.deps.place).not.toHaveBeenCalled();
  });

  it('окна вне группы не двигаются', async () => {
    const h = harness({ kids: 2 });
    await arrangeGroup({ groups: [h.group], selected: 'h', log: h.log }, h.deps);
    expect(h.placed.some(p => p.id === 90)).toBe(false);
  });

  // Причину отказа команда пишет сама, с префиксом `claude-place group:` —
  // свой префикс в причине давал бы его в журнале дважды (поймано на nb).
  it('причины отказа без префикса claude-place', async () => {
    const h = harness({ active: 90 });
    const reasons = [
      (await arrangeGroup({ groups: [h.group], selected: null, log: h.log }, h.deps)).reason,
      (await arrangeGroup({ groups: [['nope', 'c0']], selected: 'nope', log: h.log }, h.deps)).reason,
    ];
    h.deps.layout = () => null;
    reasons.push((await arrangeGroup({ groups: [h.group], selected: 'h', log: h.log }, h.deps)).reason);
    expect(reasons.every(r => typeof r === 'string' && !r.startsWith('claude-place'))).toBe(true);
  });

  it('свёрнутый head — отказ', async () => {
    const h = harness({ headBounds: { x: -32000, y: -32000, width: 160, height: 28 } });
    const res = await arrangeGroup({ groups: [h.group], selected: 'h', log: h.log }, h.deps);
    expect(res.ok).toBe(false);
    expect(h.placed).toEqual([]);
  });

  it('основные зоны не разрешились — отказ', async () => {
    const h = harness();
    h.deps.layout = () => null;
    expect((await arrangeGroup({ groups: [h.group], selected: 'h', log: h.log }, h.deps)).ok).toBe(false);
  });
});
