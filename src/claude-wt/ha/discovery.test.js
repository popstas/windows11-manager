import { describe, it, expect } from 'vitest';
import {
  topics, slotConfig, summaryConfig, discoveryMessages, stateMessages, removalMessages,
} from './discovery.js';

const BASE = 'home/room/pc';

describe('discovery', () => {
  it('every entity points at the same device, so Home Assistant groups them', () => {
    // This is the whole reason for moving off the REST API: /api/states writes
    // past the registry, and entities without a registry entry cannot belong to
    // a device.
    const slot = slotConfig(BASE, 1);
    const summary = summaryConfig(BASE);
    expect(slot.device.identifiers).toEqual(['claude_wt']);
    expect(summary.device.identifiers).toEqual(['claude_wt']);
    expect(slot.device.name).toBe('claude-wt');
  });

  it('a slot keeps its entity_id across a change of transport', () => {
    // The panel buttons name these entities; renaming them because the plumbing
    // changed would break the panel for no reason.
    expect(slotConfig(BASE, 3).object_id).toBe('claude_session_3');
    expect(summaryConfig(BASE).object_id).toBe('claude_sessions');
  });

  it('a slot has a unique id, which is what makes it renameable in the UI', () => {
    expect(slotConfig(BASE, 3).unique_id).toBe('claude_wt_slot_3');
    expect(slotConfig(BASE, 3).unique_id).not.toBe(slotConfig(BASE, 4).unique_id);
  });

  it('state and attributes ride the same topic', () => {
    // Two topics per slot would mean two publishes and a window where the flag
    // and the details disagree.
    const c = slotConfig(BASE, 2);
    expect(c.state_topic).toBe(`${BASE}/claude/slot/2`);
    expect(c.json_attributes_topic).toBe(c.state_topic);
    expect(c.value_template).toBe('{{ value_json.state }}');
  });

  it('a slot is switchable, and pressing it reaches us', () => {
    const c = slotConfig(BASE, 2);
    expect(c.command_topic).toBe(`${BASE}/claude/slot/2/set`);
    // Home Assistant must not assume it knows the outcome: what the switch shows
    // is decided by what happens in the window, not by the press.
    expect(c.optimistic).toBe(false);
    expect(c.assumed_state).toBe(true);
  });

  it('every entity is tied to one availability topic', () => {
    // With windows-mqtt down, no slot number means anything; unavailable is
    // honest, a frozen last state is not.
    const t = topics(BASE);
    expect(slotConfig(BASE, 1).availability_topic).toBe(t.availability);
    expect(summaryConfig(BASE).availability_topic).toBe(t.availability);
  });

  it('discoveryMessages announces availability and one config per entity, all retained', () => {
    const msgs = discoveryMessages(BASE, 9);
    expect(msgs.length).toBe(1 + 1 + 9);
    expect(msgs.every(m => m.retain)).toBeTruthy();
    expect(msgs[0].payload).toBe('online');
    expect(msgs.some(m => m.topic === 'homeassistant/switch/claude_wt/slot_9/config')).toBeTruthy();
    expect(msgs.some(m => m.topic === 'homeassistant/sensor/claude_wt/summary/config')).toBeTruthy();
  });

  it('stateMessages routes each entity to its own topic', () => {
    const msgs = stateMessages(BASE, [
      { state: 4, attributes: { total: 5 } },
      { state: 'on', attributes: { slot: 1, text: '? one' } },
      { state: 'off', attributes: { slot: 2, text: 'two' } },
    ]);
    expect(msgs.map(m => m.topic)).toEqual([
      `${BASE}/claude/summary`,
      `${BASE}/claude/slot/1`,
      `${BASE}/claude/slot/2`,
    ]);
  });

  it('a state payload carries the flag and the details together', () => {
    const [msg] = stateMessages(BASE, [{ state: 'on', attributes: { slot: 1, text: '? one', cwd: '/p' } }]);
    expect(JSON.parse(msg.payload)).toEqual({ state: 'on', slot: 1, text: '? one', cwd: '/p' });
    expect(msg.retain).toBe(true);
  });

  it('a numeric state survives the trip as a string', () => {
    // The summary state is a count; the value_template reads it out of JSON, so
    // it must be there in a shape Home Assistant can parse.
    const [msg] = stateMessages(BASE, [{ state: 4, attributes: {} }]);
    expect(JSON.parse(msg.payload).state).toBe('4');
  });

  it('removalMessages empties both the config and the state of a dropped slot', () => {
    // An empty retained config is how Home Assistant is told to forget an
    // entity; without it, shrinking the slot count leaves ghosts forever.
    const msgs = removalMessages(BASE, 10, 11);
    expect(msgs.map(m => m.topic)).toEqual([
      'homeassistant/switch/claude_wt/slot_10/config',
      `${BASE}/claude/slot/10`,
      'homeassistant/switch/claude_wt/slot_11/config',
      `${BASE}/claude/slot/11`,
    ]);
    expect(msgs.every(m => m.payload === '' && m.retain)).toBeTruthy();
  });
});
