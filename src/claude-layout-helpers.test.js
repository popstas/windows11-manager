import { describe, it, expect } from 'vitest';
import { parseArrangePayload, pickFocusTarget, splitCounts, stackInCell, tileByZones, columns, tileGrid, cascade, arrange, toWindowSpace } from './claude-layout-helpers.js';

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

describe('columns', () => {
  // 80 колонок × 10 px + 32 = 832 наименьшая, 120 × 10 + 32 = 1232 наибольшая.
  it('три — идеал на широком экране', () => {
    expect(columns(3440)).toBe(3);
  });

  it('узкий экран режет до двух: терминал не должен стать уже 80 знаков', () => {
    expect(columns(1920)).toBe(2);
  });

  it('на 4K колонок четыре: три дали бы шире 120 знаков', () => {
    expect(columns(3840)).toBe(4);
  });

  it('совсем узкий экран — одна колонка, не ноль', () => {
    expect(columns(800)).toBe(1);
  });
});

describe('tileGrid', () => {
  const WORK = { x: 0, y: 0, width: 1920, height: 1040 };

  // Растянутое на весь экран окно было бы вдвое шире тех 120 знаков, ради
  // которых колонки и считаются.
  it('единственное окно занимает колонку, а не экран', () => {
    expect(tileGrid(WORK, 1)).toEqual([{ x: 0, y: 0, width: 960, height: 1040 }]);
  });

  // Ровно тот случай из README мака: «три окна на узком экране встают как одно
  // во всю высоту слева и два по половине справа».
  it('три окна на двухколоночном экране: слева одно, справа два', () => {
    expect(tileGrid(WORK, 3)).toEqual([
      { x: 0, y: 0, width: 960, height: 1040 },
      { x: 960, y: 0, width: 960, height: 520 },
      { x: 960, y: 520, width: 960, height: 520 },
    ]);
  });

  it('на широком экране три колонки', () => {
    const out = tileGrid({ x: 0, y: 0, width: 3440, height: 1400 }, 3);
    expect(out.map((b) => b.x)).toEqual([0, 1146, 2292]);
    expect(out.every((b) => b.width === 1146)).toBe(true);
  });

  it('нулевая рабочая область — пусто', () => {
    expect(tileGrid({ x: 0, y: 0, width: 0, height: 0 }, 3)).toEqual([]);
  });
});

describe('cascade', () => {
  const WORK = { x: 0, y: 0, width: 1920, height: 1040 };

  // Двум окнам ступенька нужна одна, и отдавать им столько же места, сколько
  // десяти, значит впустую резать высоту.
  it('двум окнам — одна ступенька', () => {
    expect(cascade(WORK, 2)).toEqual([
      { x: 0, y: 0, width: 960, height: 990 },
      { x: 50, y: 50, width: 960, height: 990 },
    ]);
  });

  it('переполненная стопка начинается заново от левого верхнего угла', () => {
    const out = cascade(WORK, 12);
    expect(out[0]).toEqual({ x: 0, y: 0, width: 960, height: 540 });
    expect(out[10]).toEqual({ x: 500, y: 500, width: 960, height: 540 });
    expect(out[11]).toEqual({ x: 0, y: 0, width: 960, height: 540 });
  });

  it('окно не уезжает за края рабочей области', () => {
    for (const b of cascade(WORK, 12)) {
      expect(b.x + b.width).toBeLessThanOrEqual(WORK.width);
      expect(b.y + b.height).toBeLessThanOrEqual(WORK.height);
    }
  });
});

describe('toWindowSpace', () => {
  // Числа с живой машины popstas-pc: монитор MSI, getScaleFactor() === 1.25,
  // Monitor.getWorkArea() отдаёт 2893x1728, а окна на нём живут в 2314x1382.
  it('делит рабочую область на масштаб монитора', () => {
    expect(toWindowSpace({ x: 0, y: 0, width: 2893, height: 1728 }, 1.25))
      .toEqual({ x: 0, y: 0, width: 2314, height: 1382 });
  });

  it('масштаб 1 — прямоугольник без изменений', () => {
    const rect = { x: 10, y: 20, width: 1920, height: 1080 };
    expect(toWindowSpace(rect, 1)).toBe(rect);
  });

  it('ненулевой origin делится вместе с размером', () => {
    expect(toWindowSpace({ x: 3840, y: 0, width: 1920, height: 1080 }, 1.25))
      .toEqual({ x: 3072, y: 0, width: 1536, height: 864 });
  });

  it('пустой прямоугольник или масштаб — вернуть как есть', () => {
    expect(toWindowSpace(null, 1.25)).toBeNull();
    expect(toWindowSpace({ x: 0, y: 0, width: 100, height: 100 }, 0)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe('arrange', () => {
  const WORK = { x: 0, y: 0, width: 1920, height: 1040 };
  const ZONES = [{ x: 0, y: 0, width: 960, height: 1040 }];

  it('плитка идёт по зонам, когда они есть', () => {
    expect(arrange({ mode: 'tile', zones: ZONES, work: WORK, n: 1 }))
      .toEqual([{ x: 0, y: 0, width: 960, height: 1040 }]);
  });

  it('без зон плитка считается своей сеткой', () => {
    expect(arrange({ mode: 'tile', zones: [], work: WORK, n: 1 }))
      .toEqual([{ x: 0, y: 0, width: 960, height: 1040 }]);
  });

  // Каскад считает от рабочей области, а не от зон, — даже когда зоны заданы.
  it('каскад зон не касается', () => {
    expect(arrange({ mode: 'cascade', zones: ZONES, work: WORK, n: 1 }))
      .toEqual([{ x: 0, y: 0, width: 960, height: 1040 }]);
  });

  it('ноль окон или нет рабочей области — пусто', () => {
    expect(arrange({ mode: 'tile', zones: [], work: WORK, n: 0 })).toEqual([]);
    expect(arrange({ mode: 'cascade', zones: [], work: null, n: 3 })).toEqual([]);
  });
});

describe('pickFocusTarget', () => {
  it('бывшее переднее окно, если оно раскладывается', () => {
    expect(pickFocusTarget([11, 22, 33], 22)).toBe(22);
  });

  it('переднее окно со стороны в счёт не идёт — фокус первому', () => {
    expect(pickFocusTarget([11, 22, 33], 99)).toBe(11);
  });

  it('переднего окна нет — фокус первому', () => {
    expect(pickFocusTarget([11, 22], 0)).toBe(11);
  });

  it('окон нет — фокусировать нечего', () => {
    expect(pickFocusTarget([], 22)).toBeNull();
    expect(pickFocusTarget()).toBeNull();
  });
});
