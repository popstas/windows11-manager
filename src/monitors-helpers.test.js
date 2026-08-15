import { describe, it, expect } from 'vitest';
import { matchMonitorBySize, monitorsByConfigNumber } from './monitors-helpers.js';
describe('matchMonitorBySize', () => {
  const mon = (width, height, sf) => ({ bounds: { x: 0, y: 0, width, height }, getScaleFactor: () => sf ?? 1 });

  it('matches a monitor of exactly that size', () => {
    const m = mon(2560, 1080);
    expect(matchMonitorBySize([m], { width: 2560, height: 1080 })).toBe(m);
  });

  it('matches an ultrawide standing on its side', () => {
    // 3440x1440 turned portrait arrives as 1440x3440; it is the same screen and
    // the same placement rules apply to it.
    const m = mon(1440, 3440);
    expect(matchMonitorBySize([m], { width: 3440, height: 1440 })).toBe(m);
  });

  it('matches a scaled monitor against its physical size', () => {
    // node-window-manager reports logical pixels; configs are written in
    // physical ones. 4K at 125% arrives as 3072x1728.
    const m = mon(3072, 1728, 1.25);
    expect(matchMonitorBySize([m], { width: 3840, height: 2160 })).toBe(m);
  });

  it('matches a monitor that is both scaled and rotated', () => {
    const m = mon(1728, 3072, 1.25);
    expect(matchMonitorBySize([m], { width: 3840, height: 2160 })).toBe(m);
  });

  it('prefers an exact match over a rotated one', () => {
    // Two screens whose sizes are each other transposed must not swap places.
    const rotated = mon(1080, 2560);
    const exact = mon(2560, 1080);
    expect(matchMonitorBySize([rotated, exact], { width: 2560, height: 1080 })).toBe(exact);
  });

  it('returns undefined for a monitor that is not connected', () => {
    expect(matchMonitorBySize([mon(2560, 1080)], { width: 1920, height: 1080 })).toBeUndefined();
    expect(matchMonitorBySize([], { width: 1920, height: 1080 })).toBeUndefined();
    expect(matchMonitorBySize([mon(100, 100)], undefined)).toBeUndefined();
  });

  it('survives a monitor with no scale factor function', () => {
    const m = { bounds: { x: 0, y: 0, width: 2560, height: 1080 } };
    expect(matchMonitorBySize([m], { width: 2560, height: 1080 })).toBe(m);
  });
});

describe('monitorsByConfigNumber', () => {
  const mon = (width, height) => ({ bounds: { x: 0, y: 0, width, height } });
  const sizes = {
    1: { width: 3440, height: 1440 },
    2: { width: 1440, height: 2560 },
    3: { width: 2560, height: 1080 },
  };

  it('keeps every monitor at its configured position', () => {
    const a = mon(3440, 1440);
    const c = mon(2560, 1080);
    const out = monitorsByConfigNumber([c, a], sizes);
    expect(out[0]).toBe(a);
    expect(out[2]).toBe(c);
  });

  it('leaves a hole for a monitor that is not connected instead of shifting the rest', () => {
    // The old code pushed only what it found, so one unplugged screen moved
    // every later monitor up a slot and placement rules silently went to the
    // wrong display.
    const c = mon(2560, 1080);
    const out = monitorsByConfigNumber([c], sizes);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBe(c);
  });

  it('returns an empty list when nothing is configured', () => {
    expect(monitorsByConfigNumber([mon(100, 100)], {})).toEqual([]);
    expect(monitorsByConfigNumber([mon(100, 100)], undefined)).toEqual([]);
  });
});
