import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readState, writeState } from './state.js';
import { emptyState } from './state-helpers.js';

let dir;
let filePath;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-wt-state-'));
  filePath = path.join(dir, 'state.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('writeState / readState round-trip', () => {
  it('writes then reads back the same state', () => {
    const state = {
      version: 1,
      slots: {
        s1: { titles: ['a'], cwd: '/p', bounds: { x: 0, y: 0, width: 10, height: 10 }, desktop: 1, lastSeen: 5 },
      },
      lastLayout: ['s1'],
      updated: 5,
    };
    writeState(filePath, state);
    expect(readState(filePath)).toEqual(state);
  });

  it('creates a missing parent directory', () => {
    const nested = path.join(dir, 'nested', 'sub', 'state.json');
    writeState(nested, emptyState());
    expect(fs.existsSync(nested)).toBe(true);
  });
});

describe('writeState atomicity', () => {
  const original = {
    version: 1,
    slots: { s1: { titles: ['a'], cwd: '/p', bounds: { x: 1, y: 2, width: 30, height: 40 }, desktop: 1, lastSeen: 5 } },
    lastLayout: ['s1'],
    updated: 5,
  };
  const next = { ...original, lastLayout: [], updated: 9 };

  it('leaves the previous state readable when the write dies at the rename', () => {
    writeState(filePath, original);
    // Пишем во временный файл и переименовываем поверх цели именно ради этого:
    // упавшая запись не должна оставить на месте state.json обрубок. Прямой
    // writeFileSync(filePath) провалит этот тест — он не бросит на rename и
    // затрёт файл наполовину записанным состоянием.
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('EPERM'); });
    try {
      expect(() => writeState(filePath, next)).toThrow(/EPERM/);
    } finally {
      rename.mockRestore();
    }
    expect(readState(filePath)).toEqual(original);
  });

  it('flushes the temp file to disk before renaming it over the target', () => {
    // Переименование журналируется, данные — нет: без fsync выключение питания
    // оставляет нулевой или порванный файл, а вместе с ним теряется lastLayout,
    // ради которого атомарная запись и заводилась.
    const calls = [];
    const fsync = vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => calls.push(['fsync', fd]));
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => calls.push(['rename', from, to]));
    try {
      writeState(filePath, original);
    } finally {
      fsync.mockRestore();
      rename.mockRestore();
    }
    expect(calls.map(c => c[0])).toEqual(['fsync', 'rename']);
  });
});

describe('readState corruption recovery', () => {
  it('returns emptyState and moves invalid JSON to .bak, preserving the original bytes', () => {
    const garbage = '{ not valid json';
    fs.writeFileSync(filePath, garbage);
    const state = readState(filePath);
    expect(state).toEqual(emptyState());
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.existsSync(`${filePath}.bak`)).toBe(true);
    expect(fs.readFileSync(`${filePath}.bak`, 'utf8')).toBe(garbage);
  });

  it('returns emptyState without creating anything for a nonexistent path', () => {
    const missing = path.join(dir, 'does-not-exist.json');
    expect(readState(missing)).toEqual(emptyState());
    expect(fs.existsSync(missing)).toBe(false);
    expect(fs.existsSync(`${missing}.bak`)).toBe(false);
  });

  it('returns emptyState for a structurally invalid but parseable file', () => {
    fs.writeFileSync(filePath, JSON.stringify({ version: 99 }));
    expect(readState(filePath)).toEqual(emptyState());
  });
});
