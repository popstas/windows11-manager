import { describe, it, expect } from 'vitest';
import { parseConfigText } from './config-helpers.js';
import { configCandidates, shouldReload, formatMissingConfig } from './config-helpers.js';
import { diffConfigs, describeValue, MISSING } from './config-helpers.js';

describe('parseConfigText', () => {
  it('раскрывает merge-ключ: правило получает поля якоря', () => {
    const text = [
      'x-anchors:',
      '  base: &base',
      '    desktop: 1',
      '    fancyZones: { monitor: 1, position: 3 }',
      'windows:',
      '  - <<: *base',
      '    titleMatch: Telegram',
    ].join('\n');
    expect(parseConfigText(text)).toEqual({
      windows: [{ desktop: 1, fancyZones: { monitor: 1, position: 3 }, titleMatch: 'Telegram' }],
    });
  });

  it('своё поле перебивает унаследованное', () => {
    const text = [
      'x-anchors:',
      '  base: &base',
      '    desktop: 1',
      'windows:',
      '  - <<: *base',
      '    desktop: 2',
    ].join('\n');
    expect(parseConfigText(text).windows[0].desktop).toBe(2);
  });

  it('x-anchors в выдаче нет: иначе сравнение со старым конфигом врало бы', () => {
    const text = 'x-anchors:\n  base: &base\n    a: 1\ndebug: true\n';
    expect(parseConfigText(text)).toEqual({ debug: true });
  });

  it('пустой файл — пустой конфиг, а не падение', () => {
    expect(parseConfigText('')).toEqual({});
  });

  it('битый YAML — сообщение с позицией и именем файла, а не стек', () => {
    // Табуляция в отступе: YAML её запрещает, а редактор ставит молча — самая
    // частая поломка файла, написанного руками.
    const text = 'debug: true\n\tmqtt: 1\n';
    expect(() => parseConfigText(text, 'C:/cfg.yaml')).toThrow(/строка \d+/);
    expect(() => parseConfigText(text, 'C:/cfg.yaml')).toThrow(/C:\/cfg\.yaml/);
  });

  it('список вместо отображения — внятный отказ', () => {
    expect(() => parseConfigText('- a\n- b\n')).toThrow(/списком/);
  });
});

describe('configCandidates', () => {
  const dirs = { appDataDir: '/app', homedir: '/home/u', cwd: '/work', repoDir: '/repo' };

  it('пять мест в порядке приоритета, все с расширением .yaml', () => {
    expect(configCandidates(dirs).map(p => p.replace(/\\/g, '/'))).toEqual([
      '/app/windows-mqtt/windows11-manager.config.yaml',
      '/app/windows11-manager/config.yaml',
      '/home/u/.config/windows11-manager.config.yaml',
      '/work/windows11-manager.config.yaml',
      '/repo/config.yaml',
    ]);
  });

  it('второго имени .yml нет ни у одного кандидата', () => {
    expect(configCandidates(dirs).some(p => p.endsWith('.yml'))).toBe(false);
  });
});

describe('shouldReload', () => {
  const base = { cachedPath: '/c.yaml', cachedMtimeMs: 100, filePath: '/c.yaml', mtimeMs: 100 };

  it('ничего не изменилось — не перечитываем', () => {
    expect(shouldReload(base)).toBe(false);
  });

  it('файл переписали — перечитываем', () => {
    expect(shouldReload({ ...base, mtimeMs: 101 })).toBe(true);
  });

  it('сменился путь — перечитываем', () => {
    expect(shouldReload({ ...base, filePath: '/other.yaml' })).toBe(true);
  });

  it('кэша ещё нет — перечитываем', () => {
    expect(shouldReload({ ...base, cachedPath: '' })).toBe(true);
  });

  it('mtime неизвестен — перечитываем, а не верим кэшу', () => {
    // statSync не ответил: файл могли подменить, и молчаливая выдача старого
    // конфига хуже лишнего чтения.
    expect(shouldReload({ ...base, mtimeMs: null })).toBe(true);
  });
});

describe('formatMissingConfig', () => {
  it('перечисляет все просмотренные места', () => {
    const text = formatMissingConfig(['/a.yaml', '/b.yaml']);
    expect(text).toContain('/a.yaml');
    expect(text).toContain('/b.yaml');
    expect(text).toMatch(/не найден/i);
  });
});

describe('diffConfigs', () => {
  it('одинаковые конфиги — ни одного расхождения', () => {
    const a = { debug: true, windows: [{ x: 1 }] };
    expect(diffConfigs(a, structuredClone(a))).toEqual([]);
  });

  it('расхождение в глубине называет полный путь', () => {
    const a = { windows: [{}, {}, { fancyZones: { position: 3 } }] };
    const b = { windows: [{}, {}, { fancyZones: { position: 1 } }] };
    expect(diffConfigs(a, b)).toEqual([
      { path: 'windows[2].fancyZones.position', a: 3, b: 1 },
    ]);
  });

  it('лишний элемент массива виден как отсутствующий у соседа', () => {
    const diffs = diffConfigs({ list: [1, 2] }, { list: [1] });
    expect(diffs).toEqual([{ path: 'list[1]', a: 2, b: MISSING }]);
  });

  it('ключ есть у одного и отсутствует у другого', () => {
    const diffs = diffConfigs({ a: 1 }, {});
    expect(diffs).toEqual([{ path: 'a', a: 1, b: MISSING }]);
  });

  it('отличает отсутствие ключа от значения null', () => {
    const diffs = diffConfigs({ a: null }, {});
    expect(diffs).toEqual([{ path: 'a', a: null, b: MISSING }]);
  });

  it('объект против скаляра — одно расхождение, а не обход внутрь', () => {
    const diffs = diffConfigs({ a: { b: 1 } }, { a: 5 });
    expect(diffs).toEqual([{ path: 'a', a: { b: 1 }, b: 5 }]);
  });
});

describe('describeValue', () => {
  it('отсутствие называется словом, а не undefined', () => {
    expect(describeValue(MISSING)).toBe('отсутствует');
  });

  it('строки печатаются в кавычках, числа — как есть', () => {
    expect(describeValue('Work')).toBe('"Work"');
    expect(describeValue(3)).toBe('3');
  });
});
