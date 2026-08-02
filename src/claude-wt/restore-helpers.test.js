import { describe, it, expect } from 'vitest';
import { bootTimeSec, detectCrash, planRestore, partitionPlan, resolveRestoreIds } from './restore-helpers.js';

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

  it('applies WT profile after {id} substitution', () => {
    const launch = { command: 'wt.exe', args: ['-w', '-1', 'ssh', '-t', 'ccfzf --session {id}'] };
    expect(planRestore({ state: state(), launch, profile: 'popstas' })[0].args).toEqual([
      '-w', '-1', '-p', 'popstas', 'ssh', '-t', 'ccfzf --session a1',
    ]);
  });

  it('strips baked-in -p when profile is empty', () => {
    const launch = { command: 'wt.exe', args: ['-w', '-1', '-p', 'old', 'ssh'] };
    expect(planRestore({ state: state(), launch, profile: '' })[0].args).toEqual([
      '-w', '-1', 'ssh',
    ]);
  });
});

describe('partitionPlan', () => {
  const item = id => ({ sessionId: id, title: id, command: 'wt.exe', args: [], bounds, desktop: 1 });
  const plan = [item('a1'), item('b2'), item('c3')];

  it('reports everything as missing when nothing is on screen', () => {
    const { alreadyOpen, missing } = partitionPlan(plan, new Set());
    expect(alreadyOpen).toEqual([]);
    expect(missing).toHaveLength(3);
  });

  it('separates the sessions that are still open', () => {
    // Перезапустить сессию, окно которой стоит прямо здесь, значило бы отдать
    // пользователю второе окно на тот же транскрипт.
    const { alreadyOpen, missing } = partitionPlan(plan, new Set(['b2']));
    expect(alreadyOpen.map(i => i.sessionId)).toEqual(['b2']);
    expect(missing.map(i => i.sessionId)).toEqual(['a1', 'c3']);
  });

  it('treats a missing set as nothing being open', () => {
    expect(partitionPlan(plan, undefined).missing).toHaveLength(3);
  });
});

describe('resolveRestoreIds', () => {
  const twoSlots = state({ slots: { a1: slot(), b2: slot() }, lastLayout: ['a1'] });

  it('falls back to the last layout when no ids are given', () => {
    expect(resolveRestoreIds({ state: twoSlots })).toEqual({ ids: ['a1'], unknown: [] });
  });

  it('takes the ids it was given over the last layout', () => {
    // Живой демон переписывает lastLayout каждый тик, так что сессии, умершие
    // по одной, из него выпадают, хотя слоты остаются. Явные id — дорога назад.
    expect(resolveRestoreIds({ state: twoSlots, sessionIds: ['b2'] }).ids).toEqual(['b2']);
  });

  it('reports ids it has no slot for instead of dropping them', () => {
    const out = resolveRestoreIds({ state: twoSlots, sessionIds: ['b2', 'nope'] });
    expect(out.ids).toEqual(['b2']);
    expect(out.unknown).toEqual(['nope']);
  });

  it('plans from explicit ids', () => {
    const launch = { command: 'wt.exe', args: ['--session {id}'] };
    const plan = planRestore({ state: twoSlots, launch, sessionIds: ['b2'] });
    expect(plan.map(i => i.sessionId)).toEqual(['b2']);
  });
});
