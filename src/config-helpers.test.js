import { describe, it, expect } from 'vitest';
import { parseConfigText } from './config-helpers.js';

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
