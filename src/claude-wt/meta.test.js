import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadMeta } from './meta.js';

const ID = 'e8afde49-4254-4c64-970e-46c05bf5d516';

let dir;

function write(started, mtimeSec) {
  const file = path.join(dir, `${ID}.meta.json`);
  fs.writeFileSync(file, JSON.stringify({ sessionId: ID, started }));
  if (mtimeSec !== undefined) fs.utimesSync(file, mtimeSec, mtimeSec);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-wt-meta-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadMeta', () => {
  it('reads started from the SessionStart hook file', () => {
    write(1785613874);
    expect(loadMeta(dir, [ID], 1000)[ID]?.started).toBe(1785613874);
  });

  it('serves the cached value while the entry is fresh', () => {
    write(100, 1000);
    expect(loadMeta(dir, [ID], 1000)[ID]?.started).toBe(100);
    write(200, 1000);
    expect(loadMeta(dir, [ID], 1500)[ID]?.started).toBe(100);
  });

  it('re-reads a file whose mtime did not move but whose content did', () => {
    write(100, 1000);
    expect(loadMeta(dir, [ID], 1000)[ID]?.started).toBe(100);
    write(200, 1000);
    expect(loadMeta(dir, [ID], 9000)[ID]?.started).toBe(200);
  });

  it('says nothing about a session with no meta file', () => {
    expect(loadMeta(dir, ['no-such-session'], 1000)).toEqual({});
  });
});
