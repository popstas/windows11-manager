import { describe, it, expect } from 'vitest';
import { applyWtProfile } from './wt-profile-helpers.js';

describe('applyWtProfile', () => {
  it('inserts -p after -w <n>', () => {
    expect(applyWtProfile(['-w', '-1', 'ssh', 'host'], 'home')).toEqual([
      '-w', '-1', '-p', 'home', 'ssh', 'host',
    ]);
  });

  it('strips an existing -p before reinjecting', () => {
    expect(applyWtProfile(['-w', '-1', '-p', 'popstas', 'ssh'], 'home')).toEqual([
      '-w', '-1', '-p', 'home', 'ssh',
    ]);
  });

  it('omits -p when profile is empty', () => {
    expect(applyWtProfile(['-w', '-1', '-p', 'popstas', 'ssh'], '')).toEqual([
      '-w', '-1', 'ssh',
    ]);
    expect(applyWtProfile(['ssh'], undefined)).toEqual(['ssh']);
  });

  it('inserts at the start when there is no -w pair', () => {
    expect(applyWtProfile(['ssh', 'host'], 'home')).toEqual(['-p', 'home', 'ssh', 'host']);
  });

  it('does not mutate the input array', () => {
    const args = ['-w', '-1', 'ssh'];
    applyWtProfile(args, 'x');
    expect(args).toEqual(['-w', '-1', 'ssh']);
  });
});
