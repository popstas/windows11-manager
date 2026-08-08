import { describe, it, expect } from 'vitest';
import { orderSessions, slotStatus, buildSlots, sessionIdForSlot } from './session-slots.js';

const s = (over) => ({
  id: 'x', title: 't', cwd: '/p', bounds: { x: 0, y: 0, width: 10, height: 10 },
  desktop: 1, monitor: 1, open: true, lastActivity: 100, ...over,
});

describe('session-slots', () => {
  it('buildSlots carries what the agent last said, and leaves it blank for an empty slot', () => {
    const [filled, empty] = buildSlots([s({ agentSummary: 'Оба сделано.' })], 2);
    expect(filled.summary).toBe('Оба сделано.');
    expect(empty.summary).toBe('');
  });

  it('buildSlots carries the ready-made description, not its own glue', () => {
    // Склейку «сводка, а у работающей — последняя» считает windows11-manager:
    // здесь она только переезжает в слот, чтобы пикер и панель не разошлись.
    const [filled, empty] = buildSlots([s({
      agentSummary: '', agentLastSummary: 'Готовлю бриф', agentDescription: 'Готовлю бриф',
    })], 2);
    expect(filled.description).toBe('Готовлю бриф');
    expect(empty.description).toBe('');
  });

  it('orderSessions puts live sessions first', () => {
    const out = orderSessions([
      s({ id: 'closed', open: false, lastActivity: 999 }),
      s({ id: 'live-d2', desktop: 2 }),
      s({ id: 'live-d1', desktop: 1 }),
    ], 'name');
    expect(out.map(x => x.id)).toEqual(['live-d1', 'live-d2', 'closed']);
  });

  it('orderSessions sorts live sessions by the picker sort mode', () => {
    const out = orderSessions([
      s({ id: 'old', lastActivity: 100 }),
      s({ id: 'fresh', lastActivity: 900 }),
    ], 'recent');
    expect(out.map(x => x.id)).toEqual(['fresh', 'old']);
  });

  it('orderSessions sorts closed sessions by the same sort mode', () => {
    const out = orderSessions([
      s({ id: 'old', open: false, lastActivity: 100 }),
      s({ id: 'recent', open: false, lastActivity: 900 }),
    ], 'recent');
    expect(out.map(x => x.id)).toEqual(['recent', 'old']);
  });

  it('orderSessions defaults to cost like the picker', () => {
    const out = orderSessions([
      s({ id: 'cheap', agentCostUsd: 1 }),
      s({ id: 'pricey', agentCostUsd: 40 }),
    ]);
    expect(out.map(x => x.id)).toEqual(['pricey', 'cheap']);
  });

  it('slotStatus reports what the agent is doing', () => {
    expect(slotStatus(s({ agentState: 'active' }))).toBe('active');
    expect(slotStatus(s({ agentState: 'question' }))).toBe('question');
  });

  it('slotStatus treats both "stopped" shapes as needing review', () => {
    // stop and fail write review; the "waiting for your input" notice says the
    // same thing a minute later and the hook records it as idle.
    expect(slotStatus(s({ agentState: 'review', agentEvent: 'stop' }))).toBe('review');
    expect(slotStatus(s({ agentState: 'idle', agentEvent: 'attention' }))).toBe('review');
  });

  it('slotStatus clears review once the window has been looked at', () => {
    expect(
      slotStatus(s({ agentState: 'review', agentEvent: 'stop', agentSeen: true }))).toBe('idle');
    expect(
      slotStatus(s({ agentState: 'idle', agentEvent: 'attention', agentSeen: true }))).toBe('idle');
  });

  it('slotStatus lets being seen mute a pending question', () => {
    // The agent is still blocked, but a tile that keeps calling after you have
    // already been to the session stops meaning anything.
    expect(
      slotStatus(s({ agentState: 'question', agentEvent: 'attention', agentSeen: true }))).toBe('idle');
  });

  it('slotStatus keeps an unseen question calling', () => {
    expect(
      slotStatus(s({ agentState: 'question', agentEvent: 'attention', agentSeen: false }))).toBe('question');
  });

  it('slotStatus marks a closed session closed whatever state lingers', () => {
    expect(slotStatus(s({ open: false, agentState: 'active' }))).toBe('closed');
  });

  it('slotStatus calls a missing session empty', () => {
    expect(slotStatus(undefined)).toBe('empty');
  });

  it('buildSlots always returns the requested number of rows', () => {
    // The panel draws a fixed number of lines; a short list must not leave the
    // last rows showing whatever was there before.
    const slots = buildSlots([s({ id: 'a' })], 9);
    expect(slots.length).toBe(9);
    expect(slots[0].id).toBe('a');
    expect(slots[8].status).toBe('empty');
    expect(slots[8].title).toBe('');
  });

  it('buildSlots numbers slots from one', () => {
    const slots = buildSlots([], 3);
    expect(slots.map(x => x.slot)).toEqual([1, 2, 3]);
  });

  it('buildSlots drops sessions that do not fit', () => {
    const many = Array.from({ length: 20 }, (_, i) => s({ id: `s${i}`, bounds: { x: i, y: 0, width: 1, height: 1 } }));
    expect(buildSlots(many, 9).length).toBe(9);
  });

  it('buildSlots prefers the disambiguated label over the raw title', () => {
    const slots = buildSlots([s({ id: 'a', title: 'agent', label: 'agent (aaaa)' })], 1);
    expect(slots[0].title).toBe('agent (aaaa)');
  });

  it('sessionIdForSlot maps a panel row back to its session', () => {
    const slots = buildSlots([s({ id: 'a' }), s({ id: 'b', bounds: { x: 5, y: 0, width: 1, height: 1 } })], 9);
    expect(sessionIdForSlot(slots, 1)).toBe('a');
    expect(sessionIdForSlot(slots, '2')).toBe('b');
  });

  it('sessionIdForSlot returns null for an empty or unknown row', () => {
    // Tapping a blank row must do nothing rather than focus whatever was last there.
    const slots = buildSlots([s({ id: 'a' })], 9);
    expect(sessionIdForSlot(slots, 5)).toBe(null);
    expect(sessionIdForSlot(slots, 99)).toBe(null);
    expect(sessionIdForSlot(slots, 'nope')).toBe(null);
  });
});
