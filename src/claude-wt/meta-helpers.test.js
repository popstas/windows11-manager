import { describe, it, expect } from 'vitest';
import { normalizeMeta } from './meta-helpers.js';

describe('normalizeMeta', () => {
  it('keeps a finite started timestamp', () => {
    expect(normalizeMeta({ started: 1785613874 })).toEqual({ started: 1785613874 });
  });

  it('returns null when started is missing or zero', () => {
    expect(normalizeMeta({})).toBe(null);
    expect(normalizeMeta({ started: 0 })).toBe(null);
    expect(normalizeMeta({ started: 'nope' })).toBe(null);
    expect(normalizeMeta(null)).toBe(null);
  });
});
