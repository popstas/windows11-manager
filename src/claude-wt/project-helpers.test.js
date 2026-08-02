import { describe, it, expect } from 'vitest';
import {
  basenameOfCwd,
  pickOpenProjectSession,
  escapeForSingleQuoted,
  planLaunchNew,
  normalizeProjects,
  profileForCwd,
} from './project-helpers.js';

describe('basenameOfCwd', () => {
  it('returns the last path segment', () => {
    expect(basenameOfCwd('/home/popstas/projects/text/obsidian/ExpertizeMe')).toBe('ExpertizeMe');
    expect(basenameOfCwd('/p/home/')).toBe('home');
  });

  it('returns empty for missing paths', () => {
    expect(basenameOfCwd('')).toBe('');
    expect(basenameOfCwd('/')).toBe('');
  });
});

function s(over) {
  return {
    id: 'x',
    open: true,
    cwd: '/p/home',
    focusedAt: 0,
    lastActivity: 0,
    windowId: 1,
    ...over,
  };
}

describe('pickOpenProjectSession', () => {
  it('returns null when cwd is empty or there are no open matches', () => {
    expect(pickOpenProjectSession([s()], '')).toBe(null);
    expect(pickOpenProjectSession([s({ open: false })], '/p/home')).toBe(null);
    expect(pickOpenProjectSession([s({ cwd: '/other' })], '/p/home')).toBe(null);
    expect(pickOpenProjectSession([], '/p/home')).toBe(null);
  });

  it('picks the open session with the highest focusedAt', () => {
    const a = s({ id: 'a', focusedAt: 10, lastActivity: 100, windowId: 11 });
    const b = s({ id: 'b', focusedAt: 50, lastActivity: 1, windowId: 22 });
    expect(pickOpenProjectSession([a, b], '/p/home').id).toBe('b');
  });

  it('breaks focusedAt ties with lastActivity', () => {
    const a = s({ id: 'a', focusedAt: 10, lastActivity: 5 });
    const b = s({ id: 'b', focusedAt: 10, lastActivity: 9 });
    expect(pickOpenProjectSession([a, b], '/p/home').id).toBe('b');
  });

  it('ignores closed sessions even with a higher focusedAt', () => {
    const closed = s({ id: 'old', open: false, focusedAt: 99, lastActivity: 99 });
    const open = s({ id: 'live', focusedAt: 1, lastActivity: 1 });
    expect(pickOpenProjectSession([closed, open], '/p/home').id).toBe('live');
  });
});

describe('escapeForSingleQuoted', () => {
  it('leaves plain paths alone', () => {
    expect(escapeForSingleQuoted('/home/popstas/p')).toBe('/home/popstas/p');
  });

  it('escapes single quotes for bash single-quoted strings', () => {
    expect(escapeForSingleQuoted("it's")).toBe("it'\\''s");
  });
});

describe('planLaunchNew', () => {
  const launchNew = {
    command: 'wt.exe',
    args: ['ssh', '-t', "cd '{cwd}' && exec claude -n '{name}'"],
  };

  it('substitutes cwd and name into every arg', () => {
    expect(planLaunchNew({ launchNew, cwd: '/p/home', name: 'home' })).toEqual({
      command: 'wt.exe',
      args: ['ssh', '-t', "cd '/p/home' && exec claude -n 'home'"],
    });
  });

  it('escapes quotes inside substituted values', () => {
    const out = planLaunchNew({ launchNew, cwd: "/p/it's", name: "n'm" });
    expect(out.args[2]).toBe("cd '/p/it'\\''s' && exec claude -n 'n'\\''m'");
  });

  it('applies a WT profile after substitution', () => {
    expect(planLaunchNew({
      launchNew: {
        command: 'wt.exe',
        args: ['-w', '-1', 'ssh', '-t', "cd '{cwd}' && exec claude -n '{name}'"],
      },
      cwd: '/p/home',
      name: 'home',
      profile: 'home',
    })).toEqual({
      command: 'wt.exe',
      args: ['-w', '-1', '-p', 'home', 'ssh', '-t', "cd '/p/home' && exec claude -n 'home'"],
    });
  });

  it('strips a baked-in -p when profile is empty', () => {
    expect(planLaunchNew({
      launchNew: {
        command: 'wt.exe',
        args: ['-w', '-1', '-p', 'popstas', 'ssh'],
      },
      cwd: '/p',
      name: 'x',
      profile: '',
    }).args).toEqual(['-w', '-1', 'ssh']);
  });
});

describe('normalizeProjects', () => {
  it('keeps complete entries and drops incomplete ones', () => {
    expect(normalizeProjects([
      { name: 'home', cwd: '/p/home', hotkey: 'Ctrl+F11', profile: 'home' },
      { name: 'x' },
      null,
    ])).toEqual([
      { name: 'home', cwd: '/p/home', hotkey: 'Ctrl+F11', profile: 'home' },
    ]);
  });
});

describe('profileForCwd', () => {
  const cfg = {
    profile: 'popstas',
    projects: [
      { name: 'home', cwd: '/p/home', profile: 'home' },
      { name: 'ez', cwd: '/p/ExpertizeMe' },
    ],
  };

  it('uses project profile on exact cwd match', () => {
    expect(profileForCwd('/p/home', cfg)).toBe('home');
  });

  it('falls back to cfg.profile when project has no profile', () => {
    expect(profileForCwd('/p/ExpertizeMe', cfg)).toBe('popstas');
  });

  it('falls back to cfg.profile when cwd is unknown', () => {
    expect(profileForCwd('/other', cfg)).toBe('popstas');
  });

  it('returns empty when no project and no cfg.profile', () => {
    expect(profileForCwd('/other', { profile: '', projects: [] })).toBe('');
  });
});
