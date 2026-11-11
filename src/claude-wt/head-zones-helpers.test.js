import { describe, it, expect } from 'vitest';
import {
  normalizeHeadZones,
  normalizeChildPlacement,
  zoneKey,
} from './head-zones-helpers.js';

describe('normalizeHeadZones', () => {
  it('пара целых на целый ключ проходит, ключи — строки', () => {
    expect(normalizeHeadZones({ 1: [3, 4], 2: [1, 2], 3: [1, 4] }))
      .toEqual({ zones: { 1: [3, 4], 2: [1, 2], 3: [1, 4] }, problems: [] });
  });

  it('мусорная запись отбрасывается с причиной, соседние живут', () => {
    const r = normalizeHeadZones({ 1: [3, 4], x: [1, 2], 2: [1], 3: [2, 2], 4: ['1', 2] });
    expect(r.zones).toEqual({ 1: [3, 4] });
    expect(r.problems).toHaveLength(4);
    expect(r.problems.every(p => p.startsWith('claudeWt.headZones.'))).toBe(true);
  });

  it('не объект — пусто без причин', () => {
    expect(normalizeHeadZones(undefined)).toEqual({ zones: {}, problems: [] });
    expect(normalizeHeadZones(null)).toEqual({ zones: {}, problems: [] });
  });

  it('массив вместо карты — пусто с причиной', () => {
    const r = normalizeHeadZones([[3, 4]]);
    expect(r.zones).toEqual({});
    expect(r.problems).toHaveLength(1);
  });
});

describe('normalizeChildPlacement', () => {
  it.each([['stack', 'stack'], ['free', 'free'], [' FREE ', 'free'], ['yolo', 'stack'], [undefined, 'stack']])(
    'childPlacement %s -> %s', (raw, want) => expect(normalizeChildPlacement(raw)).toBe(want));
});

describe('zoneKey', () => {
  it('монитор:зона', () => expect(zoneKey(1, 4)).toBe('1:4'));
});
