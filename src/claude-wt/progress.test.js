import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProgress } from './progress.js';

const ID = 'e8afde49-4254-4c64-970e-46c05bf5d516';

let dir;

function write(state, mtimeSec) {
  const file = path.join(dir, `${ID}.state.json`);
  fs.writeFileSync(file, JSON.stringify({ state, updated: 1, event: 'attention' }));
  // Отметка задаётся руками: весь смысл проверки в том, что содержимое
  // сменилось, а mtime остался прежним.
  if (mtimeSec !== undefined) fs.utimesSync(file, mtimeSec, mtimeSec);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-wt-progress-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadProgress', () => {
  it('reads the state the hook wrote', () => {
    write('active');
    expect(loadProgress(dir, [ID], 1000)[ID]?.state).toBe('active');
  });

  it('serves the cached value while the entry is fresh', () => {
    write('active', 1000);
    expect(loadProgress(dir, [ID], 1000)[ID]?.state).toBe('active');
    write('question', 1000);
    expect(loadProgress(dir, [ID], 1500)[ID]?.state).toBe('active');
  });

  // Ради этого случая у записи и появился срок годности. На сетевом диске
  // statSync() может минутами отдавать долгоживущему процессу прежний mtime
  // (замерено на V: 2026-08-02), и кэш, который верит одному только mtime,
  // показывает работающего агента там, где он уже спрашивает разрешение.
  it('re-reads a file whose mtime did not move but whose content did', () => {
    write('active', 1000);
    expect(loadProgress(dir, [ID], 1000)[ID]?.state).toBe('active');
    write('question', 1000);
    expect(loadProgress(dir, [ID], 9000)[ID]?.state).toBe('question');
  });

  it('says nothing about a session with no hook installed', () => {
    expect(loadProgress(dir, ['no-such-session'], 1000)).toEqual({});
  });
});
