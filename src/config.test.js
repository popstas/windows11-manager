import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfigFile } from './config.js';

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w11m-config-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(name, text) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

describe('loadConfigFile', () => {
  it('читает файл с диска и раскрывает якоря', () => {
    const file = write('c.yaml', [
      'x-anchors:',
      '  base: &base',
      '    desktop: 1',
      'debug: true',
      'windows:',
      '  - <<: *base',
      '    titleMatch: Telegram',
    ].join('\n'));
    expect(loadConfigFile(file)).toEqual({
      debug: true,
      windows: [{ desktop: 1, titleMatch: 'Telegram' }],
    });
  });

  it('не добавляет _configPath: сравнению конфигов лишний ключ мешает', () => {
    const file = write('c.yaml', 'debug: false\n');
    expect('_configPath' in loadConfigFile(file)).toBe(false);
  });

  it('битый файл называет своё имя', () => {
    const file = write('broken.yaml', 'mqtt: {host: a: b}\n');
    expect(() => loadConfigFile(file)).toThrow(/broken\.yaml/);
  });
});
