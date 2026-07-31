import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSessionIndex } from './sessions.js';

// loadSessionIndex keeps its cache at module scope, keyed by path. Every test
// therefore writes to its own file inside the temp dir, so nothing leaks from
// one case into the next.
let dir;
let n = 0;

const dumpWith = (...titles) => ({
  sessions: titles.map((title, i) => ({ id: `s${i}`, title, cwd: `/p${i}`, live: true, mtime: 100 + i })),
});

// Explicit mtimes: two writes in a row can land on the same timestamp, and
// "re-read only when the mtime changed" is exactly what is under test here.
const T0 = new Date(1700000000000);
const T1 = new Date(1700000005000);

function writeDump(filePath, dump, when) {
  fs.writeFileSync(filePath, JSON.stringify(dump));
  fs.utimesSync(filePath, when, when);
}

function freshPath() {
  return path.join(dir, `dump-${n++}.json`);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-wt-sessions-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadSessionIndex', () => {
  it('indexes a valid dump by title', () => {
    const p = freshPath();
    writeDump(p, dumpWith('ccfzf'), T0);
    expect(loadSessionIndex(p)).toEqual({
      ccfzf: { id: 's0', cwd: '/p0', title: 'ccfzf', ambiguous: false },
    });
  });

  it('does not re-read the file while its mtime is unchanged', () => {
    const p = freshPath();
    writeDump(p, dumpWith('ccfzf'), T0);
    const first = loadSessionIndex(p);
    // Содержимое подменено, mtime возвращён прежний: если бы файл читался
    // каждый раз, здесь появился бы 'home' — демон опрашивает раз в секунду,
    // а дамп меняется пару раз в день, ради этого кэш и существует.
    writeDump(p, dumpWith('home'), T0);
    expect(loadSessionIndex(p)).toEqual(first);
    expect(loadSessionIndex(p).home).toBeUndefined();
  });

  it('re-reads the file after its mtime changes', () => {
    const p = freshPath();
    writeDump(p, dumpWith('ccfzf'), T0);
    loadSessionIndex(p);
    writeDump(p, dumpWith('home'), T1);
    const index = loadSessionIndex(p);
    expect(index.home).toEqual({ id: 's0', cwd: '/p0', title: 'home', ambiguous: false });
    expect(index.ccfzf).toBeUndefined();
  });

  it('yields an empty index for a path that does not exist', () => {
    expect(loadSessionIndex(path.join(dir, 'never-written.json'))).toEqual({});
  });

  it('yields an empty index for an unparseable dump', () => {
    const p = freshPath();
    fs.writeFileSync(p, '{ half a write');
    expect(loadSessionIndex(p)).toEqual({});
  });

  it('yields an empty index for an empty path', () => {
    expect(loadSessionIndex('')).toEqual({});
  });

  it('keeps serving the last good index when the path becomes unreachable', () => {
    const p = freshPath();
    writeDump(p, dumpWith('ccfzf'), T0);
    const good = loadSessionIndex(p);
    // V: отвалился. Потерять все сессии из-за моргнувшего сетевого диска хуже,
    // чем отдать слегка устаревший индекс.
    fs.rmSync(p);
    expect(loadSessionIndex(p)).toEqual(good);
    expect(loadSessionIndex(p).ccfzf.id).toBe('s0');
  });

  it('does not serve another path\'s cached index when a path is unreachable', () => {
    const cached = freshPath();
    writeDump(cached, dumpWith('ccfzf'), T0);
    loadSessionIndex(cached);
    expect(loadSessionIndex(path.join(dir, 'other.json'))).toEqual({});
  });
});
