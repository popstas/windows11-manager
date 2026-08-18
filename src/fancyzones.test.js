import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { calcFancyZonePos } from './fancyzones-helpers.js';

let toPosDir;
let toPosConfig;

vi.mock('./config.js', () => ({ getConfig: () => toPosConfig }));
vi.mock('./monitors.js', () => ({
  getFancyZoneMonitor: () => ({
    monitor: 1,
    dpi: 120,
    'left-coordinate': 0,
    'top-coordinate': 0,
    'work-area-width': 2893,
    'work-area-height': 1728,
  }),
}));

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

  it('does not scale coordinates at 150% DPI (zone data is already in logical pixels)', () => {
    const zone = { X: 300, Y: 150, width: 900, height: 600 };
    const pos = calcFancyZonePos({ zone, monBounds });
    expect(pos).toEqual({ x: 300, y: 150, width: 900, height: 600 });
  });

  // Числа сняты с живой машины popstas-pc (2026-08-18), монитор MSI, 125%
  // (dpi 120): work-area 2893x1728, зона на всю её высоту.
  it('real machine numbers: monitor at 125% DPI (dpi 120), zone spans full work-area height', () => {
    const realMonBounds = { x: 0, y: 0, width: 2893, height: 1728 };
    const zone = { X: 919, Y: 0, width: 1012, height: 1728 };
    const pos = calcFancyZonePos({ zone, monBounds: realMonBounds });
    expect(pos).toEqual({ x: 919, y: 0, width: 1012, height: 1728 });
  });
});

// calcFancyZonePos() выше не принимает dpi вовсе, поэтому не может запереть
// регресс, при котором dpi/scaleFactor возвращают в fancyZonesToPos() (вызов
// calcFancyZonePos с dpi/96 из src/fancyzones.js). Этот тест гоняет полный
// путь через fancyZonesToPos() с замоканными fs/config/monitors — только он
// упадёт, если деление вернут.
describe('fancyZonesToPos', () => {
  beforeEach(() => {
    toPosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fancyzones-topos-'));
    toPosConfig = { fancyZones: { path: toPosDir }, positionsMap: [] };
  });

  afterEach(() => {
    fs.rmSync(toPosDir, { recursive: true, force: true });
  });

  // Живая машина popstas-pc (2026-08-18), монитор MSI, 125% (dpi 120):
  // work-area 2893x1728, зона 919,0,1012,1728 (вся высота рабочей области).
  it('на 125% DPI (dpi 120) не делит зону: координаты уже логические', async () => {
    const uuid = 'zone-uuid';
    fs.writeFileSync(path.join(toPosDir, 'applied-layouts.json'), JSON.stringify({
      'applied-layouts': [
        { device: { monitor: 1 }, 'applied-layout': { type: 'custom', uuid } },
      ],
    }));
    fs.writeFileSync(path.join(toPosDir, 'custom-layouts.json'), JSON.stringify({
      'custom-layouts': [
        { uuid, info: { zones: [{ X: 919, Y: 0, width: 1012, height: 1728 }] } },
      ],
    }));

    const { fancyZonesToPos } = await import('./fancyzones.js');
    const pos = fancyZonesToPos({ monitor: 1, position: 1 });
    expect(pos).toEqual({ x: 919, y: 0, width: 1012, height: 1728 });
  });
});
