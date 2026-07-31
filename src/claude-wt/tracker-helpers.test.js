import { describe, it, expect } from 'vitest';
import { trackTitle, duplicateTitles, resolveSession } from './tracker-helpers.js';

const win = (over = {}) => ({ id: 1, title: 'ccfzf', bounds: { x: 0, y: 0, width: 800, height: 600 }, ...over });

describe('trackTitle', () => {
  it('does not make a brand new title stable before stableTicks', () => {
    const t = trackTitle(undefined, win(), 2);
    expect(t.titleTicks).toBe(1);
    expect(t.stableTitle).toBe(null);
  });

  it('makes a title stable once it has held for stableTicks', () => {
    const first = trackTitle(undefined, win(), 2);
    const second = trackTitle(first, win(), 2);
    expect(second.stableTitle).toBe('ccfzf');
  });

  it('restarts the count when the title changes', () => {
    const first = trackTitle(undefined, win(), 2);
    const second = trackTitle(first, win(), 2);
    const third = trackTitle(second, win({ title: 'other' }), 2);
    expect(third.titleTicks).toBe(1);
    expect(third.stableTitle).toBe('ccfzf');   // прежний стабильный держится, пока новый не устоялся
  });

  it('carries over sessionId and pendingMove', () => {
    const before = { ...trackTitle(undefined, win(), 1), sessionId: 'a1', pendingMove: { since: 5 } };
    const after = trackTitle(before, win(), 1);
    expect(after.sessionId).toBe('a1');
    expect(after.pendingMove).toEqual({ since: 5 });
  });
});

describe('duplicateTitles', () => {
  it('reports a title shown by two windows at once', () => {
    const dup = duplicateTitles([win({ id: 1 }), win({ id: 2 }), win({ id: 3, title: 'other' })]);
    expect([...dup]).toEqual(['ccfzf']);
  });

  it('reports nothing when every title is unique', () => {
    expect(duplicateTitles([win({ id: 1 }), win({ id: 2, title: 'other' })]).size).toBe(0);
  });
});

describe('resolveSession', () => {
  const index = { ccfzf: { id: 'a1', cwd: '/p', title: 'ccfzf', ambiguous: false } };

  it('resolves from the ccfzf index', () => {
    expect(resolveSession('ccfzf', index, {})).toEqual({ id: 'a1', cwd: '/p', ambiguous: false });
  });

  it('falls back to the title history in state when the dump is unavailable', () => {
    const slots = { a1: { titles: ['ccfzf'], cwd: '/p', bounds: {}, desktop: null, lastSeen: 0 } };
    expect(resolveSession('ccfzf', {}, slots)).toEqual({ id: 'a1', cwd: '/p', ambiguous: false });
  });

  it('marks the fallback ambiguous when two slots claim the same title', () => {
    const slots = {
      a1: { titles: ['ccfzf'], cwd: '/p', bounds: {}, desktop: null, lastSeen: 10 },
      b2: { titles: ['ccfzf'], cwd: '/q', bounds: {}, desktop: null, lastSeen: 20 },
    };
    expect(resolveSession('ccfzf', {}, slots).ambiguous).toBe(true);
  });

  it('returns null for a shell prompt title', () => {
    expect(resolveSession('popstas@pc-virt: ~/projects', index, {})).toBe(null);
    expect(resolveSession(null, index, {})).toBe(null);
  });
});
