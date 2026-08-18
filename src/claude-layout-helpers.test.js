import { describe, it, expect } from 'vitest';
import { parseArrangePayload } from './claude-layout-helpers.js';

describe('parseArrangePayload', () => {
  it('разбирает объект с режимом и списком', () => {
    expect(parseArrangePayload({ mode: 'tile', ids: ['a', 'b'] }))
      .toEqual({ mode: 'tile', ids: ['a', 'b'] });
  });

  it('разбирает строку JSON с объектом', () => {
    expect(parseArrangePayload('{"mode":"cascade","ids":["a"]}'))
      .toEqual({ mode: 'cascade', ids: ['a'] });
  });

  it('разбирает json-строку с одним именем раскладки', () => {
    expect(parseArrangePayload('"tile"')).toEqual({ mode: 'tile', ids: [] });
  });

  // Так шлёт панель openHASP: у неё в теле топика голое слово.
  it('разбирает сырую строку', () => {
    expect(parseArrangePayload('cascade')).toEqual({ mode: 'cascade', ids: [] });
  });

  it('не придирается к регистру и пробелам', () => {
    expect(parseArrangePayload('  TILE  ')).toEqual({ mode: 'tile', ids: [] });
  });

  it('отсутствующий ids — это пустой список, а не отказ', () => {
    expect(parseArrangePayload({ mode: 'tile' })).toEqual({ mode: 'tile', ids: [] });
  });

  it('выбрасывает из ids не-строки и пустые строки', () => {
    expect(parseArrangePayload({ mode: 'tile', ids: ['a', '', '  b  ', 7, null] }))
      .toEqual({ mode: 'tile', ids: ['a', 'b'] });
  });

  it('ids не массив — пустой список', () => {
    expect(parseArrangePayload({ mode: 'tile', ids: 'a' })).toEqual({ mode: 'tile', ids: [] });
  });

  it('незнакомая раскладка — null', () => {
    expect(parseArrangePayload({ mode: 'mosaic' })).toBeNull();
  });

  it('пустое тело — null', () => {
    expect(parseArrangePayload('')).toBeNull();
    expect(parseArrangePayload(null)).toBeNull();
    expect(parseArrangePayload({})).toBeNull();
  });

  it('число в теле — null, а не раскладка', () => {
    expect(parseArrangePayload('5')).toBeNull();
  });
});
