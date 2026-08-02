import { describe, it, expect } from 'vitest';
import {
  compositionKey,
  buildSnapshotSessions,
  appendSnapshot,
  updateLastSnapshot,
  normalizeSnapshots,
  pruneSnapshots,
  decideSnapshot,
  trackComposition,
  snapshotsFingerprint,
  planSnapshotRestore,
  findSnapshot,
} from './snapshot-helpers.js';

const bounds = { x: 10, y: 20, width: 300, height: 400 };
const slots = {
  a: { titles: ['alpha'], cwd: '/a', bounds, desktop: 1 },
  b: { titles: ['beta'], cwd: '/b', bounds: { ...bounds, x: 500 }, desktop: 2 },
  broken: { titles: ['gamma'], cwd: '/g', bounds: null, desktop: 1 },
};

describe('compositionKey', () => {
  it('does not depend on the order the windows came in', () => {
    // Windows arrive in hwnd order, which shuffles between ticks; treating a
    // reshuffle as a new composition would snapshot for no reason.
    expect(compositionKey(['b', 'a'])).toBe(compositionKey(['a', 'b']));
  });

  it('collapses duplicates', () => {
    expect(compositionKey(['a', 'a', 'b'])).toBe('a,b');
  });

  it('is empty for nothing open', () => {
    expect(compositionKey([])).toBe('');
    expect(compositionKey(undefined)).toBe('');
  });
});

describe('buildSnapshotSessions', () => {
  it('copies the slot data rather than referencing it', () => {
    // The whole point of a snapshot: a slot is "where this session sits today"
    // and gets overwritten — after a close and reopen it holds Windows
    // Terminal's default geometry.
    const [session] = buildSnapshotSessions({ sessionIds: ['a'], slots });
    session.bounds.x = 999;
    expect(slots.a.bounds.x).toBe(10);
  });

  it('records the monitor as it was at the time', () => {
    const [session] = buildSnapshotSessions({ sessionIds: ['a'], slots, monitorOf: () => 3 });
    expect(session.monitor).toBe(3);
  });

  it('skips a slot with no usable bounds, since it cannot be restored', () => {
    const out = buildSnapshotSessions({ sessionIds: ['a', 'broken'], slots });
    expect(out.map(s => s.id)).toEqual(['a']);
  });

  it('skips a session that has no slot at all', () => {
    expect(buildSnapshotSessions({ sessionIds: ['nope'], slots })).toEqual([]);
  });
});

describe('decideSnapshot', () => {
  const base = { pendingSince: 0, now: 60000, debounceMs: 60000 };

  it('appends once the new composition has been stable long enough', () => {
    expect(decideSnapshot({ ...base, key: 'a,b', lastKey: 'a', pendingKey: 'a,b' })).toBe('append');
  });

  it('waits while the debounce has not elapsed', () => {
    expect(decideSnapshot({ ...base, now: 59999, key: 'a,b', lastKey: 'a', pendingKey: 'a,b' })).toBeNull();
  });

  it('updates the last snapshot when only the coordinates moved', () => {
    // Dragging a window must not add a row to the menu.
    expect(decideSnapshot({ ...base, key: 'a,b', lastKey: 'a,b', pendingKey: 'a,b' })).toBe('update');
  });

  it('does nothing at all when nothing is open', () => {
    // Closing everything for the night must not snapshot an empty set, or
    // "snapshots-restore last" would restore nothing in the morning.
    expect(decideSnapshot({ ...base, key: '', lastKey: 'a,b', pendingKey: '' })).toBeNull();
  });

  it('does not append a composition that only just appeared', () => {
    expect(decideSnapshot({ ...base, key: 'a,b', lastKey: 'a', pendingKey: 'a' })).toBeNull();
  });
});

describe('trackComposition', () => {
  it('restarts the timer whenever the composition changes', () => {
    // A snapshot records a settled layout, not the moment of the change: while
    // three sessions are being opened one by one, the intermediate
    // configurations must not reach the history.
    const first = trackComposition({ key: 'a', pendingKey: '', pendingSince: 0, now: 1000 });
    expect(first).toEqual({ pendingKey: 'a', pendingSince: 1000 });
    const second = trackComposition({ key: 'a,b', ...first, now: 2000 });
    expect(second).toEqual({ pendingKey: 'a,b', pendingSince: 2000 });
  });

  it('leaves the timer alone while the composition holds', () => {
    const out = trackComposition({ key: 'a', pendingKey: 'a', pendingSince: 1000, now: 9000 });
    expect(out).toEqual({ pendingKey: 'a', pendingSince: 1000 });
  });
});

describe('appendSnapshot and updateLastSnapshot', () => {
  const sessions = [{ id: 'a', title: 'alpha', cwd: '/a', bounds, desktop: 1, monitor: 1 }];

  it('puts the new snapshot first', () => {
    const out = appendSnapshot([{ id: 'old', sessions }], { id: 'new', sessions, now: 5, keep: 20 });
    expect(out.map(s => s.id)).toEqual(['new', 'old']);
  });

  it('drops the oldest beyond the keep limit', () => {
    const existing = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];
    const out = appendSnapshot(existing, { id: 'd', sessions, now: 5, keep: 2 });
    expect(out.map(s => s.id)).toEqual(['d', 'c']);
  });

  it('rewrites the newest snapshot in place without adding a row', () => {
    const before = appendSnapshot([], { id: 'one', sessions, now: 5, keep: 20 });
    const moved = [{ ...sessions[0], bounds: { ...bounds, x: 999 } }];
    const after = updateLastSnapshot(before, { sessions: moved, now: 9 });
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe('one');
    expect(after[0].created).toBe(5);
    expect(after[0].updated).toBe(9);
    expect(after[0].sessions[0].bounds.x).toBe(999);
  });

  it('leaves an empty history alone', () => {
    expect(updateLastSnapshot([], { sessions, now: 9 })).toEqual([]);
  });
});

describe('pruneSnapshots', () => {
  it('falls back to the default when keep is nonsense', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i) }));
    expect(pruneSnapshots(many, 0)).toHaveLength(20);
    expect(pruneSnapshots(many, undefined)).toHaveLength(20);
  });
});

describe('normalizeSnapshots', () => {
  const good = {
    version: 1,
    snapshots: [{
      id: 'x', created: 1, updated: 2,
      sessions: [{ id: 'a', title: 't', cwd: '/c', bounds, desktop: 1, monitor: 2 }],
    }],
  };

  it('keeps a well-formed file', () => {
    expect(normalizeSnapshots(good).snapshots).toHaveLength(1);
  });

  it('starts over on a version it does not know', () => {
    expect(normalizeSnapshots({ ...good, version: 99 }).snapshots).toEqual([]);
    expect(normalizeSnapshots(null).snapshots).toEqual([]);
  });

  it('drops a snapshot left with no restorable session', () => {
    const bad = { version: 1, snapshots: [{ id: 'x', sessions: [{ id: 'a', bounds: null }] }] };
    expect(normalizeSnapshots(bad).snapshots).toEqual([]);
  });

  it('repairs fields the file got wrong', () => {
    const messy = {
      version: 1,
      snapshots: [{ id: 'x', sessions: [{ id: 'a', title: 5, cwd: null, bounds, desktop: 'two', monitor: {} }] }],
    };
    expect(normalizeSnapshots(messy).snapshots[0].sessions[0])
      .toEqual({ id: 'a', title: '', cwd: '', bounds, desktop: null, monitor: null });
  });
});

describe('snapshotsFingerprint', () => {
  it('ignores the timestamps, so an unchanged layout writes no file', () => {
    const a = [{ id: 'x', created: 1, updated: 2, sessions: [] }];
    const b = [{ id: 'x', created: 1, updated: 999, sessions: [] }];
    expect(snapshotsFingerprint(a)).toBe(snapshotsFingerprint(b));
  });

  it('changes when a session moves', () => {
    const a = [{ id: 'x', sessions: [{ id: 'a', bounds }] }];
    const b = [{ id: 'x', sessions: [{ id: 'a', bounds: { ...bounds, x: 1 } }] }];
    expect(snapshotsFingerprint(a)).not.toBe(snapshotsFingerprint(b));
  });
});

describe('planSnapshotRestore', () => {
  const snapshot = {
    id: 'x',
    sessions: [
      { id: 'a', title: 'alpha', cwd: '/a', bounds, desktop: 1 },
      { id: 'b', title: 'beta', cwd: '/b', bounds: { ...bounds, x: 500 }, desktop: 2 },
      { id: 'c', title: 'gamma', cwd: '/c', bounds, desktop: 1 },
    ],
  };
  const launch = { command: 'wt.exe', args: ['ssh', 'ccfzf --session {id}'] };

  it('brings back only what is missing', () => {
    // Three in the snapshot, two on screen: exactly one relaunch. Refusing
    // outright is what made the old restore useless in this case.
    const plan = planSnapshotRestore({ snapshot, openSessionIds: new Set(['a', 'b']), launch });
    expect(plan.map(p => p.sessionId)).toEqual(['c']);
  });

  it('plans nothing when everything is already open', () => {
    expect(planSnapshotRestore({ snapshot, openSessionIds: new Set(['a', 'b', 'c']), launch })).toEqual([]);
  });

  it('takes the coordinates from the snapshot', () => {
    const [item] = planSnapshotRestore({ snapshot, openSessionIds: new Set(['b', 'c']), launch });
    expect(item.bounds).toEqual(bounds);
    expect(item.desktop).toBe(1);
  });

  it('substitutes the session id into the launch arguments', () => {
    const [item] = planSnapshotRestore({ snapshot, openSessionIds: new Set(['b', 'c']), launch });
    expect(item.args).toEqual(['ssh', 'ccfzf --session a']);
  });

  it('applies WT profile to snapshot restore args', () => {
    const [item] = planSnapshotRestore({
      snapshot,
      openSessionIds: new Set(['b', 'c']),
      launch: { command: 'wt.exe', args: ['-w', '-1', 'ssh', 'ccfzf --session {id}'] },
      resolveProfile: () => 'popstas',
    });
    expect(item.args).toEqual(['-w', '-1', '-p', 'popstas', 'ssh', 'ccfzf --session a']);
  });

  it('resolves profile per snapshot session cwd', () => {
    const [item] = planSnapshotRestore({
      snapshot,
      openSessionIds: new Set(['b', 'c']),
      launch: { command: 'wt.exe', args: ['-w', '-1', 'ssh', 'ccfzf --session {id}'] },
      resolveProfile: cwd => cwd === '/a' ? 'ExpertizeMe' : 'popstas',
    });
    expect(item.args).toEqual(['-w', '-1', '-p', 'ExpertizeMe', 'ssh', 'ccfzf --session a']);
  });

  it('narrows to the requested sessions when asked', () => {
    const plan = planSnapshotRestore({ snapshot, openSessionIds: new Set(), sessionIds: ['b'], launch });
    expect(plan.map(p => p.sessionId)).toEqual(['b']);
  });

  it('survives an empty snapshot', () => {
    expect(planSnapshotRestore({ snapshot: null, openSessionIds: new Set(), launch })).toEqual([]);
  });
});

describe('findSnapshot', () => {
  const list = [{ id: 'newest' }, { id: 'older' }];

  it('treats "last" and a missing id as the newest snapshot', () => {
    // Literally the newest: a command that silently walks three snapshots back
    // leaves you guessing where the window came from.
    expect(findSnapshot(list, 'last').id).toBe('newest');
    expect(findSnapshot(list).id).toBe('newest');
  });

  it('finds a snapshot by its id', () => {
    expect(findSnapshot(list, 'older').id).toBe('older');
  });

  it('returns null for an id that is not there', () => {
    expect(findSnapshot(list, 'nope')).toBeNull();
    expect(findSnapshot([], 'last')).toBeNull();
  });
});
