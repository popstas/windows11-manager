import { describe, it, expect } from 'vitest';
import { bootTimeSec, detectCrash, planRestore } from './restore-helpers.js';

const bounds = { x: 10, y: 20, width: 800, height: 600 };
const slot = (over = {}) => ({ titles: ['ccfzf'], cwd: '/p', bounds, desktop: 2, lastSeen: 500, ...over });
const state = (over = {}) => ({
  version: 1, slots: { a1: slot() }, lastLayout: ['a1'], updated: 500, ...over,
});

describe('bootTimeSec', () => {
  it('subtracts uptime from now', () => {
    expect(bootTimeSec(600, 1_000_000_000)).toBe(999_400);
  });

  it('floors fractional uptime and fractional now-in-seconds', () => {
    // uptimeSec has a fractional part (os.uptime() returns a float) and nowMs
    // does not land on a whole second — both must be floored, not just one,
    // or the result drifts by up to 2s and comparisons near a boot boundary
    // flip the wrong way.
    expect(bootTimeSec(600.9, 1_000_000_700)).toBe(999_400);
  });
});

describe('detectCrash', () => {
  it('reports a crash when the state predates the current boot', () => {
    expect(detectCrash({ state: state(), bootTimeSec: 1000, windowCount: 0 })).toBe(true);
  });

  it('reports nothing when the state was written after boot', () => {
    expect(detectCrash({ state: state({ updated: 2000 }), bootTimeSec: 1000, windowCount: 0 })).toBe(false);
  });

  it('reports nothing when the layout is empty — the user closed everything', () => {
    expect(detectCrash({ state: state({ lastLayout: [] }), bootTimeSec: 1000, windowCount: 0 })).toBe(false);
  });

  it('reports nothing when terminals are already open', () => {
    expect(detectCrash({ state: state(), bootTimeSec: 1000, windowCount: 2 })).toBe(false);
  });

  it('reports nothing for a state that was never written', () => {
    expect(detectCrash({ state: state({ updated: 0 }), bootTimeSec: 1000, windowCount: 0 })).toBe(false);
  });

  it('reports nothing when the state was written exactly at boot', () => {
    // updated === bootTimeSec is not "before" boot — pins strict `<` over `<=`.
    expect(detectCrash({ state: state({ updated: 1000 }), bootTimeSec: 1000, windowCount: 0 })).toBe(false);
  });
});

describe('planRestore', () => {
  const launch = { command: 'wt.exe', args: ['-w', '-1', '-t', 'ccfzf --session {id} --kiosk'] };

  it('turns the last layout into launch commands', () => {
    expect(planRestore({ state: state(), launch })).toEqual([{
      sessionId: 'a1',
      title: 'ccfzf',
      command: 'wt.exe',
      args: ['-w', '-1', '-t', 'ccfzf --session a1 --kiosk'],
      bounds,
      desktop: 2,
    }]);
  });

  it('skips layout entries without a slot', () => {
    expect(planRestore({ state: state({ lastLayout: ['a1', 'gone'] }), launch })).toHaveLength(1);
  });

  it('returns nothing for an empty layout', () => {
    expect(planRestore({ state: state({ lastLayout: [] }), launch })).toEqual([]);
  });

  it('replaces every {id} occurrence in an arg, not just the first', () => {
    const repeatingLaunch = { command: 'wt.exe', args: ['--session {id} --title {id}'] };
    expect(planRestore({ state: state(), launch: repeatingLaunch })[0].args).toEqual([
      '--session a1 --title a1',
    ]);
  });
});
