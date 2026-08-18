import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `readTileZonesText`/`writeTileZonesText` ходят в module-level `configPath`
 * `config.js` (тот же приём, что в `config.test.js`): cwd подставного каталога
 * — четвёртый кандидат поиска, `HOME`/`XDG_CONFIG_HOME` уводятся в пустой
 * каталог, чтобы кандидаты 1–3 не попали в настоящий конфиг машины, на которой
 * идут тесты, а модуль поднимается заново через `vi.resetModules()` после
 * того, как файл уже на месте.
 */
const CONFIG_NAME = 'windows11-manager.config.yaml';

let dir;
let cwdBefore;
let envBefore;
let home;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w11m-tile-zones-'));
  cwdBefore = process.cwd();
  envBefore = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'w11m-tile-zones-home-'));
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(cwdBefore);
  for (const [key, value] of Object.entries(envBefore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function write(text) {
  fs.writeFileSync(path.join(dir, CONFIG_NAME), text, 'utf8');
}

function read() {
  return fs.readFileSync(path.join(dir, CONFIG_NAME), 'utf8');
}

async function loadModule() {
  vi.resetModules();
  return import('./tile-zones-commands.js');
}

describe('readTileZonesText', () => {
  it('читает claudeWt.tileZones и форматирует по паре на строку', async () => {
    write([
      'claudeWt:',
      '  tileZones:',
      '    - { monitor: 1, position: 6 }',
      '    - { monitor: 1, position: 7 }',
      '',
    ].join('\n'));
    const { readTileZonesText } = await loadModule();
    expect(readTileZonesText()).toBe('1,6\n1,7');
  });

  it('ключа нет — пустая строка, а не отказ', async () => {
    write('claudeWt:\n  enabled: true\n');
    const { readTileZonesText } = await loadModule();
    expect(readTileZonesText()).toBe('');
  });
});

describe('writeTileZonesText', () => {
  it('сохраняет комментарии и форматирование остального файла', async () => {
    write([
      '# верхний комментарий файла',
      'debug: true',
      '',
      'claudeWt:',
      '  enabled: true',
      '  # Зоны FancyZones под терминалы claude, по порядку.',
      '  # tileZones:',
      '  #   - { monitor: 1, position: 6 }',
      '  terminal: wt',
      '  # комментарий у соседнего поля',
      '  windowsFile: /tmp/x',
      '',
    ].join('\n'));

    const { writeTileZonesText } = await loadModule();
    writeTileZonesText('1,6\n1,7');

    const out = read();
    expect(out).toContain('# верхний комментарий файла');
    expect(out).toContain('# Зоны FancyZones под терминалы claude, по порядку.');
    expect(out).toContain('#   - { monitor: 1, position: 6 }');
    expect(out).toContain('# комментарий у соседнего поля');
    expect(out).toContain('terminal: wt');
    expect(out).toContain('windowsFile: /tmp/x');
    // Новое значение записано в плоском стиле того же примера.
    expect(out).toContain('{ monitor: 1, position: 6 }');
    expect(out).toContain('{ monitor: 1, position: 7 }');
  });

  it('заменяет существующие tileZones на месте', async () => {
    write([
      'claudeWt:',
      '  tileZones:',
      '    - { monitor: 1, position: 6 }',
      '  terminal: wt',
      '',
    ].join('\n'));
    const { writeTileZonesText, readTileZonesText } = await loadModule();
    writeTileZonesText('2,1\n2,2');
    expect(readTileZonesText()).toBe('2,1\n2,2');
  });

  it('запись атомарна: временный файл не остаётся рядом после успеха', async () => {
    write('claudeWt:\n  enabled: true\n');
    const { writeTileZonesText } = await loadModule();
    writeTileZonesText('1,1');
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  it('неразборчивая строка отказывает и не трогает файл', async () => {
    const original = 'claudeWt:\n  enabled: true\n';
    write(original);
    const { writeTileZonesText } = await loadModule();
    expect(() => writeTileZonesText('not a zone')).toThrow(/строка 1/);
    expect(read()).toBe(original);
  });

  // Права temp-файла берутся у оригинала явно, а не отдаются umask: в
  // конфиге лежит mqtt_password, сузить доступ молча нельзя.
  it('временный файл создаётся с правами оригинала, а не по umask', async () => {
    write('claudeWt:\n  enabled: true\n');
    const file = path.join(dir, CONFIG_NAME);
    fs.chmodSync(file, 0o600);
    const { writeTileZonesText } = await loadModule();
    writeTileZonesText('1,1');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  // fsync — то, ради чего атомарная запись вообще нужна (см. state.js):
  // переименование журналируется файловой системой, данные без fsync нет.
  // Здесь же проверяется его сосед — уборка временного файла, если запись
  // после его открытия всё же не удалась.
  it('неудача fsync не оставляет временный файл и не трогает оригинал', async () => {
    const original = 'claudeWt:\n  enabled: true\n';
    write(original);
    const { writeTileZonesText } = await loadModule();
    const fsyncSpy = vi.spyOn(fs, 'fsyncSync').mockImplementation(() => {
      throw new Error('диск отвалился');
    });
    expect(() => writeTileZonesText('1,1')).toThrow(/диск отвалился/);
    fsyncSpy.mockRestore();
    expect(read()).toBe(original);
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });
});
