import { describe, it, expect, vi, beforeEach } from 'vitest';

// Числа с popstas-nb (проба 2026-11-12): мониторы в нумерации кода —
// 1 ноутбук, 2 вертикальный, 3 правый; масштаб 1.
const EDITOR = [
  { monitor: 'SDC41A0', dpi: 96, 'left-coordinate': 0, 'top-coordinate': 0, 'work-area-width': 1722, 'work-area-height': 1200 },
  { monitor: 'WCSC005', dpi: 96, 'left-coordinate': -1080, 'top-coordinate': -534, 'work-area-width': 1080, 'work-area-height': 1880 },
  { monitor: 'WCSA044', dpi: 96, 'left-coordinate': 1920, 'top-coordinate': 0, 'work-area-width': 1920, 'work-area-height': 1160 },
];
const live = (x, y, width, height) => ({ bounds: { x, y, width, height }, getScaleFactor: () => 1 });
const LIVE_ALL = [live(0, 0, 1722, 1200), live(-1080, -534, 1080, 1880), live(1920, 0, 1920, 1160)];
const ZONES = {
  '1:3': { x: -8, y: 0, width: 916, height: 1208 },
  '1:4': { x: 892, y: 0, width: 838, height: 1208 },
  '2:1': { x: -1088, y: -534, width: 1096, height: 938 },
  '2:2': { x: -1088, y: 396, width: 1096, height: 936 },
  '3:1': { x: 2036, y: 0, width: 1096, height: 1168 },
  '3:4': { x: 2752, y: 0, width: 1096, height: 1168 },
};

const fancy = { fancyZonesToPos: vi.fn() };
const mons = { getSortedMonitors: vi.fn(), getWindowsMonitors: vi.fn() };
vi.mock('../fancyzones.js', () => ({ fancyZonesToPos: (...a) => fancy.fancyZonesToPos(...a) }));
vi.mock('../monitors.js', () => ({
  getSortedMonitors: (...a) => mons.getSortedMonitors(...a),
  getWindowsMonitors: (...a) => mons.getWindowsMonitors(...a),
}));

const { resolveHeadLayout, resetHeadLayoutCache, HEAD_LAYOUT_TTL_MS } = await import('./head-zones.js');

const HZ = { 1: [3, 4], 2: [1, 2], 3: [1, 4] };

beforeEach(() => {
  resetHeadLayoutCache();
  fancy.fancyZonesToPos.mockReset().mockImplementation(({ monitor, position }) => ZONES[`${monitor}:${position}`]);
  mons.getSortedMonitors.mockReset().mockReturnValue(EDITOR);
  mons.getWindowsMonitors.mockReset().mockReturnValue(LIVE_ALL);
});

describe('resolveHeadLayout', () => {
  it('разрешает зоны и мониторы в пространстве окон', () => {
    const log = vi.fn();
    const layout = resolveHeadLayout({ headZones: HZ, log, nowMs: 0 });
    expect(layout.monitors.map(m => m.monitor)).toEqual([1, 2, 3]);
    expect(layout.monitors[1].rect).toEqual({ x: -1080, y: -534, width: 1080, height: 1880 });
    expect(layout.zones.map(z => `${z.monitor}:${z.position}`)).toEqual(['1:3', '1:4', '2:1', '2:2', '3:1', '3:4']);
    expect(layout.zones[0].rect).toEqual(ZONES['1:3']);
    expect(log).not.toHaveBeenCalled();
  });

  it('fancyZonesToPos зовётся с positionsFallback: false', () => {
    resolveHeadLayout({ headZones: { 1: [3, 4] }, log: vi.fn(), nowMs: 0 });
    expect(fancy.fancyZonesToPos).toHaveBeenCalledWith({ monitor: 1, position: 3 }, { positionsFallback: false });
  });

  it('монитор не подключён — зоны пропущены', () => {
    // editor-parameters ещё помнит вертикальный, а живых мониторов два
    mons.getWindowsMonitors.mockReturnValue([LIVE_ALL[0], LIVE_ALL[2]]);
    const log = vi.fn();
    const layout = resolveHeadLayout({ headZones: HZ, log, nowMs: 0 });
    expect(layout.zones.some(z => z.monitor === 2)).toBe(false);
    expect(layout.monitors.map(m => m.monitor)).toEqual([1, 3]);
    expect(fancy.fancyZonesToPos).not.toHaveBeenCalledWith({ monitor: 2, position: 1 }, expect.anything());
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('монитор 2');
    expect(log.mock.calls[0][1]).toBe('warn');
  });

  it('монитора нет в editor-parameters — тоже пропуск с warn', () => {
    const log = vi.fn();
    const layout = resolveHeadLayout({ headZones: { 1: [3, 4], 5: [1, 2] }, log, nowMs: 0 });
    expect(layout.zones).toHaveLength(2);
    expect(log.mock.calls[0][0]).toContain('монитор 5');
  });

  it('зона не разрешилась или бросила — пропущена с warn, остальные живут', () => {
    fancy.fancyZonesToPos.mockImplementation(({ monitor, position }) => {
      if (monitor === 3 && position === 4) throw new Error('битый custom-layouts.json');
      if (monitor === 3 && position === 1) return undefined;
      return ZONES[`${monitor}:${position}`];
    });
    const log = vi.fn();
    const layout = resolveHeadLayout({ headZones: HZ, log, nowMs: 0 });
    expect(layout.zones.map(z => `${z.monitor}:${z.position}`)).toEqual(['1:3', '1:4', '2:1', '2:2']);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.map(c => c[0]).join('\n')).toMatch(/3:1[\s\S]*3:4[\s\S]*битый/);
  });

  it('пустые headZones — null без единой строки', () => {
    const log = vi.fn();
    expect(resolveHeadLayout({ headZones: {}, log, nowMs: 0 })).toBeNull();
    expect(log).not.toHaveBeenCalled();
    expect(mons.getSortedMonitors).not.toHaveBeenCalled();
  });

  it('не разрешилась ни одна зона — null', () => {
    fancy.fancyZonesToPos.mockReturnValue(undefined);
    expect(resolveHeadLayout({ headZones: HZ, log: vi.fn(), nowMs: 0 })).toBeNull();
  });

  it('editor-parameters не читается — null и warn, не исключение', () => {
    mons.getSortedMonitors.mockImplementation(() => { throw new Error('ENOENT'); });
    const log = vi.fn();
    expect(resolveHeadLayout({ headZones: HZ, log, nowMs: 0 })).toBeNull();
    expect(log.mock.calls[0][0]).toContain('ENOENT');
  });

  it('причины из конфига (headZonesProblems) идут в тот же журнал', () => {
    const log = vi.fn();
    resolveHeadLayout({ headZones: HZ, problems: ['claudeWt.headZones.x: номер монитора — целое от 1'], log, nowMs: 0 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('claudeWt.headZones.x'), 'warn');
  });

  it('кэш: второй вызов в пределах 60 с не читает файлы, смена headZones — читает', () => {
    resolveHeadLayout({ headZones: HZ, log: vi.fn(), nowMs: 0 });
    resolveHeadLayout({ headZones: HZ, log: vi.fn(), nowMs: HEAD_LAYOUT_TTL_MS - 1 });
    expect(mons.getSortedMonitors).toHaveBeenCalledTimes(1);
    resolveHeadLayout({ headZones: { 1: [3, 4] }, log: vi.fn(), nowMs: HEAD_LAYOUT_TTL_MS - 1 });
    expect(mons.getSortedMonitors).toHaveBeenCalledTimes(2);
    resolveHeadLayout({ headZones: { 1: [3, 4] }, log: vi.fn(), nowMs: 2 * HEAD_LAYOUT_TTL_MS });
    expect(mons.getSortedMonitors).toHaveBeenCalledTimes(3);
  });

  it('та же причина второй раз не пишется', () => {
    mons.getWindowsMonitors.mockReturnValue([LIVE_ALL[0], LIVE_ALL[2]]);
    const log = vi.fn();
    resolveHeadLayout({ headZones: HZ, log, nowMs: 0 });
    resolveHeadLayout({ headZones: HZ, log, nowMs: HEAD_LAYOUT_TTL_MS + 1 });
    expect(log).toHaveBeenCalledTimes(1);
    // починили — тишина; сломали снова — строка снова
    mons.getWindowsMonitors.mockReturnValue(LIVE_ALL);
    resolveHeadLayout({ headZones: HZ, log, nowMs: 3 * HEAD_LAYOUT_TTL_MS });
    expect(log).toHaveBeenCalledTimes(1);
    mons.getWindowsMonitors.mockReturnValue([LIVE_ALL[0], LIVE_ALL[2]]);
    resolveHeadLayout({ headZones: HZ, log, nowMs: 5 * HEAD_LAYOUT_TTL_MS });
    expect(log).toHaveBeenCalledTimes(2);
  });
});
