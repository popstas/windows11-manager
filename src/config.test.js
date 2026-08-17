import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

/**
 * Кэш и копия-при-выдаче — свойства модуля, а не чистой функции, поэтому здесь
 * поднимается настоящий `config.js` в подставном окружении: четвёртый кандидат
 * поиска — `process.cwd()`, туда и кладётся файл. `HOME`/`XDG_CONFIG_HOME`
 * уводятся в пустой каталог, иначе кандидаты 1–3 могли бы попасть в реальный
 * конфиг машины, на которой идут тесты.
 */
describe('getConfig: кэш и копия', () => {
  const CONFIG_NAME = 'windows11-manager.config.yaml';
  let cwdBefore;
  let envBefore;
  let home;

  beforeEach(() => {
    cwdBefore = process.cwd();
    envBefore = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'w11m-home-'));
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = path.join(home, '.config');
    process.chdir(dir);
  });

  afterEach(() => {
    // Вернуть рабочий каталог обязательно: без этого соседние наборы ищут свои
    // файлы не там, а удаляемый tmpdir остаётся текущим каталогом процесса.
    process.chdir(cwdBefore);
    for (const [key, value] of Object.entries(envBefore)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /** Положить конфиг в cwd и поднять свежий экземпляр модуля. */
  async function loadModule(text = 'debug: true\nwindows: []\n') {
    if (text !== null) write(CONFIG_NAME, text);
    vi.resetModules();
    return import('./config.js');
  }

  /** Считать чтения файла конфига: кэш существует ради тика демона раз в секунду. */
  function countReads() {
    const spy = vi.spyOn(fs, 'readFileSync');
    return () => spy.mock.calls.filter(([f]) => String(f).endsWith(CONFIG_NAME)).length;
  }

  it('два вызова подряд без смены mtime читают файл один раз', async () => {
    const { getConfig } = await loadModule();
    const reads = countReads();
    getConfig();
    getConfig();
    expect(reads()).toBe(1);
  });

  it('смена mtime перечитывает файл', async () => {
    const { getConfig } = await loadModule('debug: true\n');
    const reads = countReads();
    expect(getConfig().debug).toBe(true);
    const file = path.join(dir, CONFIG_NAME);
    fs.writeFileSync(file, 'debug: false\n', 'utf8');
    // Запись на быстрой машине укладывается в тот же mtime, поэтому он двигается
    // руками: проверяется правило перечитывания, а не разрешение таймера ФС.
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(file, later, later);
    expect(getConfig().debug).toBe(false);
    expect(reads()).toBe(2);
  });

  it('reloadConfigs перечитывает независимо от mtime', async () => {
    const { getConfig, reloadConfigs } = await loadModule();
    const reads = countReads();
    getConfig();
    reloadConfigs();
    expect(reads()).toBe(2);
  });

  it('выдача — своя копия: правка результата не видна следующему вызову', async () => {
    // placement.js пишет rule.pos прямо в правила конфига, а findWindows()
    // дописывает им titleMatch — общий кэшированный объект копил бы эти пометки.
    const { getConfig } = await loadModule('debug: true\nwindows:\n  - window: Telegram\n');
    const first = getConfig();
    first.debug = 'испорчено';
    first.windows[0].pos = { x: 1 };
    const second = getConfig();
    expect(second.debug).toBe(true);
    expect(second.windows[0].pos).toBeUndefined();
  });

  it('_configPath называет прочитанный файл', async () => {
    const { getConfig } = await loadModule();
    expect(getConfig()._configPath).toBe(path.join(process.cwd(), CONFIG_NAME));
  });

  it('конфига нет нигде: путь пуст, а getConfig перечисляет просмотренные места', async () => {
    const { getConfig, resolveConfigPath, candidates } = await loadModule(null);
    expect(resolveConfigPath()).toBe('');
    expect(candidates()).toHaveLength(5);
    let message = '';
    try {
      getConfig();
    } catch (e) {
      message = e.message;
    }
    expect(message).toMatch(/^Конфиг не найден\. Просмотрены:/);
    for (const candidate of candidates()) expect(message).toContain(candidate);
  });
});
