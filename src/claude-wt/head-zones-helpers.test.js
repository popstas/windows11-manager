import { describe, it, expect } from 'vitest';
import {
  normalizeHeadZones,
  normalizeChildPlacement,
  zoneKey,
  NO_LOCATION,
  editorMonitorRect,
  zoneOfRect,
  slotInZone,
  monitorOfRect,
  locateWindow,
} from './head-zones-helpers.js';

// Числа с popstas-nb (проба 2026-11-12, масштаб 1 на всех мониторах).
// Зоны 1:3, 1:4 и 3:1 сняты пробой (fancyZonesToPos), 3:4 вычислена той же
// формулой, что и 3:1: правый монитор с x=1920, зона 4 — 840,0,1080x1160.
const MONITORS = [
  { monitor: 1, rect: { x: 0, y: 0, width: 1722, height: 1200 } },
  { monitor: 2, rect: { x: -1080, y: -534, width: 1080, height: 1880 } },
  { monitor: 3, rect: { x: 1920, y: 0, width: 1920, height: 1160 } },
];
const Z13 = { monitor: 1, position: 3, rect: { x: -8, y: 0, width: 916, height: 1208 } };
const Z14 = { monitor: 1, position: 4, rect: { x: 892, y: 0, width: 838, height: 1208 } };
const Z31 = { monitor: 3, position: 1, rect: { x: 2036, y: 0, width: 1096, height: 1168 } };
const Z34 = { monitor: 3, position: 4, rect: { x: 2752, y: 0, width: 1096, height: 1168 } };
const LAYOUT = { monitors: MONITORS, zones: [Z13, Z14, Z31, Z34] };

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

describe('где стоит окно', () => {
  it('head ровно в зоне 1:3', () => {
    expect(locateWindow({ x: -8, y: 0, width: 916, height: 1208 }, LAYOUT)).toEqual({ monitor: 1, zone: 3, slot: 1 });
  });

  it('57% в зоне 1:4 — не в зоне, но монитор известен', () => {
    // nda-sign с nb: 838 из 1456 ширины в 1:4
    expect(locateWindow({ x: 274, y: 402, width: 1456, height: 709 }, LAYOUT)).toEqual({ monitor: 1, zone: null, slot: null });
  });

  it('перекрытие 3:1 и 3:4 — выигрывает большее пересечение', () => {
    expect(zoneOfRect({ x: 2600, y: 0, width: 600, height: 1168 }, LAYOUT.zones).position).toBe(1);
    expect(zoneOfRect({ x: 2700, y: 0, width: 1000, height: 1168 }, LAYOUT.zones).position).toBe(4);
  });

  it('ровно в полосе перекрытия — первая зона пары', () => {
    expect(zoneOfRect({ x: 2752, y: 0, width: 380, height: 1168 }, LAYOUT.zones).position).toBe(1);
  });

  it('окно вне всех зон и мониторов — null', () => {
    expect(zoneOfRect({ x: 9000, y: 0, width: 100, height: 100 }, LAYOUT.zones)).toBeNull();
    expect(monitorOfRect({ x: 9000, y: 0, width: 100, height: 100 }, MONITORS)).toBeNull();
  });

  it('монитор — по центру окна', () => {
    // окно на стыке: левая кромка на ноутбуке, центр уже на правом мониторе
    expect(monitorOfRect({ x: 1700, y: 0, width: 600, height: 400 }, MONITORS)).toBe(3);
  });

  // Верхние кромки, которые даёт stackInCell на 1, 2 и 3 места: 0; 0 и 604; 0, 402 и 804.
  it.each([[0, 1], [604, 2], [402, 2], [804, 3], [700, 2], [704, 3]])('зона 1208: верх на %i — место %i', (y, slot) => {
    expect(slotInZone({ x: 892, y, width: 838, height: 402 }, { x: 892, y: 0, width: 838, height: 1208 })).toBe(slot);
  });

  it.each([[0, 1], [584, 2], [389, 2], [778, 3]])('зона 1168: верх на %i — место %i', (y, slot) => {
    expect(slotInZone({ x: 2036, y, width: 1096, height: 389 }, { x: 2036, y: 0, width: 1096, height: 1168 })).toBe(slot);
  });

  it('свёрнутое окно и пустая раскладка — NO_LOCATION', () => {
    expect(locateWindow({ x: -32000, y: -32000, width: 160, height: 28 }, LAYOUT)).toEqual(NO_LOCATION);
    expect(locateWindow({ x: 0, y: 0, width: 10, height: 10 }, null)).toEqual(NO_LOCATION);
    expect(locateWindow(undefined, LAYOUT)).toEqual(NO_LOCATION);
  });

  it('editorMonitorRect делит на dpi/96', () => {
    expect(editorMonitorRect({ 'left-coordinate': 0, 'top-coordinate': 0, 'work-area-width': 2893, 'work-area-height': 1728, dpi: 120 }))
      .toEqual({ x: 0, y: 0, width: 2314, height: 1382 });
    expect(editorMonitorRect({ 'left-coordinate': -1080, 'top-coordinate': -534, 'work-area-width': 1080, 'work-area-height': 1880, dpi: 96 }))
      .toEqual({ x: -1080, y: -534, width: 1080, height: 1880 });
  });
});
