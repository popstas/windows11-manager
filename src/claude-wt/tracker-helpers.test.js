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

import { step } from './tracker-helpers.js';
import { emptyState, upsertSlot, normalizeState } from './state-helpers.js';

const bounds = (x, y) => ({ x, y, width: 800, height: 600 });
const index = { ccfzf: { id: 'a1', cwd: '/p', title: 'ccfzf', ambiguous: false } };

// Прогоняет тики, пока заголовок не станет стабильным, и отдаёт последний результат.
function run(ticks, { state = emptyState(), sessionIndex = index } = {}) {
  let prevWindows = [];
  let out = { nextWindows: [], actions: [], bindings: [], nextState: state };
  ticks.forEach((windows, i) => {
    out = step({ prevWindows, windows, sessionIndex, state: out.nextState, now: 1000 + i * 1000 });
    prevWindows = out.nextWindows;
  });
  return out;
}

describe('step', () => {
  it('creates a slot with the current position for a session it has never seen', () => {
    const w = [{ id: 1, title: 'ccfzf', bounds: bounds(10, 20) }];
    const out = run([w, w]);
    expect(out.actions).toEqual([]);
    expect(out.nextState.slots.a1.bounds).toEqual(bounds(10, 20));
    expect(out.bindings).toEqual([{ windowId: 1, sessionId: 'a1' }]);
  });

  it('moves the window back to the remembered position when the session returns', () => {
    const state = { ...emptyState(), slots: { a1: upsertSlot(undefined, { title: 'ccfzf', bounds: bounds(500, 500), desktop: 2, now: 1 }) } };
    const shell = [{ id: 1, title: 'popstas@pc-virt: ~', bounds: bounds(0, 0) }];
    const session = [{ id: 1, title: 'ccfzf', bounds: bounds(0, 0) }];
    const out = run([shell, shell, session, session], { state });
    expect(out.actions).toEqual([{ windowId: 1, bounds: bounds(500, 500), desktop: 2 }]);
  });

  it('records a position the user dragged the window to', () => {
    const w = [{ id: 1, title: 'ccfzf', bounds: bounds(10, 20) }];
    const moved = [{ id: 1, title: 'ccfzf', bounds: bounds(700, 300) }];
    const out = run([w, w, moved]);
    expect(out.nextState.slots.a1.bounds).toEqual(bounds(700, 300));
  });

  it('does not record the position while its own move is still in flight', () => {
    const state = { ...emptyState(), slots: { a1: upsertSlot(undefined, { title: 'ccfzf', bounds: bounds(500, 500), now: 1 }) } };
    const shell = [{ id: 1, title: 'x@y: ~', bounds: bounds(0, 0) }];
    const session = [{ id: 1, title: 'ccfzf', bounds: bounds(0, 0) }];
    // Fifth tick: the move action was emitted on tick 4 (title settles back to
    // 'ccfzf'), but Windows hasn't applied it yet — the window is still reported
    // at its pre-move position (0, 0). Without the pendingMove guard this tick
    // would overwrite the remembered slot with (0, 0).
    const out = run([shell, shell, session, session, session], { state });
    expect(out.nextState.slots.a1.bounds).toEqual(bounds(500, 500));
  });

  it('leaves the window alone when the title is not a session', () => {
    const w = [{ id: 1, title: 'popstas@pc-virt: ~/projects', bounds: bounds(10, 20) }];
    const out = run([w, w]);
    expect(out.actions).toEqual([]);
    expect(out.nextState.slots).toEqual({});
  });

  it('does not touch either window when two of them show the same title', () => {
    const w = [
      { id: 1, title: 'ccfzf', bounds: bounds(10, 20) },
      { id: 2, title: 'ccfzf', bounds: bounds(30, 40) },
    ];
    const out = run([w, w]);
    expect(out.actions).toEqual([]);
    expect(out.nextState.slots).toEqual({});
  });

  it('refuses to bind an ambiguous title', () => {
    const w = [{ id: 1, title: 'ccfzf', bounds: bounds(10, 20) }];
    const ambiguous = { ccfzf: { id: 'a1', cwd: '/p', title: 'ccfzf', ambiguous: true } };
    const out = run([w, w], { sessionIndex: ambiguous });
    expect(out.nextState.slots).toEqual({});
  });

  it('never records a minimized window', () => {
    const w = [{ id: 1, title: 'ccfzf', bounds: { x: -32000, y: -32000, width: 800, height: 600 } }];
    const out = run([w, w]);
    expect(out.nextState.slots).toEqual({});
  });

  it('keeps the slot but clears the layout when the window disappears', () => {
    const w = [{ id: 1, title: 'ccfzf', bounds: bounds(10, 20) }];
    const out = run([w, w, []]);
    expect(out.nextState.slots.a1.bounds).toEqual(bounds(10, 20));
    expect(out.nextState.lastLayout).toEqual([]);
  });

  it('lists the sessions on screen in lastLayout', () => {
    const two = {
      ccfzf: { id: 'a1', cwd: '/p', title: 'ccfzf', ambiguous: false },
      home: { id: 'b2', cwd: '/q', title: 'home', ambiguous: false },
    };
    const w = [
      { id: 1, title: 'ccfzf', bounds: bounds(10, 20) },
      { id: 2, title: 'home', bounds: bounds(30, 40) },
    ];
    const out = run([w, w], { sessionIndex: two });
    expect(out.nextState.lastLayout.sort()).toEqual(['a1', 'b2']);
  });

  it('stamps updated with the current time in seconds', () => {
    const w = [{ id: 1, title: 'ccfzf', bounds: bounds(10, 20) }];
    const out = run([w, w]);
    expect(out.nextState.updated).toBe(2);
  });

  it('still creates the slot once a session first seen minimized is restored', () => {
    const minimized = [{ id: 1, title: 'ccfzf', bounds: { x: -32000, y: -32000, width: 800, height: 600 } }];
    const restored = [{ id: 1, title: 'ccfzf', bounds: bounds(10, 20) }];
    const out = run([minimized, minimized, restored]);
    expect(out.nextState.slots.a1.titles).toContain('ccfzf');
    expect(out.bindings).toEqual([{ windowId: 1, sessionId: 'a1' }]);
    expect(normalizeState(out.nextState).slots.a1).toBeDefined();
  });

  it('stores lastSeen on the same epoch-seconds scale as updated', () => {
    const w = [{ id: 1, title: 'ccfzf', bounds: bounds(10, 20) }];
    const out = run([w, w]);
    expect(out.nextState.slots.a1.lastSeen).toBe(out.nextState.updated);
  });
});
