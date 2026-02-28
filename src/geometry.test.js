import { describe, it, expect } from 'vitest';
import { getGapBounds, getGapOverlap, isBoundsMatch, applyMonitorsOffset, applyMonitorGaps } from './geometry.js';

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
