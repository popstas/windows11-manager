import { describe, it, expect } from 'vitest';
import { planFocus } from './focus-helpers.js';

const SLOTS = [
  { id: 'aaa', title: 'ccfzf-picker' },
  { id: 'bbb', title: 'windows11-manager' },
];

describe('planFocus', () => {
  it('returns the title of the matching slot', () => {
    expect(planFocus(SLOTS, 'bbb')).toEqual({ ok: true, title: 'windows11-manager' });
  });

  it('refuses without an id', () => {
    expect(planFocus(SLOTS, '')).toEqual({ ok: false, reason: 'id is required' });
    expect(planFocus(SLOTS, undefined)).toEqual({ ok: false, reason: 'id is required' });
  });

  it('refuses an unknown id', () => {
    expect(planFocus(SLOTS, 'ccc')).toEqual({ ok: false, reason: 'unknown session ccc' });
  });

  it('refuses a slot that was never bound to a window', () => {
    expect(planFocus([{ id: 'aaa' }], 'aaa'))
      .toEqual({ ok: false, reason: 'session aaa has no window title' });
  });

  it('survives a missing slot list', () => {
    expect(planFocus(undefined, 'aaa')).toEqual({ ok: false, reason: 'unknown session aaa' });
  });
});
