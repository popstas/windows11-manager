import { describe, it, expect } from 'vitest';
import { monitorNumberForBounds, buildSessionList } from './view-helpers.js';

const mons = [
  {},
  { bounds: { x: 0, y: 0, width: 1000, height: 1000 } },
  { bounds: { x: 1000, y: 0, width: 1000, height: 1000 } },
];

describe('monitorNumberForBounds', () => {
  it('picks the monitor under the centre of the window', () => {
    expect(monitorNumberForBounds(mons, { x: 100, y: 100, width: 200, height: 200 })).toBe(1);
    expect(monitorNumberForBounds(mons, { x: 1100, y: 100, width: 200, height: 200 })).toBe(2);
  });

  it('uses the centre, not the corner, for a window across the seam', () => {
    // Corner sits on monitor 1, but most of the window is on monitor 2.
    expect(monitorNumberForBounds(mons, { x: 900, y: 0, width: 400, height: 100 })).toBe(2);
  });

  it('returns null for a window left over from a disconnected display', () => {
    expect(monitorNumberForBounds(mons, { x: -3000, y: -3000, width: 100, height: 100 })).toBe(null);
  });

  it('returns null when bounds are missing', () => {
    expect(monitorNumberForBounds(mons, null)).toBe(null);
  });
});

describe('buildSessionList', () => {
  const slots = {
    a1: { titles: ['ccfzf'], cwd: '/p/ccfzf', bounds: { x: 10, y: 10, width: 100, height: 100 }, desktop: 2 },
    b2: { titles: ['gone'], cwd: '/p/gone', bounds: { x: -5000, y: 0, width: 100, height: 100 } },
  };

  it('marks open sessions and carries their window handle', () => {
    const list = buildSessionList({ slots, openMap: new Map([['a1', 777]]), mons });
    const a1 = list.find(s => s.id === 'a1');
    expect(a1.open).toBe(true);
    expect(a1.windowId).toBe(777);
    expect(a1.monitor).toBe(1);
    expect(a1.monitorBounds).toEqual(mons[1].bounds);
    expect(a1.title).toBe('ccfzf');
    expect(a1.cwd).toBe('/p/ccfzf');
    expect(a1.desktop).toBe(2);
  });

  it('marks a session with no window as closed and its desktop as unknown', () => {
    const list = buildSessionList({ slots, openMap: new Map(), mons });
    const b2 = list.find(s => s.id === 'b2');
    expect(b2.open).toBe(false);
    expect(b2.windowId).toBe(null);
    expect(b2.desktop).toBe(null);
    expect(b2.monitor).toBe(null);
    expect(b2.monitorBounds).toBe(null);
  });

  it('returns an empty list when there are no slots', () => {
    expect(buildSessionList({ slots: undefined, openMap: new Map(), mons })).toEqual([]);
  });
});
