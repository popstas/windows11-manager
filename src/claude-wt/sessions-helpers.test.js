import { describe, it, expect } from 'vitest';
import { indexSessions, indexBackgroundAgents, compareSessions, isStaleRead } from './sessions-helpers.js';

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

  it('indexes a decorated dump title under its bare form', () => {
    // В окне заголовок приходит со статус-глифом Claude Code, в дампе — без
    // него. Индекс ключуется той же формой, в которой заголовок сравнивается.
    const index = indexSessions({ sessions: [session({ title: '✳ ccfzf' })] });
    expect(index.ccfzf.id).toBe('a1');
    expect(index.ccfzf.title).toBe('✳ ccfzf');
  });

  it('treats decorated and bare spellings of one title as the same session', () => {
    const index = indexSessions({ sessions: [
      session({ id: 'x', title: '✳ ccfzf', mtime: 100, live: true }),
      session({ id: 'y', title: 'ccfzf', mtime: 100, live: true }),
    ] });
    expect(Object.keys(index)).toEqual(['ccfzf']);
    expect(index.ccfzf.ambiguous).toBe(true);
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

describe('indexSessions with agent activity', () => {
  const dump = {
    sessions: [
      { id: 'stale', title: 'shared', cwd: '/a', live: true, mtime: 1000 },
      { id: 'working', title: 'shared', cwd: '/a', live: false, mtime: 2000 },
    ],
  };

  it('believes the hook over the dump when they disagree about who is alive', () => {
    // Measured 2026-08-01: two sessions shared the title `shared`, the one
    // actually running was marked live=false and a dead one carried
    // live=true. The hook fires on every tool call of a real agent, so a
    // fresh write from it outweighs any flag in the dump.
    const activity = id => (id === 'working' ? 5000 : 0);
    expect(indexSessions(dump, activity).shared.id).toBe('working');
  });

  it('falls back to the dump when the hook knows nothing', () => {
    expect(indexSessions(dump, () => 0).shared.id).toBe('stale');
    expect(indexSessions(dump).shared.id).toBe('stale');
  });

  it('prefers the more recent of two sessions the hook has seen', () => {
    const activity = id => (id === 'working' ? 9000 : 8000);
    expect(indexSessions(dump, activity).shared.id).toBe('working');
  });

  it('never asks about a title only one session claims', () => {
    // Every question is a stat over a network share; with no rival there is
    // nothing to decide.
    const asked = [];
    const one = { sessions: [{ id: 'solo', title: 'alone', cwd: '/a', live: true, mtime: 1 }] };
    indexSessions(one, id => { asked.push(id); return 0; });
    expect(asked).toEqual([]);
  });

  it('still reports a tie as ambiguous', () => {
    const tied = {
      sessions: [
        { id: 'a', title: 'same', cwd: '/x', live: true, mtime: 100 },
        { id: 'b', title: 'same', cwd: '/x', live: true, mtime: 100 },
      ],
    };
    expect(indexSessions(tied, () => 0).same.ambiguous).toBe(true);
  });
});

describe('background agents', () => {
  const bg = (over = {}) => session({
    id: 'child', kind: 'background', parent: 'a1', live: true, mtime: 200, ...over,
  });

  it('keeps a background agent out of the title index', () => {
    // Форк наследует заголовок родителя и работает вместо него, то есть по
    // любому признаку выигрывает окно, в котором его нет.
    const index = indexSessions({ sessions: [session(), bg()] });
    expect(index.ccfzf.id).toBe('a1');
  });

  it('leaves a title with nothing but background agents unindexed', () => {
    expect(indexSessions({ sessions: [bg()] })).toEqual({});
  });

  it('groups background agents under their parent, newest first', () => {
    const agents = indexBackgroundAgents({ sessions: [
      session(),
      bg({ id: 'old', mtime: 100 }),
      bg({ id: 'new', mtime: 900 }),
    ] });
    expect(agents.a1.map(a => a.id)).toEqual(['new', 'old']);
    expect(agents.a1[0]).toEqual({ id: 'new', title: 'ccfzf', live: true });
  });

  it('ignores a background agent whose parent is unknown', () => {
    expect(indexBackgroundAgents({ sessions: [bg({ parent: '' })] })).toEqual({});
  });

  it('yields nothing for a dump without agents', () => {
    expect(indexBackgroundAgents({ sessions: [session()] })).toEqual({});
    expect(indexBackgroundAgents(null)).toEqual({});
  });
});

describe('isStaleRead', () => {
  const mtime = 1_700_000_000_000;
  const at = ms => (mtime + ms) / 1000;

  it('accepts content stamped a moment before the rename', () => {
    // Так и выглядит честный дамп: `generated` ставится за миг до os.replace.
    expect(isStaleRead(mtime, at(-200))).toBe(false);
  });

  it('accepts content stamped after the mtime', () => {
    // Отметка файла по SMB бывает на секунду позади содержимого — это не то,
    // что мы ловим: врёт тут метаданное, а байты свежие.
    expect(isStaleRead(mtime, at(1000))).toBe(false);
  });

  it('catches content a whole generation behind its own file', () => {
    expect(isStaleRead(mtime, at(-5 * 60 * 1000))).toBe(true);
  });

  it('says nothing about a dump without a timestamp', () => {
    // Старый ccfzf без поля `generated`: гадать не о чем, читаем как есть.
    expect(isStaleRead(mtime, undefined)).toBe(false);
    expect(isStaleRead(mtime, 'вчера')).toBe(false);
    expect(isStaleRead(NaN, at(-5 * 60 * 1000))).toBe(false);
  });
});
