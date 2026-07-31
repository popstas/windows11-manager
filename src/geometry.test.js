import { describe, it, expect } from 'vitest';
import { getGapBounds, getGapOverlap, isBoundsMatch, applyMonitorsOffset, applyMonitorGaps, clampBoundsToMonitors } from './geometry.js';

const monBounds = { x: 0, y: 0, width: 1920, height: 1080 };

describe('getGapBounds', () => {
  it('bottom gap', () => {
    expect(getGapBounds({ monBounds, gap: { position: 'bottom', gap: 48 } }))
      .toEqual({ x: 0, y: 1032, width: 1920, height: 48 });
  });

  it('top gap', () => {
    expect(getGapBounds({ monBounds, gap: { position: 'top', gap: 48 } }))
      .toEqual({ x: 0, y: 0, width: 1920, height: 48 });
  });

  it('left gap', () => {
    expect(getGapBounds({ monBounds, gap: { position: 'left', gap: 60 } }))
      .toEqual({ x: 0, y: 0, width: 60, height: 1080 });
  });

  it('right gap', () => {
    expect(getGapBounds({ monBounds, gap: { position: 'right', gap: 60 } }))
      .toEqual({ x: 1860, y: 0, width: 60, height: 1080 });
  });

  it('invalid position returns undefined', () => {
    expect(getGapBounds({ monBounds, gap: { position: 'center', gap: 48 } }))
      .toBeUndefined();
  });
});

describe('getGapOverlap', () => {
  it('returns overlap when window intersects gap', () => {
    const pos = { x: 0, y: 1000, width: 1920, height: 80 };
    const gap = { position: 'bottom', gap: 48 };
    expect(getGapOverlap({ pos, monBounds, gap }))
      .toEqual({ x: 0, y: 1032, width: 1920, height: 48 });
  });

  it('returns undefined when no overlap', () => {
    const pos = { x: 0, y: 0, width: 500, height: 500 };
    const gap = { position: 'bottom', gap: 48 };
    expect(getGapOverlap({ pos, monBounds, gap })).toBeUndefined();
  });

  it('returns undefined for invalid gap position', () => {
    const pos = { x: 0, y: 0, width: 500, height: 500 };
    const gap = { position: 'center', gap: 48 };
    expect(getGapOverlap({ pos, monBounds, gap })).toBeUndefined();
  });
});

describe('isBoundsMatch', () => {
  it('exact match', () => {
    expect(isBoundsMatch({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 100 }))
      .toBe(true);
  });

  it('within 1px tolerance', () => {
    expect(isBoundsMatch({ x: 0, y: 0, width: 100, height: 100 }, { x: 1, y: 1, width: 101, height: 99 }))
      .toBe(true);
  });

  it('outside tolerance', () => {
    expect(isBoundsMatch({ x: 0, y: 0, width: 100, height: 100 }, { x: 5, y: 0, width: 100, height: 100 }))
      .toBe(false);
  });

  it('skips undefined fields in newPos', () => {
    expect(isBoundsMatch({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0 }))
      .toBe(true);
  });
});

describe('applyMonitorsOffset', () => {
  it('applies all 4 directions', () => {
    const pos = { x: 100, y: 100, width: 800, height: 600 };
    applyMonitorsOffset({ pos, offset: { left: 10, top: 20, right: 30, bottom: 40 } });
    expect(pos).toEqual({ x: 110, y: 120, width: 760, height: 540 });
  });

  it('no-op when offset is undefined', () => {
    const pos = { x: 100, y: 100, width: 800, height: 600 };
    applyMonitorsOffset({ pos, offset: undefined });
    expect(pos).toEqual({ x: 100, y: 100, width: 800, height: 600 });
  });

  it('clamps width/height to zero', () => {
    const pos = { x: 0, y: 0, width: 50, height: 50 };
    applyMonitorsOffset({ pos, offset: { left: 100, right: 100, top: 100, bottom: 100 } });
    expect(pos).toEqual({ x: 100, y: 100, width: 0, height: 0 });
  });

  it('partial offset — missing fields default to 0', () => {
    const pos = { x: 100, y: 100, width: 800, height: 600 };
    applyMonitorsOffset({ pos, offset: { left: 10 } });
    expect(pos).toEqual({ x: 110, y: 100, width: 790, height: 600 });
  });
});

describe('applyMonitorGaps', () => {
  it('bottom gap shrinks height', () => {
    const pos = { x: 0, y: 0, width: 1920, height: 1080 };
    applyMonitorGaps({ pos, monBounds, monitorGaps: { position: 'bottom', gap: 48 } });
    expect(pos).toEqual({ x: 0, y: 0, width: 1920, height: 1032 });
  });

  it('top gap shifts y and shrinks height', () => {
    const pos = { x: 0, y: 0, width: 1920, height: 1080 };
    applyMonitorGaps({ pos, monBounds, monitorGaps: { position: 'top', gap: 48 } });
    expect(pos).toEqual({ x: 0, y: 48, width: 1920, height: 1032 });
  });

  it('left gap shifts x and shrinks width', () => {
    const pos = { x: 0, y: 0, width: 1920, height: 1080 };
    applyMonitorGaps({ pos, monBounds, monitorGaps: { position: 'left', gap: 60 } });
    expect(pos).toEqual({ x: 60, y: 0, width: 1860, height: 1080 });
  });

  it('right gap shrinks width', () => {
    const pos = { x: 0, y: 0, width: 1920, height: 1080 };
    applyMonitorGaps({ pos, monBounds, monitorGaps: { position: 'right', gap: 60 } });
    expect(pos).toEqual({ x: 0, y: 0, width: 1860, height: 1080 });
  });

  it('array of multiple gaps', () => {
    const pos = { x: 0, y: 0, width: 1920, height: 1080 };
    applyMonitorGaps({
      pos, monBounds,
      monitorGaps: [
        { position: 'bottom', gap: 48 },
        { position: 'left', gap: 60 },
      ],
    });
    expect(pos).toEqual({ x: 60, y: 0, width: 1860, height: 1032 });
  });

  it('no-op when undefined', () => {
    const pos = { x: 0, y: 0, width: 1920, height: 1080 };
    applyMonitorGaps({ pos, monBounds, monitorGaps: undefined });
    expect(pos).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('skips invalid gaps (gap <= 0, missing gap field)', () => {
    const pos = { x: 0, y: 0, width: 1920, height: 1080 };
    applyMonitorGaps({
      pos, monBounds,
      monitorGaps: [
        { position: 'bottom', gap: -10 },
        { position: 'top', gap: 0 },
        { position: 'left' },
        null,
      ],
    });
    expect(pos).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('no-op when window does not overlap gap region', () => {
    const pos = { x: 0, y: 0, width: 960, height: 540 };
    applyMonitorGaps({ pos, monBounds, monitorGaps: { position: 'bottom', gap: 48 } });
    expect(pos).toEqual({ x: 0, y: 0, width: 960, height: 540 });
  });
});

describe('clampBoundsToMonitors', () => {
  const mons = [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }];

  it('leaves bounds that fit on a monitor untouched', () => {
    const b = { x: 100, y: 100, width: 800, height: 600 };
    expect(clampBoundsToMonitors(b, mons)).toEqual(b);
  });

  it('pulls a window back from a monitor that is gone', () => {
    const b = { x: 3000, y: 200, width: 800, height: 600 };
    expect(clampBoundsToMonitors(b, mons)).toEqual({ x: 1120, y: 200, width: 800, height: 600 });
  });

  it('pulls a window back from negative coordinates', () => {
    const b = { x: -2000, y: -500, width: 800, height: 600 };
    expect(clampBoundsToMonitors(b, mons)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('shrinks a window wider than every monitor', () => {
    const b = { x: 0, y: 0, width: 4000, height: 600 };
    expect(clampBoundsToMonitors(b, mons)).toEqual({ x: 0, y: 0, width: 1920, height: 600 });
  });

  it('keeps bounds as-is when the monitor list is empty', () => {
    const b = { x: 3000, y: 200, width: 800, height: 600 };
    expect(clampBoundsToMonitors(b, [])).toEqual(b);
  });

  describe('multi-monitor selection', () => {
    it('picks the monitor a fully-contained window overlaps, not monitors[0]', () => {
      const twoAcross = [
        { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
      ];
      // Fully inside the second monitor only — if the reduce picked monitors[0]
      // instead of the overlapping one, this would get pulled back to x:1120.
      const b = { x: 2000, y: 100, width: 800, height: 600 };
      expect(clampBoundsToMonitors(b, twoAcross)).toEqual(b);
    });

    it('picks a negative-origin monitor over a positive-origin one listed first', () => {
      const negativeSecond = [
        { bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
        { bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
      ];
      // Fully inside the negative-origin monitor (index 1) — if the reduce
      // stayed on monitors[0] (the primary), this would get pulled to x:0.
      const b = { x: -1800, y: 100, width: 800, height: 600 };
      expect(clampBoundsToMonitors(b, negativeSecond)).toEqual(b);
    });

    it('clamps a straddling window onto the monitor it overlaps more, not the other', () => {
      const twoAcross = [
        { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
      ];
      // x:1700..2100 — 220px sit on monitor 0, only 180px spill onto monitor 1,
      // so monitor 0 has more overlap and should be the clamp target.
      const b = { x: 1700, y: 100, width: 400, height: 300 };
      expect(clampBoundsToMonitors(b, twoAcross)).toEqual({ x: 1520, y: 100, width: 400, height: 300 });
    });

    it('falls back to the first monitor when the window overlaps none of them', () => {
      const noOverlap = [
        { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        { bounds: { x: 6000, y: 6000, width: 800, height: 600 } },
      ];
      // Far from every monitor — falls back to monitors[0] (1920x1080), not the
      // smaller second monitor, which would shrink the window differently.
      const b = { x: -5000, y: -5000, width: 1000, height: 800 };
      expect(clampBoundsToMonitors(b, noOverlap)).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
    });

    it('skips the 1-based placeholder at index 0 instead of throwing on it', () => {
      // getMons() returns a 1-based array with {} at index 0; reducing over it
      // reads mon.bounds.x of undefined and kills the caller's whole tick.
      const oneBased = [{}, { bounds: { x: 0, y: 0, width: 1920, height: 1080 } }];
      const b = { x: 3000, y: 200, width: 800, height: 600 };
      expect(() => clampBoundsToMonitors(b, oneBased)).not.toThrow();
      // And the surviving monitor is actually used, not silently ignored.
      expect(clampBoundsToMonitors(b, oneBased)).toEqual({ x: 1120, y: 200, width: 800, height: 600 });
    });

    it('skips a configured-but-detached monitor entry', () => {
      // getMonitor() returns sorted[ind], which is undefined for a monitor that
      // is in the config but not attached right now.
      const detached = [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, undefined];
      const b = { x: 100, y: 100, width: 800, height: 600 };
      expect(() => clampBoundsToMonitors(b, detached)).not.toThrow();
      expect(clampBoundsToMonitors(b, detached)).toEqual(b);
    });

    it('returns bounds unchanged when no entry has usable bounds', () => {
      const b = { x: 3000, y: 200, width: 800, height: 600 };
      // Nothing to clamp onto — leave the rectangle alone rather than inventing one.
      expect(clampBoundsToMonitors(b, [{}, undefined, { bounds: null }])).toEqual(b);
    });

    it('shrinks to the overlapping monitor\'s size, not another monitor\'s size', () => {
      const differentSizes = [
        { bounds: { x: 0, y: 0, width: 3840, height: 2160 } },
        { bounds: { x: 4000, y: 0, width: 1024, height: 768 } },
      ];
      // Overlaps only the small second monitor and is larger than it in both
      // dimensions — must shrink to 1024x768, not to the big monitor's size.
      const b = { x: 3900, y: 50, width: 1200, height: 900 };
      expect(clampBoundsToMonitors(b, differentSizes)).toEqual({ x: 4000, y: 0, width: 1024, height: 768 });
    });
  });
});
