import { describe, it, expect } from 'vitest';
import { startTiming, noTiming } from './timing.js';

function fakeClock(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe('startTiming', () => {
  it('пишет шаг и итог от начала просьбы', () => {
    const lines = [];
    const mark = startTiming('open foo', {
      now: fakeClock([1000, 1300, 2500]),
      log: (m) => lines.push(m),
    });
    mark('sessions');
    mark('spawn');
    expect(lines).toEqual([
      '[claude-wt] timing open foo: sessions +300ms (300ms)',
      '[claude-wt] timing open foo: spawn +1200ms (1500ms)',
    ]);
  });

  it('возвращает время от начала просьбы', () => {
    const mark = startTiming('open bar', { now: fakeClock([10, 40]), log: () => {} });
    expect(mark('spawn')).toBe(30);
  });
});

describe('noTiming', () => {
  it('молчит и отдаёт ноль', () => {
    expect(noTiming('spawn')).toBe(0);
  });
});
