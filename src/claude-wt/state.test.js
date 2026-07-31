import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

  it('leaves no .tmp sibling after a write', () => {
    writeState(filePath, emptyState());
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('creates a missing parent directory', () => {
    const nested = path.join(dir, 'nested', 'sub', 'state.json');
    writeState(nested, emptyState());
    expect(fs.existsSync(nested)).toBe(true);
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
