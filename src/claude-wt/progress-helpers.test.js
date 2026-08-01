import { describe, it, expect } from 'vitest';
import { normalizeProgress, lastActivityAt, seenSinceUpdate } from './progress-helpers.js';

describe('normalizeProgress', () => {
  it('keeps a well-formed record', () => {
    expect(normalizeProgress({ state: 'active', updated: 100, message: 'hi' }))
      .toEqual({ state: 'active', updated: 100, event: '', message: 'hi' });
  });

  it('accepts every state the hook writes', () => {
    for (const state of ['active', 'question', 'review', 'idle']) {
      expect(normalizeProgress({ state, updated: 1 })?.state).toBe(state);
    }
  });

  it('drops a state it does not know but keeps the timestamp', () => {
    // The hook has an `unknown` branch of its own, and the file is written by
    // another process: an unrecognised state must not reach the picker, yet
    // the write itself still proves the session was alive at that moment.
    expect(normalizeProgress({ state: 'unknown', updated: 42 }))
      .toEqual({ state: null, updated: 42, event: '', message: '' });
  });

  it('returns null when there is neither a state nor a time', () => {
    expect(normalizeProgress({ state: 'nope' })).toBeNull();
    expect(normalizeProgress({})).toBeNull();
    expect(normalizeProgress(null)).toBeNull();
    expect(normalizeProgress('active')).toBeNull();
  });

  it('ignores a non-numeric timestamp', () => {
    expect(normalizeProgress({ state: 'idle', updated: 'soon' }))
      .toEqual({ state: 'idle', updated: 0, event: '', message: '' });
  });

  it('ignores a non-string message', () => {
    expect(normalizeProgress({ state: 'question', updated: 5, message: { a: 1 } }).message).toBe('');
  });
});

describe('lastActivityAt', () => {
  it('prefers whichever source saw the session more recently', () => {
    expect(lastActivityAt({ lastSeen: 100 }, { updated: 200 })).toBe(200);
    expect(lastActivityAt({ lastSeen: 300 }, { updated: 200 })).toBe(300);
  });

  it('falls back to the slot when there is no hook data', () => {
    expect(lastActivityAt({ lastSeen: 100 }, null)).toBe(100);
  });

  it('falls back to the hook when the slot has no timestamp', () => {
    expect(lastActivityAt({}, { updated: 100 })).toBe(100);
    expect(lastActivityAt(null, { updated: 100 })).toBe(100);
  });

  it('returns null when nothing is known, so the picker draws no age', () => {
    expect(lastActivityAt({}, null)).toBeNull();
    expect(lastActivityAt({ lastSeen: 0 }, { updated: 0 })).toBeNull();
  });
});

describe('seenSinceUpdate', () => {
  it('counts a focus that came after the agent wrote its state', () => {
    expect(seenSinceUpdate({ focusedAt: 200 }, { updated: 100 })).toBe(true);
  });

  it('counts a focus in the very same second as seen', () => {
    // Both marks are in whole seconds, so an equal pair is a focus that
    // landed after the write, not before it.
    expect(seenSinceUpdate({ focusedAt: 100 }, { updated: 100 })).toBe(true);
  });

  it('does not count a focus from before the state was written', () => {
    // Looked at the window, then the agent finished: that state is unseen.
    expect(seenSinceUpdate({ focusedAt: 100 }, { updated: 200 })).toBe(false);
  });

  it('treats a window that was never focused as unseen', () => {
    expect(seenSinceUpdate({ focusedAt: 0 }, { updated: 100 })).toBe(false);
    expect(seenSinceUpdate({}, { updated: 100 })).toBe(false);
    expect(seenSinceUpdate(null, { updated: 100 })).toBe(false);
  });

  it('returns false when the agent said nothing, because there was nothing to see', () => {
    expect(seenSinceUpdate({ focusedAt: 500 }, null)).toBe(false);
    expect(seenSinceUpdate({ focusedAt: 500 }, { updated: 0 })).toBe(false);
  });
});
