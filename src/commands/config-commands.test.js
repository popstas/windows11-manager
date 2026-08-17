import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dumpConfig, verifyConfigs } from './config-commands.js';

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w11m-config-cmd-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(name, text) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

describe('dumpConfig', () => {
  it('по умолчанию печатает YAML с раскрытыми якорями', () => {
    const file = write('c.yaml', 'x-anchors:\n  b: &b\n    desktop: 1\nwindows:\n  - <<: *b\n');
    const out = dumpConfig(file);
    expect(out).toContain('windows:');
    expect(out).toContain('desktop: 1');
    expect(out).not.toContain('x-anchors');
  });

  it('--json печатает JSON', () => {
    const file = write('c.yaml', 'debug: true\n');
    expect(JSON.parse(dumpConfig(file, { json: true }))).toEqual({ debug: true });
  });
});

describe('verifyConfigs', () => {
  it('снимок JSON против YAML: совпало — успех одной строкой', () => {
    const a = write('old.json', JSON.stringify({ debug: true, windows: [{ desktop: 1 }] }));
    const b = write('new.yaml', 'debug: true\nwindows:\n  - desktop: 1\n');
    expect(verifyConfigs(a, b)).toEqual({ ok: true, lines: ['конфиги эквивалентны'] });
  });

  it('расхождение печатается путём и обоими значениями', () => {
    const a = write('old.json', JSON.stringify({ windows: [{ desktop: 1 }] }));
    const b = write('new.yaml', 'windows:\n  - desktop: 2\n');
    const res = verifyConfigs(a, b);
    expect(res.ok).toBe(false);
    expect(res.lines[0]).toBe('разошлись: windows[0].desktop  1 ≠ 2');
    expect(res.lines.at(-1)).toBe('расхождений: 1');
  });

  it('потерянная при переносе запись видна как отсутствующая', () => {
    const a = write('old.json', JSON.stringify({ claudeWt: { projects: [{ name: 'home' }] } }));
    const b = write('new.yaml', 'claudeWt:\n  projects: []\n');
    const res = verifyConfigs(a, b);
    expect(res.lines[0]).toContain('claudeWt.projects[0]');
    expect(res.lines[0]).toContain('отсутствует');
  });
});
