import { describe, it, expect } from 'vitest';
import { indexSessions, compareSessions } from './sessions-helpers.js';

const session = (over = {}) => ({
  id: 'a1', cwd: '/home/popstas/p', title: 'ccfzf', mtime: 100, live: false, ...over,
});

describe('indexSessions', () => {
  it('indexes sessions by title', () => {
    const index = indexSessions({ sessions: [session()] });
    expect(index.ccfzf).toEqual({ id: 'a1', cwd: '/home/popstas/p', title: 'ccfzf', ambiguous: false });
  });

  it('prefers a live session over a dead one with the same title', () => {
    const index = indexSessions({ sessions: [
      session({ id: 'dead', mtime: 500, live: false }),
      session({ id: 'live', mtime: 100, live: true }),
    ] });
    expect(index.ccfzf.id).toBe('live');
    expect(index.ccfzf.ambiguous).toBe(false);
  });

  it('prefers the newer session when liveness is equal', () => {
    const index = indexSessions({ sessions: [
      session({ id: 'old', mtime: 100 }),
      session({ id: 'new', mtime: 900 }),
    ] });
    expect(index.ccfzf.id).toBe('new');
  });

  it('marks a title ambiguous when the top two are indistinguishable', () => {
    const index = indexSessions({ sessions: [
      session({ id: 'x', mtime: 100, live: true }),
      session({ id: 'y', mtime: 100, live: true }),
    ] });
    expect(index.ccfzf.ambiguous).toBe(true);
  });

  it('skips entries without an id or a title', () => {
    const index = indexSessions({ sessions: [
      session({ id: '', title: 'no-id' }),
      session({ title: '', id: 'no-title' }),
      session({ id: 'ok', title: 'ok' }),
    ] });
    expect(Object.keys(index)).toEqual(['ok']);
  });

  it('returns an empty index for a missing or malformed dump', () => {
    expect(indexSessions(null)).toEqual({});
    expect(indexSessions({})).toEqual({});
    expect(indexSessions({ sessions: 'nope' })).toEqual({});
  });
});

describe('compareSessions', () => {
  it('returns 0 for sessions with equal liveness and mtime', () => {
    expect(compareSessions(session(), session({ id: 'b1' }))).toBe(0);
  });
});
