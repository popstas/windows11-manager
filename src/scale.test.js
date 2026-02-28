import { describe, it, expect } from 'vitest';
import { adjustBoundsForScale } from './scale.js';

describe('adjustBoundsForScale', () => {
  it('returns same bounds when scales are equal', () => {
    const bounds = { x: 0, y: 0, width: 800, height: 600 };
    expect(adjustBoundsForScale({ bounds, oldScale: 1, newScale: 1 })).toEqual(bounds);
  });

  it('adjusts unspecified dimensions when scales differ', () => {
    const bounds = { x: 0, y: 0, width: 800, height: 600 };
    const result = adjustBoundsForScale({ bounds, oldScale: 1, newScale: 2, widthSpecified: false, heightSpecified: false });
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
  });

  it('does not adjust specified dimensions', () => {
    const bounds = { x: 0, y: 0, width: 800, height: 600 };
    const result = adjustBoundsForScale({ bounds, oldScale: 1, newScale: 2, widthSpecified: true, heightSpecified: true });
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it('returns bounds unchanged when oldScale is undefined', () => {
    const bounds = { x: 100, y: 200, width: 800, height: 600 };
    expect(adjustBoundsForScale({ bounds, oldScale: undefined, newScale: 2 })).toEqual(bounds);
  });

  it('returns undefined/null bounds as-is', () => {
    expect(adjustBoundsForScale({ bounds: undefined, oldScale: 1, newScale: 2 })).toBeUndefined();
    expect(adjustBoundsForScale({ bounds: null, oldScale: 1, newScale: 2 })).toBeNull();
  });

  it('scales from 150% to 100%', () => {
    const bounds = { x: 0, y: 0, width: 800, height: 600 };
    const result = adjustBoundsForScale({ bounds, oldScale: 1.5, newScale: 1, widthSpecified: false, heightSpecified: false });
    expect(result.width).toBe(1200);
    expect(result.height).toBe(900);
  });
});
