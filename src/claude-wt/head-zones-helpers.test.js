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
  stackPlan,
  overlayPos,
  pickStackZone,
  freeCandidates,
  pickFreeZone,
  pickGroup,
  groupPlan,
  zonesCovered,
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
  it.each([['stack', 'stack'], ['free', 'free'], [' FREE ', 'free'], ['deck', 'deck'], ['DECK ', 'deck'], ['yolo', 'stack'], [undefined, 'stack']])(
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

describe('stackPlan', () => {
  const Z = { x: 892, y: 0, width: 838, height: 1208 };
  const own = (...ys) => ys.map((y, i) => ({ id: `c${i}`, rect: { x: 892, y, width: 838, height: 300 } }));

  it('k = 0: новый на всю зону, никто не двигается', () => {
    expect(stackPlan({ zone: Z, own: [] })).toEqual({ moves: [], pos: Z });
  });

  it('k = 1: свой на верхнюю половину, новый на нижнюю', () => {
    expect(stackPlan({ zone: Z, own: own(0) })).toEqual({
      moves: [{ id: 'c0', pos: { x: 892, y: 0, width: 838, height: 604 } }],
      pos: { x: 892, y: 604, width: 838, height: 604 },
    });
  });

  it('k = 2: свои переставлены по высоте на трети, новый третий', () => {
    // c0 стоит ниже c1 — по текущему положению c1 идёт на первое место
    const plan = stackPlan({ zone: Z, own: own(700, 10) });
    expect(plan.moves).toEqual([
      { id: 'c1', pos: { x: 892, y: 0, width: 838, height: 402 } },
      { id: 'c0', pos: { x: 892, y: 402, width: 838, height: 402 } },
    ]);
    expect(plan.pos).toEqual({ x: 892, y: 804, width: 838, height: 404 });
  });

  it('k = 3: сетка из трёх, новый на место 1 поверх, никто не двигается', () => {
    expect(stackPlan({ zone: Z, own: own(0, 402, 804) })).toEqual({ moves: [], pos: { x: 892, y: 0, width: 838, height: 402 } });
  });

  it('k = 5: место 3', () => {
    expect(stackPlan({ zone: Z, own: own(0, 402, 804, 0, 402) }).pos).toEqual({ x: 892, y: 804, width: 838, height: 404 });
  });

  it('overlayPos: место (count mod 3) + 1 сетки из трёх', () => {
    expect(overlayPos(Z, 4)).toEqual({ x: 892, y: 402, width: 838, height: 402 });
    expect(overlayPos(Z, 0)).toEqual({ x: 892, y: 0, width: 838, height: 402 });
  });
});

describe('pickStackZone', () => {
  const HZ = { 1: [3, 4], 3: [1, 4] };
  it.each([
    [{ monitor: 1, zone: 3 }, { monitor: 1, position: 4 }],
    [{ monitor: 1, zone: 4 }, { monitor: 1, position: 3 }],
    [{ monitor: 1, zone: null }, { monitor: 1, position: 4 }],
    [{ monitor: 3, zone: 2 }, { monitor: 3, position: 4 }],
  ])('head %j -> %j', (headLoc, want) => expect(pickStackZone({ headLoc, headZones: HZ })).toEqual(want));

  it('монитора нет в headZones или монитор неизвестен — null', () => {
    expect(pickStackZone({ headLoc: { monitor: 2, zone: 1 }, headZones: HZ })).toBeNull();
    expect(pickStackZone({ headLoc: { monitor: null, zone: null }, headZones: HZ })).toBeNull();
  });
});

describe('free', () => {
  const HZ = { 1: [3, 4], 2: [1, 2], 3: [1, 4] };
  const zr = (monitor, position) => ({ monitor, position, rect: { x: monitor * 1000 + position * 10, y: 0, width: 100, height: 100 } });
  const ALL = [zr(1, 3), zr(1, 4), zr(2, 1), zr(2, 2), zr(3, 1), zr(3, 4)];
  const keys = list => list.map(z => `${z.monitor}:${z.position}`);

  it('кандидаты: пара монитора head, потом остальные по возрастанию', () => {
    expect(keys(freeCandidates({ headZones: HZ, headMonitor: 3, available: ALL })))
      .toEqual(['3:1', '3:4', '1:3', '1:4', '2:1', '2:2']);
  });

  it('недоступная зона выпадает, монитор head вне headZones — просто по возрастанию', () => {
    const available = ALL.filter(z => !(z.monitor === 2 && z.position === 2));
    expect(keys(freeCandidates({ headZones: HZ, headMonitor: 5, available })))
      .toEqual(['1:3', '1:4', '2:1', '3:1', '3:4']);
  });

  const occ = entries => new Map(Object.entries(entries));
  const cands = freeCandidates({ headZones: HZ, headMonitor: 1, available: ALL });

  it('первая пустая зона — stack', () => {
    const r = pickFreeZone({ candidates: cands, occupancy: occ({ '1:3': { own: 0, foreign: 1 }, '1:4': { own: 1, foreign: 0 } }) });
    expect(r).toEqual({ zone: zr(2, 1), how: 'stack' });
  });

  it('пустых нет — зона своих с наименьшим own, при равенстве первая', () => {
    const o = {};
    for (const z of cands) o[`${z.monitor}:${z.position}`] = { own: 0, foreign: 1 };
    o['3:4'] = { own: 1, foreign: 0 };
    o['1:4'] = { own: 2, foreign: 0 };
    o['2:2'] = { own: 1, foreign: 0 };
    expect(pickFreeZone({ candidates: cands, occupancy: occ(o) })).toEqual({ zone: zr(2, 2), how: 'stack' });
  });

  it('везде чужие — overlay в зону, где окон меньше всего', () => {
    const o = {};
    for (const z of cands) o[`${z.monitor}:${z.position}`] = { own: 0, foreign: 2 };
    o['3:1'] = { own: 1, foreign: 1 };
    o['2:1'] = { own: 0, foreign: 1 };
    expect(pickFreeZone({ candidates: cands, occupancy: occ(o) })).toEqual({ zone: zr(2, 1), how: 'overlay' });
  });

  it('кандидатов нет — null', () => {
    expect(pickFreeZone({ candidates: [], occupancy: new Map() })).toBeNull();
  });
});

describe('pickGroup', () => {
  const G = [['h1', 'a', 'b'], ['h2', 'c'], ['h3', 'a']];
  it('selected в первой группе', () => expect(pickGroup({ groups: G, selected: 'b', activeId: 'c' })).toEqual(G[0]));
  it('selected важнее активного', () => expect(pickGroup({ groups: G, selected: 'h2', activeId: 'a' })).toEqual(G[1]));
  it('selected неизвестен — по активному окну', () => expect(pickGroup({ groups: G, selected: 'zz', activeId: 'c' })).toEqual(G[1]));
  it('id в двух группах — первая по порядку', () => {
    expect(pickGroup({ groups: G, selected: 'a', activeId: null })).toEqual(G[0]);
    expect(pickGroup({ groups: G, selected: null, activeId: 'a' })).toEqual(G[0]);
  });
  it('ни то ни другое — null', () => expect(pickGroup({ groups: G, selected: null, activeId: 'zz' })).toBeNull());
});

describe('groupPlan', () => {
  const FIRST = { x: -8, y: 0, width: 916, height: 1208 };
  const SECOND = { x: 892, y: 0, width: 838, height: 1208 };
  const t = i => ({ x: 892, y: i * 402, width: 838, height: i === 2 ? 404 : 402 });

  it('1 ребёнок — вся вторая зона', () => {
    expect(groupPlan({ first: FIRST, second: SECOND, n: 1 })).toEqual({ head: FIRST, children: [SECOND] });
  });
  it('3 ребёнка — трети', () => {
    expect(groupPlan({ first: FIRST, second: SECOND, n: 3 }).children).toEqual([t(0), t(1), t(2)]);
  });
  it('4 ребёнка — четвёртый на месте первого', () => {
    expect(groupPlan({ first: FIRST, second: SECOND, n: 4 }).children).toEqual([t(0), t(1), t(2), t(0)]);
  });
  it('7 детей — по кругу 1-2-3', () => {
    expect(groupPlan({ first: FIRST, second: SECOND, n: 7 }).children)
      .toEqual([t(0), t(1), t(2), t(0), t(1), t(2), t(0)]);
  });
  it('0 детей — только head', () => {
    expect(groupPlan({ first: FIRST, second: SECOND, n: 0 })).toEqual({ head: FIRST, children: [] });
  });
});

// Ревью: занятость зоны для free по одному правилу 60% пропускала
// развёрнутое окно head — оно ни в одной зоне, и половину его закрывал ребёнок.
describe('zonesCovered', () => {
  const keys = list => list.map(z => `${z.monitor}:${z.position}`);
  it('окно в зоне занимает только её, даже на перекрытии 3:1/3:4', () => {
    const rect = R31();
    expect(keys(zonesCovered(rect, locateWindow(rect, LAYOUT), LAYOUT.zones))).toEqual(['3:1']);
  });
  it('развёрнутое на мониторе окно занимает обе его зоны', () => {
    const rect = { x: -8, y: 0, width: 1738, height: 1208 };
    expect(keys(zonesCovered(rect, locateWindow(rect, LAYOUT), LAYOUT.zones))).toEqual(['1:3', '1:4']);
  });
  it('мелкое окно на стыке двух зон не занимает ничего', () => {
    // по 54% в 1:3 и 1:4 — ни в одной, и меньше трети любой из них
    const rect = { x: 800, y: 100, width: 200, height: 200 };
    expect(zonesCovered(rect, locateWindow(rect, LAYOUT), LAYOUT.zones)).toEqual([]);
  });
});

function R31() { return { x: 2036, y: 0, width: 1096, height: 1168 }; }
