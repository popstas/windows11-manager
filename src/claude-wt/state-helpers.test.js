import { describe, it, expect } from 'vitest';
import { emptyState, normalizeState, rememberTitle, upsertSlot } from './state-helpers.js';

describe('rememberTitle', () => {
  it('puts the newest title first', () => {
    expect(rememberTitle(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('moves an already known title to the front instead of duplicating it', () => {
    expect(rememberTitle(['a', 'b'], 'b')).toEqual(['b', 'a']);
  });

  it('caps the history at 10 entries', () => {
    const many = Array.from({ length: 12 }, (_, i) => `t${i}`);
    expect(rememberTitle(many, 'new')).toHaveLength(10);
  });

  it('ignores an empty title', () => {
    expect(rememberTitle(['a'], '')).toEqual(['a']);
  });
});

describe('upsertSlot', () => {
  const bounds = { x: 1, y: 2, width: 3, height: 4 };

  it('creates a slot from scratch', () => {
    const slot = upsertSlot(undefined, { title: 'ccfzf', cwd: '/p', bounds, now: 1000 });
    expect(slot).toEqual({ titles: ['ccfzf'], cwd: '/p', bounds, desktop: null, focusedAt: 0, lastSeen: 1000 });
  });

  it('updates bounds without touching the desktop number', () => {
    const before = upsertSlot(undefined, { title: 'ccfzf', bounds, desktop: 2, now: 1000 });
    const after = upsertSlot(before, { bounds: { x: 9, y: 9, width: 3, height: 4 }, now: 2000 });
    expect(after.desktop).toBe(2);
    expect(after.bounds.x).toBe(9);
    expect(after.lastSeen).toBe(2000);
  });

  it('appends a renamed session title to the history', () => {
    const before = upsertSlot(undefined, { title: 'ccfzf', bounds, now: 1000 });
    const after = upsertSlot(before, { title: 'ccfzf CLI', now: 2000 });
    expect(after.titles).toEqual(['ccfzf CLI', 'ccfzf']);
  });
});

describe('normalizeState', () => {
  it('returns an empty state for anything unusable', () => {
    expect(normalizeState(null)).toEqual(emptyState());
    expect(normalizeState({ version: 99 })).toEqual(emptyState());
    expect(normalizeState('nope')).toEqual(emptyState());
  });

  it('drops slots without bounds or titles but keeps the rest', () => {
    const state = normalizeState({
      version: 1,
      slots: {
        good: { titles: ['a'], bounds: { x: 0, y: 0, width: 10, height: 10 }, lastSeen: 5 },
        broken: { titles: [], bounds: null },
      },
      lastLayout: ['good', 42],
      updated: 7,
    });
    expect(Object.keys(state.slots)).toEqual(['good']);
    expect(state.lastLayout).toEqual(['good']);
    expect(state.updated).toBe(7);
  });
});
