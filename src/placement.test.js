import { describe, it, expect } from 'vitest';
import { resolveMonitorRelativePos, parsePosFromRule } from './placement-helpers.js';

const monBounds = { x: 0, y: 0, width: 1920, height: 1080 };
const panelWidth = 48;
const panelHeight = 48;

describe('resolveMonitorRelativePos', () => {
  it('top', () => {
    const newPos = { width: 800, height: 600 };
    expect(resolveMonitorRelativePos({
      oper: 'top', newPos, monBounds, monNum: 1, panelWidth, panelHeight,
    })).toEqual({ field: 'y', value: 0 });
  });

  it('right', () => {
    const newPos = { width: 800, height: 600 };
    expect(resolveMonitorRelativePos({
      oper: 'right', newPos, monBounds, monNum: 1, panelWidth, panelHeight,
    })).toEqual({ field: 'x', value: 1920 - 800 - 48 });
  });

  it('bottom', () => {
    const newPos = { width: 800, height: 600 };
    expect(resolveMonitorRelativePos({
      oper: 'bottom', newPos, monBounds, monNum: 1, panelWidth, panelHeight,
    })).toEqual({ field: 'y', value: 1080 - 600 });
  });

  it('left', () => {
    const newPos = { width: 800, height: 600 };
    expect(resolveMonitorRelativePos({
      oper: 'left', newPos, monBounds, monNum: 1, panelWidth, panelHeight,
    })).toEqual({ field: 'x', value: 0 });
  });

  it('x-2/3', () => {
    const newPos = { width: 800, height: 600 };
    const third = (1920 - 48) / 3;
    expect(resolveMonitorRelativePos({
      oper: 'x-2/3', newPos, monBounds, monNum: 1, panelWidth, panelHeight,
    })).toEqual({ field: 'x', value: Math.floor(0 + third * 1) });
  });

  it('x-3/3', () => {
    const newPos = { width: 800, height: 600 };
    const third = (1920 - 48) / 3;
    expect(resolveMonitorRelativePos({
      oper: 'x-3/3', newPos, monBounds, monNum: 1, panelWidth, panelHeight,
    })).toEqual({ field: 'x', value: Math.floor(0 + third * 2) });
  });

  it('width', () => {
    const newPos = {};
    expect(resolveMonitorRelativePos({
      oper: 'width', newPos, monBounds, monNum: 1, panelWidth, panelHeight,
    })).toEqual({ field: 'width', value: 1920 });
  });

  it('halfWidth', () => {
    const newPos = {};
    expect(resolveMonitorRelativePos({
      oper: 'halfWidth', newPos, monBounds, monNum: 1, panelWidth, panelHeight,
    })).toEqual({ field: 'width', value: Math.floor((1920 - 48) / 2) });
  });

  it('thirdWidth', () => {
    const newPos = {};
    expect(resolveMonitorRelativePos({
      oper: 'thirdWidth', newPos, monBounds, monNum: 1, panelWidth, panelHeight,
    })).toEqual({ field: 'width', value: Math.floor((1920 - 48) / 3) });
  });

  it('height', () => {
    const newPos = {};
    expect(resolveMonitorRelativePos({
      oper: 'height', newPos, monBounds, monNum: 1, panelWidth, panelHeight,
    })).toEqual({ field: 'height', value: 1080 });
  });

  it('monNum 2 adjusts third for bottom', () => {
    const newPos = { width: 800, height: 600 };
    expect(resolveMonitorRelativePos({
      oper: 'bottom', newPos, monBounds, monNum: 2, panelWidth, panelHeight,
    })).toEqual({ field: 'y', value: 1080 - 600 - 48 });
  });

  it('monNum 3 adds panelWidth for left', () => {
    const newPos = { width: 800, height: 600 };
    expect(resolveMonitorRelativePos({
      oper: 'left', newPos, monBounds, monNum: 3, panelWidth, panelHeight,
    })).toEqual({ field: 'x', value: 48 });
  });

  it('monNum 3 adds panelWidth for right', () => {
    const newPos = { width: 800, height: 600 };
    expect(resolveMonitorRelativePos({
      oper: 'right', newPos, monBounds, monNum: 3, panelWidth, panelHeight,
    })).toEqual({ field: 'x', value: 0 + 1920 - 800 + 48 });
  });

  it('unknown oper returns undefined', () => {
    const newPos = {};
    expect(resolveMonitorRelativePos({
      oper: 'unknown', newPos, monBounds, monNum: 1, panelWidth, panelHeight,
    })).toBeUndefined();
  });
});

describe('parsePosFromRule', () => {
  const mons = [
    {},
    { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
  ];

  it('returns false when pos is missing', () => {
    expect(parsePosFromRule({ rule: {}, mons, panelWidth, panelHeight })).toBe(false);
  });

  it('returns fancyZones marker for delegation when pos has fancyZones', () => {
    const result = parsePosFromRule({
      rule: { fancyZones: { monitor: 1, position: 1 } },
      mons,
      panelWidth,
      panelHeight,
    });
    expect(result).toEqual({ fancyZones: { monitor: 1, position: 1 } });
  });

  it('returns false when x or y is undefined and pos has coord-like keys', () => {
    expect(parsePosFromRule({
      rule: { width: 800, height: 600 },
      mons,
      panelWidth,
      panelHeight,
    })).toBe(false);
  });

  it('parses numeric values pass-through', () => {
    const rule = { width: 800, height: 600, x: 100, y: 200 };
    expect(parsePosFromRule({ rule, mons, panelWidth, panelHeight })).toEqual({
      width: 800, height: 600, x: 100, y: 200,
    });
  });

  it('parses monitor-relative strings', () => {
    const rule = {
      width: 'mon1.halfWidth',
      height: 'mon1.height',
      x: 'mon1.left',
      y: 'mon1.top',
    };
    const result = parsePosFromRule({ rule, mons, panelWidth, panelHeight });
    expect(result.width).toBe(Math.floor((1920 - 48) / 2));
    expect(result.height).toBe(1080);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('returns false when monitor not found', () => {
    const rule = {
      width: 800,
      height: 600,
      x: 'mon99.left',
      y: 'mon1.top',
    };
    expect(parsePosFromRule({ rule, mons, panelWidth, panelHeight })).toBe(false);
  });

  it('parses x-2/3 and x-3/3', () => {
    const rule = {
      width: 600,
      height: 1080,
      x: 'mon1.x-2/3',
      y: 'mon1.top',
    };
    const result = parsePosFromRule({ rule, mons, panelWidth, panelHeight });
    const third = (1920 - 48) / 3;
    expect(result.x).toBe(Math.floor(third * 1));
    expect(result.y).toBe(0);
  });
});
