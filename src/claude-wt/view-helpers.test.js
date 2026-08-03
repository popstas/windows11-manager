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
    expect(a1.focusedAt).toBe(0);
  });

  it('carries focusedAt from the slot', () => {
    const withFocus = {
      ...slots,
      a1: { ...slots.a1, focusedAt: 1700000000 },
    };
    const list = buildSessionList({ slots: withFocus, openMap: new Map([['a1', 777]]), mons });
    expect(list.find(s => s.id === 'a1').focusedAt).toBe(1700000000);
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

  it('carries money and context through from the hook record', () => {
    const progress = { a1: { state: 'active', updated: 5, costUsd: 12, contextPct: 47 } };
    const list = buildSessionList({ slots, openMap: new Map([['a1', 777]]), mons, progress });
    const a1 = list.find(s => s.id === 'a1');
    expect(a1.agentCostUsd).toBe(12);
    expect(a1.agentContextPct).toBe(47);
    // Сессия без перехватчика статуслайна: ноль, а не undefined — читателю
    // ниже по цепочке отличать «не знаем» приходится по нему.
    const b2 = list.find(s => s.id === 'b2');
    expect(b2.agentCostUsd).toBe(0);
    expect(b2.agentContextPct).toBe(0);
  });

  it('carries the last user prompt through from the hook record', () => {
    const progress = {
      a1: { state: 'review', updated: 5, prompt: 'добавь тесты', summary: 'Готово.' },
    };
    const list = buildSessionList({ slots, openMap: new Map([['a1', 777]]), mons, progress });
    const a1 = list.find(s => s.id === 'a1');
    expect(a1.agentPrompt).toBe('добавь тесты');
    expect(a1.agentSummary).toBe('Готово.');
    expect(list.find(s => s.id === 'b2').agentPrompt).toBe('');
  });

  it('describes a session by its summary, and by the last one while it works', () => {
    const progress = {
      a1: { state: 'review', updated: 5, summary: 'Готово.', lastSummary: 'Чинил тесты' },
      b2: { state: 'active', updated: 5, summary: '', lastSummary: 'Готовлю бриф' },
    };
    const list = buildSessionList({ slots, openMap: new Map([['a1', 777]]), mons, progress });
    expect(list.find(s => s.id === 'a1').agentDescription).toBe('Готово.');
    expect(list.find(s => s.id === 'b2').agentDescription).toBe('Готовлю бриф');
  });

  it('leaves the description empty when the hook has not fired', () => {
    const list = buildSessionList({ slots, openMap: new Map(), mons });
    expect(list.find(s => s.id === 'a1').agentDescription).toBe('');
  });

  it('carries session start time from meta', () => {
    const meta = { a1: { started: 1785613874 } };
    const list = buildSessionList({ slots, openMap: new Map([['a1', 777]]), mons, meta });
    expect(list.find(s => s.id === 'a1').agentStarted).toBe(1785613874);
    expect(list.find(s => s.id === 'b2').agentStarted).toBe(0);
  });

  it('returns an empty list when there are no slots', () => {
    expect(buildSessionList({ slots: undefined, openMap: new Map(), mons })).toEqual([]);
  });
});
