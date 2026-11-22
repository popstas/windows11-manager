import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { renameWithRetry } from './rename-retry.js';

const err = code => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });

describe('renameWithRetry', () => {
  it('EPERM дважды, потом удача — файл переименован, паузы растут', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-retry-'));
    const from = path.join(dir, 'a.tmp');
    const to = path.join(dir, 'a.json');
    fs.writeFileSync(from, 'new');
    fs.writeFileSync(to, 'old');
    let fails = 2;
    const rename = vi.fn((a, b) => {
      if (fails-- > 0) throw err('EPERM');
      fs.renameSync(a, b);
    });
    const sleep = vi.fn();
    expect(renameWithRetry(from, to, { rename, sleep })).toBe(3);
    expect(fs.readFileSync(to, 'utf8')).toBe('new');
    expect(fs.existsSync(from)).toBe(false);
    expect(sleep.mock.calls.map(c => c[0])).toEqual([20, 40]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('EBUSY и EACCES тоже повторяются', () => {
    for (const code of ['EBUSY', 'EACCES']) {
      let fails = 1;
      const rename = vi.fn(() => { if (fails-- > 0) throw err(code); });
      expect(renameWithRetry('a', 'b', { rename, sleep: () => {} })).toBe(2);
    }
  });

  it('держат дольше всех попыток — бросает последнюю ошибку', () => {
    const rename = vi.fn(() => { throw err('EPERM'); });
    const sleep = vi.fn();
    expect(() => renameWithRetry('a', 'b', { rename, sleep })).toThrow(/EPERM/);
    expect(rename).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  it('прочие ошибки не повторяются', () => {
    const rename = vi.fn(() => { throw err('ENOENT'); });
    const sleep = vi.fn();
    expect(() => renameWithRetry('a', 'b', { rename, sleep })).toThrow(/ENOENT/);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('настоящая пауза синхронная и короткая', () => {
    let fails = 1;
    const rename = () => { if (fails-- > 0) throw err('EPERM'); };
    const t = Date.now();
    renameWithRetry('a', 'b', { rename, delayMs: 15 });
    expect(Date.now() - t).toBeGreaterThanOrEqual(10);
  });
});
