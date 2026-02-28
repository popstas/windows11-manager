import { describe, it, expect } from 'vitest';
import {
  findMonitorByPoint,
  findMonitorNumByName,
  sortMonitors,
} from './monitors-helpers.js';

describe('findMonitorByPoint', () => {
  const mons = [
    {},
    { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
  ];

  it('returns monitor when point is inside', () => {
    const mon = findMonitorByPoint(mons, { x: 100, y: 100 });
    expect(mon).toBe(mons[1]);
    expect(mon.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('returns second monitor for point in second monitor', () => {
    const mon = findMonitorByPoint(mons, { x: 2000, y: 500 });
    expect(mon).toBe(mons[2]);
  });

  it('returns undefined when point is outside all monitors', () => {
    const mon = findMonitorByPoint(mons, { x: 5000, y: 5000 });
    expect(mon).toBeUndefined();
  });

  it('handles point on left edge', () => {
    const mon = findMonitorByPoint(mons, { x: 0, y: 500 });
    expect(mon).toBe(mons[1]);
  });

  it('handles point on top edge', () => {
    const mon = findMonitorByPoint(mons, { x: 500, y: 0 });
    expect(mon).toBe(mons[1]);
  });

  it('excludes point on right edge (exclusive)', () => {
    const mon = findMonitorByPoint(mons, { x: 1920, y: 500 });
    expect(mon).toBe(mons[2]);
  });

  it('skips monitors without bounds', () => {
    const mon = findMonitorByPoint(mons, { x: 0, y: 0 });
    expect(mon).toBe(mons[1]);
  });
});

describe('findMonitorNumByName', () => {
  const monitorsSize = {
    1: { name: 'Monitor 1', width: 1920, height: 1080 },
    2: { name: 'Monitor 2', width: 1920, height: 1080 },
    3: { name: 'Monitor 3', width: 2560, height: 1440 },
  };

  it('returns monitor number when found', () => {
    expect(findMonitorNumByName(monitorsSize, 'Monitor 2')).toBe(2);
    expect(findMonitorNumByName(monitorsSize, 'Monitor 1')).toBe(1);
  });

  it('returns undefined when not found', () => {
    expect(findMonitorNumByName(monitorsSize, 'Unknown')).toBeUndefined();
  });
});

describe('sortMonitors', () => {
  const monitorsSize = {
    1: { name: 'Left', width: 1920, height: 1080 },
    2: { name: 'Center', width: 1920, height: 1080 },
    3: { name: 'Right', width: 1920, height: 1080 },
  };

  it('sorts by name priority when monitors have names in config', () => {
    const monitors = [
      { monitor: 'Right', 'left-coordinate': 3840, 'top-coordinate': 0 },
      { monitor: 'Left', 'left-coordinate': 0, 'top-coordinate': 0 },
      { monitor: 'Center', 'left-coordinate': 1920, 'top-coordinate': 0 },
    ];
    const result = sortMonitors(monitors, monitorsSize);
    expect(result[0].monitor).toBe('Left');
    expect(result[1].monitor).toBe('Center');
    expect(result[2].monitor).toBe('Right');
  });

  it('falls back to coordinates when names not in config', () => {
    const monitorsSizeEmpty = {};
    const monitors = [
      { monitor: 'X', 'left-coordinate': 1920, 'top-coordinate': 0 },
      { monitor: 'A', 'left-coordinate': 0, 'top-coordinate': 0 },
    ];
    const result = sortMonitors(monitors, monitorsSizeEmpty);
    expect(result[0]['left-coordinate']).toBe(0);
    expect(result[1]['left-coordinate']).toBe(1920);
  });

  it('uses y-offset threshold when vertical difference > 1000', () => {
    const monitorsSizeEmpty = {};
    const monitors = [
      { monitor: 'Bottom', 'left-coordinate': 0, 'top-coordinate': 2000 },
      { monitor: 'Top', 'left-coordinate': 0, 'top-coordinate': 0 },
    ];
    const result = sortMonitors(monitors, monitorsSizeEmpty);
    expect(result[0]['top-coordinate']).toBe(0);
    expect(result[1]['top-coordinate']).toBe(2000);
  });
});
