import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  vi.restoreAllMocks();
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

  // Случай 2026-11-15 (└picker-term): хук записал idle, mtime на V: свежий, а
  // чтение по пути отдаёт прежний active из кэша клиента SMB. Без перечитывания
  // через r+ служба держала зелёную кнопку WezTerm минутами.
  it('content older than the file mtime is re-read past the client cache', () => {
    const file = path.join(dir, `${ID}.state.json`);
    fs.writeFileSync(file, JSON.stringify({ state: 'idle', updated: 2000, event: 'attention' }));
    fs.utimesSync(file, 2000, 2000);
    const stale = JSON.stringify({ state: 'active', updated: 1500, event: 'tool-start' });
    const real = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((target, ...rest) => (
      typeof target === 'string' ? stale : real(target, ...rest)));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadProgress(dir, [ID], 1000)[ID]?.state).toBe('idle');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('an honest file is read once, without the r+ detour', () => {
    const file = path.join(dir, `${ID}.state.json`);
    fs.writeFileSync(file, JSON.stringify({ state: 'active', updated: 2000 }));
    fs.utimesSync(file, 2000, 2000);
    const open = vi.spyOn(fs, 'openSync');
    expect(loadProgress(dir, [ID], 1000)[ID]?.state).toBe('active');
    expect(open).not.toHaveBeenCalled();
  });
});
