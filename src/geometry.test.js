import { describe, it, expect } from 'vitest';
import { getGapBounds, getGapOverlap, isBoundsMatch } from './geometry.js';

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
