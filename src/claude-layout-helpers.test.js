import { describe, it, expect } from 'vitest';
import { parseArrangePayload, splitCounts, stackInCell, tileByZones } from './claude-layout-helpers.js';

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

describe('splitCounts', () => {
  it('окон меньше, чем ячеек — по одному в первые', () => {
    expect(splitCounts(1, 4)).toEqual([1, 0, 0, 0]);
    expect(splitCounts(3, 4)).toEqual([1, 1, 1, 0]);
  });

  it('поровну', () => {
    expect(splitCounts(4, 4)).toEqual([1, 1, 1, 1]);
  });

  // Добор с конца: первое окно списка — самое верхнее в пикере, и ячейка ему
  // достаётся целиком.
  it('лишние окна достаются последним ячейкам', () => {
    expect(splitCounts(6, 4)).toEqual([1, 1, 2, 2]);
    expect(splitCounts(9, 4)).toEqual([2, 2, 2, 3]);
  });
});

describe('stackInCell', () => {
  const CELL = { x: 100, y: 0, width: 500, height: 1000 };

  it('одно окно занимает ячейку целиком', () => {
    expect(stackInCell(CELL, 1)).toEqual([{ x: 100, y: 0, width: 500, height: 1000 }]);
  });

  it('двое делят высоту пополам', () => {
    expect(stackInCell(CELL, 2)).toEqual([
      { x: 100, y: 0, width: 500, height: 500 },
      { x: 100, y: 500, width: 500, height: 500 },
    ]);
  });

  // Без остатка между нижним окном и краем ячейки оставалась бы щель.
  it('нижнему достаётся остаток от деления', () => {
    const out = stackInCell(CELL, 3);
    expect(out.map((b) => b.height)).toEqual([333, 333, 334]);
    expect(out[2].y + out[2].height).toBe(1000);
  });
});

describe('tileByZones', () => {
  const ZONES = [
    { x: 0, y: 0, width: 500, height: 1000 },
    { x: 500, y: 0, width: 500, height: 1000 },
    { x: 1000, y: 0, width: 500, height: 1000 },
    { x: 1500, y: 0, width: 500, height: 1000 },
  ];

  it('одно окно встаёт в первую зону целиком', () => {
    expect(tileByZones(ZONES, 1)).toEqual([{ x: 0, y: 0, width: 500, height: 1000 }]);
  });

  it('по окну на зону', () => {
    expect(tileByZones(ZONES, 4).map((b) => b.x)).toEqual([0, 500, 1000, 1500]);
  });

  it('шесть окон на четыре зоны: две последние делятся пополам', () => {
    expect(tileByZones(ZONES, 6)).toEqual([
      { x: 0, y: 0, width: 500, height: 1000 },
      { x: 500, y: 0, width: 500, height: 1000 },
      { x: 1000, y: 0, width: 500, height: 500 },
      { x: 1000, y: 500, width: 500, height: 500 },
      { x: 1500, y: 0, width: 500, height: 500 },
      { x: 1500, y: 500, width: 500, height: 500 },
    ]);
  });

  it('ноль окон и ноль зон — пусто', () => {
    expect(tileByZones(ZONES, 0)).toEqual([]);
    expect(tileByZones([], 3)).toEqual([]);
  });
});
