import { describe, it, expect } from 'vitest';
import { createBellQuietWriter } from './bell-quiet.js';

function setup() {
  const world = { t: 1_000_000, files: new Map(), fail: false };
  const writer = createBellQuietWriter({
    file: 'Q', heartbeatMs: 60_000, now: () => world.t,
    write: (f, text) => { if (world.fail) throw new Error('disk'); world.files.set(f, text); },
    remove: f => world.files.delete(f),
    log: () => {},
  });
  return { world, writer };
}

describe('createBellQuietWriter', () => {
  it('пишет заголовок тихих со временем и ключи', () => {
    const { world, writer } = setup();
    writer.update(['a', 'b']);
    expect(world.files.get('Q')).toBe('# wezterm-bell-quiet 1000\na\nb\n');
  });

  it('тот же список — не чаще сердцебиения, новый — сразу', () => {
    const { world, writer } = setup();
    writer.update(['a']);
    world.files.clear();
    world.t += 30_000;
    writer.update(['a']);
    expect(world.files.size).toBe(0);
    writer.update(['b']);
    expect(world.files.get('Q')).toBe('# wezterm-bell-quiet 1030\nb\n');
    world.files.clear();
    world.t += 60_000;
    writer.update(['b']);
    expect(world.files.get('Q')).toBe('# wezterm-bell-quiet 1090\nb\n');
  });

  it('drop() убирает файл, следующий update пишет заново', () => {
    const { world, writer } = setup();
    writer.update(['a']);
    writer.drop();
    expect(world.files.has('Q')).toBe(false);
    writer.update(['a']);
    expect(world.files.get('Q')).toBe('# wezterm-bell-quiet 1000\na\n');
  });

  it('сбой записи не бросает и повторяется на следующем update', () => {
    const { world, writer } = setup();
    world.fail = true;
    expect(() => writer.update(['a'])).not.toThrow();
    world.fail = false;
    writer.update(['a']);
    expect(world.files.get('Q')).toBe('# wezterm-bell-quiet 1000\na\n');
  });
});
