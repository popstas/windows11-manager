import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeWindowsFile, removeWindowsFile } from './windows-file.js';

let dir;
let filePath;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-wt-windows-'));
  filePath = path.join(dir, 'windows.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('removeWindowsFile', () => {
  it('убирает опубликованный файл, чтобы в нём не остался pid мёртвого демона', () => {
    writeWindowsFile(filePath, { host: 'pc', pid: 123, generated: 1, windows: {} });
    expect(fs.existsSync(filePath)).toBe(true);

    removeWindowsFile(filePath);

    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('убирает и .tmp, оставшийся от порванной записи', () => {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, '{"half"');

    removeWindowsFile(filePath);

    expect(fs.existsSync(tmp)).toBe(false);
  });

  it('молчит, когда файла и не было', () => {
    expect(() => removeWindowsFile(filePath)).not.toThrow();
  });

  it('молчит на пустом пути: файл окон — необязательная настройка', () => {
    expect(() => removeWindowsFile('')).not.toThrow();
  });

  it('отдаёт наверх ошибку, которая не «файла нет»', () => {
    // Каталог на месте файла: unlink на нём даёт EPERM/EISDIR, и молчать про
    // такое нельзя — файл остаётся лежать, а вместе с ним и чужой pid.
    fs.mkdirSync(filePath);

    expect(() => removeWindowsFile(filePath)).toThrow();
  });
});
