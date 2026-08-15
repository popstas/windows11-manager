import { describe, it, expect } from 'vitest';
import {
  basenameOfCwd,
  sessionNameFor,
  pickOpenProjectSession,
  escapeForSingleQuoted,
  planWtLaunch,
  planLaunchNew,
  normalizeProjects,
  profileForCwd,
  profileForTerminal,
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

describe('planWtLaunch', () => {
  it('substitutes id/cwd/name and applies profile', () => {
    expect(planWtLaunch({
      launch: {
        command: 'wt.exe',
        args: ['-w', '-1', 'ssh', '-t', "ccfzf --session {id} --cwd '{cwd}' --name '{name}'"],
      },
      vars: { id: 'a1', cwd: "/p/it's", name: "n'm" },
      profile: 'home',
    })).toEqual({
      command: 'wt.exe',
      args: [
        '-w', '-1', '-p', 'home', 'ssh', '-t',
        "ccfzf --session a1 --cwd '/p/it'\\''s' --name 'n'\\''m'",
      ],
    });
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
      { name: 'silent', cwd: '/p/silent', profile: '  ' },
      { name: 'x' },
      null,
    ])).toEqual([
      { name: 'home', cwd: '/p/home', hotkey: 'Ctrl+F11', profile: 'home' },
      { name: 'silent', cwd: '/p/silent', profile: '' },
    ]);
  });
});

describe('profileForCwd', () => {
  const cfg = {
    profile: 'popstas',
    projects: [
      { name: 'home', cwd: '/p/home', profile: 'home' },
      { name: 'ez', cwd: '/p/ExpertizeMe' },
      { name: 'silent', cwd: '/p/silent', profile: '' },
    ],
  };

  it('uses project profile on exact cwd match', () => {
    expect(profileForCwd('/p/home', cfg)).toBe('home');
  });

  it('falls back to cfg.profile when project has no profile', () => {
    expect(profileForCwd('/p/ExpertizeMe', cfg)).toBe('popstas');
  });

  it('honors an explicitly empty project profile', () => {
    expect(profileForCwd('/p/silent', cfg)).toBe('');
  });

  it('falls back to cfg.profile when cwd is unknown', () => {
    expect(profileForCwd('/other', cfg)).toBe('popstas');
  });

  it('returns empty when no project and no cfg.profile', () => {
    expect(profileForCwd('/other', { profile: '', projects: [] })).toBe('');
  });
});

describe('profileForTerminal', () => {
  const cfg = {
    profile: 'Global',
    projects: [
      { name: 'site', cwd: 'D:\\p\\site', profiles: { wt: 'Site', iterm2: 'SiteMac' } },
      { name: 'old', cwd: 'D:\\p\\old', profile: 'Old' },
    ],
  };

  it('берёт профиль по имени терминала', () => {
    expect(profileForTerminal('D:\\p\\site', 'wt', cfg)).toBe('Site');
  });

  it('у терминала без профиля в карте — пусто, а не чужой профиль', () => {
    expect(profileForTerminal('D:\\p\\site', 'wezterm', cfg)).toBe('');
  });

  it('старое плоское поле profile читается как профиль wt', () => {
    expect(profileForTerminal('D:\\p\\old', 'wt', cfg)).toBe('Old');
    expect(profileForTerminal('D:\\p\\old', 'wezterm', cfg)).toBe('');
  });

  it('незнакомый каталог получает глобальный профиль только для wt', () => {
    expect(profileForTerminal('D:\\p\\nope', 'wt', cfg)).toBe('Global');
    expect(profileForTerminal('D:\\p\\nope', 'wezterm', cfg)).toBe('');
  });
});

describe('normalizeProjects и карта профилей', () => {
  it('карта profiles переживает нормализацию', () => {
    const [p] = normalizeProjects([{ name: 'a', cwd: 'C:\\a', profiles: { wt: 'A', wezterm: 'B' } }]);
    expect(p.profiles).toEqual({ wt: 'A', wezterm: 'B' });
  });

  it('мусор в profiles выбрасывается, а запись остаётся', () => {
    const [p] = normalizeProjects([{ name: 'a', cwd: 'C:\\a', profiles: { wt: 5, ok: 'yes' } }]);
    expect(p.profiles).toEqual({ ok: 'yes' });
  });
});

describe('sessionNameFor', () => {
  it('обычная просьба берёт имя каталога', () => {
    // Так же назвал бы сессию ccfzf (`claude -n <basename>`), и по этому же
    // имени openClaudeProject ищет открытое окно по заголовку.
    expect(sessionNameFor({ cwd: '/p/site', name: 'что угодно' })).toBe('site');
  });

  it('просьба «заведи ещё одну» берёт имя из тела', () => {
    // basename там занят открытой сессией, и уникальное имя посчитал пикер.
    expect(sessionNameFor({ cwd: '/p/site', name: 'site-2', reuseOpen: false })).toBe('site-2');
  });

  it('без имени в теле остаётся каталог — в обоих случаях', () => {
    expect(sessionNameFor({ cwd: '/p/site', reuseOpen: false })).toBe('site');
    expect(sessionNameFor({ cwd: '/p/site' })).toBe('site');
  });

  it('без каталога остаётся имя — иначе сессия была бы безымянной', () => {
    // Безымянную сессию оконный трекер не найдёт по заголовку вовсе.
    expect(sessionNameFor({ cwd: '', name: 'site-2' })).toBe('site-2');
  });
});
