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

  // editor-parameters.json FancyZones хранит координаты зон уже в логических
  // пикселях (том же пространстве, что и getBounds()/setBounds()), поэтому
  // при 125%/150%/200% DPI координаты и размеры зоны не делятся на scaleFactor —
  // на 100% (dpi 96) поведение не меняется, а деление на других масштабах
  // было тем самым багом.
  it('does not scale coordinates at 200% DPI (zone data is already in logical pixels)', () => {
    const zone = { X: 100, Y: 200, width: 800, height: 600 };
    const pos = calcFancyZonePos({ zone, monBounds });
    expect(pos).toEqual({ x: 100, y: 200, width: 800, height: 600 });
  });

  it('does not scale coordinates at 150% DPI (zone data is already in logical pixels)', () => {
    const zone = { X: 300, Y: 150, width: 900, height: 600 };
    const pos = calcFancyZonePos({ zone, monBounds });
    expect(pos).toEqual({ x: 300, y: 150, width: 900, height: 600 });
  });

  it('does not scale with gaps and offset regardless of DPI', () => {
    const zone = { X: 0, Y: 0, width: 1920, height: 1080 };
    const monitorGaps = { position: 'bottom', gap: 48 };
    const monitorsOffset = { left: 60, right: 60 };
    const pos = calcFancyZonePos({ zone, monBounds, monitorGaps, monitorsOffset });
    expect(pos).toEqual({ x: 60, y: 0, width: 1800, height: 1032 });
  });

  // Числа сняты с живой машины popstas-pc (2026-08-18), монитор MSI,
  // масштаб Windows 125% (dpi 120): editor-parameters.json даёт
  // work-area {x:0,y:0,width:2893,height:1728}, зона 2 раскладки
  // «1 - msi - left» — X=919 Y=0 width=1012 height=1728 (вся высота
  // рабочей области). node-window-manager getWorkArea() на этом же
  // мониторе возвращает те же 2893x1728 — то есть FancyZones уже хранит
  // логические пиксели, делить на dpi/96 не нужно.
  it('real machine numbers: monitor at 125% DPI (dpi 120), zone spans full work-area height', () => {
    const realMonBounds = { x: 0, y: 0, width: 2893, height: 1728 };
    const zone = { X: 919, Y: 0, width: 1012, height: 1728 };
    const pos = calcFancyZonePos({ zone, monBounds: realMonBounds });
    expect(pos).toEqual({ x: 919, y: 0, width: 1012, height: 1728 });
  });
});
