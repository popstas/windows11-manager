import { describe, it, expect } from 'vitest';
import { parseHideSet, hasSignal, nextExplicit, wantedHidden, planTabs } from './taskbar-hide-helpers.js';

const U = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';

describe('parseHideSet', () => {
  it('оставляет только UUID', () => {
    expect(parseHideSet({ sessions: [U, 'x', 5, '__proto__'] })).toEqual(new Set([U]));
  });
  it('не объект — пустой набор', () => {
    expect(parseHideSet(null).size).toBe(0);
    expect(parseHideSet({ sessions: 'x' }).size).toBe(0);
  });
});

describe('hasSignal', () => {
  it('вопрос и непросмотренный итог — сигнал', () => {
    expect(hasSignal({ agentState: 'question', agentSeen: true })).toBe(true);
    expect(hasSignal({ agentState: 'review', agentSeen: false })).toBe(true);
  });
  it('просмотренный итог, idle, active, null — не сигнал', () => {
    expect(hasSignal({ agentState: 'review', agentSeen: true })).toBe(false);
    expect(hasSignal({ agentState: 'idle', agentSeen: false })).toBe(false);
    expect(hasSignal({ agentState: 'active', agentSeen: false })).toBe(false);
    expect(hasSignal({ agentState: null, agentSeen: false })).toBe(false);
  });
});

describe('nextExplicit', () => {
  it('hide на active без sawIdle — тот же', () => {
    const e = { mode: 'hide' };
    expect(nextExplicit(e, 'active')).toBe(e);
  });
  it('hide на review — sawIdle', () => {
    expect(nextExplicit({ mode: 'hide' }, 'review')).toEqual({ mode: 'hide', sawIdle: true });
  });
  it('hide с sawIdle на active — снимается', () => {
    expect(nextExplicit({ mode: 'hide', sawIdle: true }, 'active')).toBeNull();
  });
  it('show не меняется', () => {
    const e = { mode: 'show' };
    expect(nextExplicit(e, 'active')).toBe(e);
  });
});

describe('wantedHidden', () => {
  const sessions = [{ id: 10, sessionId: U }, { id: 20, sessionId: V }];
  const run = ({ set = [], explicit = {}, signal = [] }) => wantedHidden({
    sessions, set: new Set(set),
    explicitOf: s => explicit[s], signalOf: s => signal.includes(s),
  });
  it('в наборе — спрятано', () => expect(run({ set: [U] })).toEqual(new Set([10])));
  it('в наборе с сигналом — нет', () => expect(run({ set: [U], signal: [U] }).size).toBe(0));
  it('явная hide вне набора — спрятано', () => {
    expect(run({ explicit: { [V]: { mode: 'hide' } } })).toEqual(new Set([20]));
  });
  it('явная hide с сигналом — нет', () => {
    expect(run({ explicit: { [V]: { mode: 'hide' } }, signal: [V] }).size).toBe(0);
  });
  it('явная show в наборе — нет', () => {
    expect(run({ set: [U], explicit: { [U]: { mode: 'show' } } }).size).toBe(0);
  });
});

describe('planTabs', () => {
  it('закрытое окно не попадает никуда', () => {
    const r = planTabs(new Set([1]), new Set([2]), new Set([]), false);
    expect(r).toEqual({ remove: [], add: [] });
  });
  it('новое прячется, ушедшее возвращается, отсортировано', () => {
    const r = planTabs(new Set([5, 1]), new Set([9, 3, 1]), new Set([1, 3, 5, 9]), false);
    expect(r).toEqual({ remove: [3, 9], add: [5] });
  });
  it('reapply повторяет уже спрятанные', () => {
    const r = planTabs(new Set([1]), new Set([1, 2]), new Set([1, 2]), true);
    expect(r).toEqual({ remove: [1, 2], add: [] });
  });
});
