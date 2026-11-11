import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let config;
vi.mock('../config.js', () => ({ getConfig: () => config }));

const { CHILD_TTL_MS, upsertChild, childrenOfHead, readChildren, recordChild, childrenPath } = await import('./child-registry.js');

const DAY = 24 * 3600 * 1000;

describe('реестр детей — чистая часть', () => {
  it('upsertChild заменяет запись того же sessionId и ставит отметку времени', () => {
    const list = [{ sessionId: 's1', headId: 'h', windowId: 1, desktop: 1, at: 0 }];
    const out = upsertChild(list, { sessionId: 's1', headId: 'h', windowId: 2, desktop: 2 }, 10);
    expect(out).toEqual([{ sessionId: 's1', headId: 'h', windowId: 2, desktop: 2, at: 10 }]);
  });

  it('upsertChild выбрасывает записи старше CHILD_TTL_MS', () => {
    const now = 10 * DAY;
    const list = [
      { sessionId: 'old', headId: 'h', windowId: 1, at: now - CHILD_TTL_MS - 1 },
      { sessionId: 'fresh', headId: 'h', windowId: 2, at: now - DAY },
    ];
    const out = upsertChild(list, { sessionId: 'new', headId: 'h', windowId: 3, desktop: null }, now);
    expect(out.map(e => e.sessionId)).toEqual(['fresh', 'new']);
  });

  it('childrenOfHead отбирает живых детей этого head', () => {
    const now = 10 * DAY;
    const list = [
      { sessionId: 'a', headId: 'h1', windowId: 1, at: now },
      { sessionId: 'b', headId: 'h2', windowId: 2, at: now },
      { sessionId: 'c', headId: 'h1', windowId: 3, at: now - CHILD_TTL_MS - 1 },
    ];
    expect(childrenOfHead(list, 'h1', now).map(e => e.sessionId)).toEqual(['a']);
  });

  it('мусорные записи не роняют отбор', () => {
    expect(childrenOfHead([null, 'x', { headId: 'h' }, { sessionId: 'a', headId: 'h', windowId: 'w', at: 1 }], 'h', 1)).toEqual([]);
  });
});

describe('реестр детей — файл', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'child-registry-'));
    config = { claudeWt: { statePath: path.join(dir, 'claude-wt.json') } };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('лежит рядом со statePath', () => {
    expect(childrenPath()).toBe(path.join(dir, 'claude-wt-children.json'));
  });

  it('recordChild пишет, readChildren читает', () => {
    expect(recordChild({ sessionId: 's', headId: 'h', windowId: 5, desktop: 1 }, { now: 100 })).toBe(true);
    expect(readChildren()).toEqual([{ sessionId: 's', headId: 'h', windowId: 5, desktop: 1, at: 100 }]);
  });

  it('битый файл читается как пустой', () => {
    fs.writeFileSync(childrenPath(), '{"half');
    expect(readChildren()).toEqual([]);
  });

  it('без statePath реестра нет', () => {
    config = { claudeWt: {} };
    expect(childrenPath()).toBe('');
    expect(readChildren()).toEqual([]);
    expect(recordChild({ sessionId: 's', headId: 'h', windowId: 5 })).toBe(false);
  });
});
