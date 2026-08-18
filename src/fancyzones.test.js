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

// calcFancyZonePos() выше вызывается напрямую с явным scaleFactor и не может
// запереть регресс на уровне fancyZonesToPos() — там scaleFactor считается из
// monitor.dpi и может снова потеряться при рефакторинге. Этот тест гоняет
// полный путь через fancyZonesToPos() с замоканными fs/config/monitors и
// реальными числами живой машины: зона на всю высоту рабочей области монитора
// со 125% (dpi 120) должна выйти МЕНЬШЕ рабочей области — ровно в 1.25 раза,
// потому что зона задана в физических пикселях монитора, а окна двигаются в
// логических. Возврат деления на dpi/96 в calcFancyZonePos/fancyZonesToPos —
// это и был откат ошибки d5f95b6/4b8156b, подтверждённый живой проверкой:
// без деления окна на этом мониторе становились крупнее зоны.
describe('fancyZonesToPos', () => {
  beforeEach(() => {
    toPosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fancyzones-topos-'));
    toPosConfig = { fancyZones: { path: toPosDir }, positionsMap: [] };
  });

  afterEach(() => {
    fs.rmSync(toPosDir, { recursive: true, force: true });
  });

  // Живая машина popstas-pc (2026-08-18), монитор MSI, 125% (dpi 120):
  // work-area 2893x1728 (физические), зона 919,0,1012,1728 (вся высота
  // рабочей области, тоже физические). Деление на scaleFactor=1.25 даёт
  // логические координаты, в которых живут окна: 735,0,810,1382.
  it('на 125% DPI (dpi 120) делит зону на scaleFactor: физические пиксели зоны -> логические окна', async () => {
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
    expect(pos).toEqual({ x: 735, y: 0, width: 810, height: 1382 });
  });
});
