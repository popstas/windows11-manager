import { describe, it, expect } from 'vitest';
import { calcFancyZonePos } from './fancyzones-helpers.js';

const monBounds = { x: 0, y: 0, width: 1920, height: 1080 };

describe('calcFancyZonePos', () => {
  it('computes basic zone placement', () => {
    const zone = { X: 100, Y: 200, width: 800, height: 600 };
    const pos = calcFancyZonePos({ zone, monBounds });
    expect(pos).toEqual({ x: 100, y: 200, width: 800, height: 600 });
  });

  it('applies monitor gaps', () => {
    const zone = { X: 0, Y: 0, width: 1920, height: 1080 };
    const monitorGaps = { position: 'bottom', gap: 48 };
    const pos = calcFancyZonePos({ zone, monBounds, monitorGaps });
    expect(pos.height).toBe(1032);
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
  });

  it('applies monitors offset', () => {
    const zone = { X: 100, Y: 100, width: 800, height: 600 };
    const monitorsOffset = { left: 10, top: 20, right: 30, bottom: 40 };
    const pos = calcFancyZonePos({ zone, monBounds, monitorsOffset });
    expect(pos.x).toBe(110);
    expect(pos.y).toBe(120);
    expect(pos.width).toBe(760);
    expect(pos.height).toBe(540);
  });

  it('combines gaps and offset', () => {
    const zone = { X: 0, Y: 0, width: 1920, height: 1080 };
    const monitorGaps = { position: 'bottom', gap: 48 };
    const monitorsOffset = { left: 60, right: 60 };
    const pos = calcFancyZonePos({ zone, monBounds, monitorGaps, monitorsOffset });
    expect(pos.x).toBe(60);
    expect(pos.width).toBe(1800);
    expect(pos.height).toBe(1032);
  });

  it('no-op when gaps and offset undefined', () => {
    const zone = { X: 50, Y: 50, width: 500, height: 400 };
    const pos = calcFancyZonePos({ zone, monBounds });
    expect(pos).toEqual({ x: 50, y: 50, width: 500, height: 400 });
  });

  it('scales coordinates at 200% DPI', () => {
    const zone = { X: 100, Y: 200, width: 800, height: 600 };
    const pos = calcFancyZonePos({ zone, monBounds, scaleFactor: 2 });
    expect(pos).toEqual({ x: 50, y: 100, width: 400, height: 300 });
  });

  it('scales coordinates at 150% DPI', () => {
    const zone = { X: 300, Y: 150, width: 900, height: 600 };
    const pos = calcFancyZonePos({ zone, monBounds, scaleFactor: 1.5 });
    expect(pos).toEqual({ x: 200, y: 100, width: 600, height: 400 });
  });

  it('no scaling when scaleFactor is 1', () => {
    const zone = { X: 100, Y: 200, width: 800, height: 600 };
    const pos = calcFancyZonePos({ zone, monBounds, scaleFactor: 1 });
    expect(pos).toEqual({ x: 100, y: 200, width: 800, height: 600 });
  });

  it('no scaling when scaleFactor is undefined', () => {
    const zone = { X: 100, Y: 200, width: 800, height: 600 };
    const pos = calcFancyZonePos({ zone, monBounds, scaleFactor: undefined });
    expect(pos).toEqual({ x: 100, y: 200, width: 800, height: 600 });
  });

  it('scales with gaps and offset at 200% DPI', () => {
    const zone = { X: 0, Y: 0, width: 1920, height: 1080 };
    const monitorGaps = { position: 'bottom', gap: 48 };
    const monitorsOffset = { left: 60, right: 60 };
    const pos = calcFancyZonePos({ zone, monBounds, monitorGaps, monitorsOffset, scaleFactor: 2 });
    expect(pos).toEqual({ x: 30, y: 0, width: 900, height: 516 });
  });
});
