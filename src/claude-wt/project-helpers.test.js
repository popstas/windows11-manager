import { describe, it, expect } from 'vitest';
import {
  basenameOfCwd,
  sessionNameFor,
  pickOpenProjectSession,
  parseCursorPoint,
  centerOnMonitor,
  escapeForSingleQuoted,
  planWtLaunch,
  planLaunchNew,
  normalizeProjects,
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

describe('planWtLaunch с реестром терминалов', () => {
  const launch = { args: ['ssh', '-t', 'host', 'ccfzf --session {id}'] };

  it('складывает терминал, его аргументы и хвост', () => {
    const out = planWtLaunch({
      launch,
      vars: { id: 's1' },
      terminal: { command: 'wezterm-gui.exe', args: ['start', '--'] },
    });
    expect(out.command).toBe('wezterm-gui.exe');
    expect(out.args).toEqual(['start', '--', 'ssh', '-t', 'host', 'ccfzf --session s1']);
  });

  it('профильные аргументы встают между терминалом и хвостом', () => {
    const out = planWtLaunch({
      launch,
      vars: { id: 's1' },
      profile: 'Site',
      terminal: { command: 'wt.exe', args: ['-w', '-1'], profileArgs: ['-p', '{profile}'] },
    });
    expect(out.args).toEqual(['-w', '-1', '-p', 'Site', 'ssh', '-t', 'host', 'ccfzf --session s1']);
  });

  it('пустой профиль профильных аргументов не даёт', () => {
    const out = planWtLaunch({
      launch,
      vars: { id: 's1' },
      profile: '',
      terminal: { command: 'wt.exe', args: ['-w', '-1'], profileArgs: ['-p', '{profile}'] },
    });
    expect(out.args).toEqual(['-w', '-1', 'ssh', '-t', 'host', 'ccfzf --session s1']);
  });

  it('терминал без profileArgs профиль молча роняет, а не подставляет чужой флаг', () => {
    const out = planWtLaunch({
      launch,
      vars: { id: 's1' },
      profile: 'Site',
      terminal: { command: 'wezterm-gui.exe', args: ['start', '--'] },
    });
    expect(out.args).toEqual(['start', '--', 'ssh', '-t', 'host', 'ccfzf --session s1']);
  });

  it('без terminal работает по-старому — команда из launch', () => {
    const out = planWtLaunch({
      launch: { command: 'wt.exe', args: ['-w', '-1', 'ssh', '{id}'] },
      vars: { id: 's1' },
      profile: 'Site',
    });
    expect(out.command).toBe('wt.exe');
    expect(out.args).toEqual(['-w', '-1', '-p', 'Site', 'ssh', 's1']);
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

  it('явно пустой плоский profile — отказ проекта, а не сигнал взять глобальный', () => {
    // До этого фикса profileForTerminal давал 'popstas', потому что пустая
    // строка проваливалась мимо проверки на непустоту прямиком к глобальному
    // конфигу.
    const silentCfg = { profile: 'popstas', projects: [{ cwd: '/p/silent', profile: '' }] };
    expect(profileForTerminal('/p/silent', 'wt', silentCfg)).toBe('');
  });

  it('явно пустая запись в карте profiles — тоже отказ, даже при заданном плоском profile', () => {
    // Через normalizeProjects, а не сырым объектом: непройденный нормализацией
    // конфиг в проде не бывает, а зелёный тест на нём проверял бы не то
    // поведение.
    const mapCfg = {
      profile: 'Global',
      projects: normalizeProjects([{ name: 'x', cwd: 'D:\\p\\x', profile: 'Flat', profiles: { wt: '' } }]),
    };
    expect(profileForTerminal('D:\\p\\x', 'wt', mapCfg)).toBe('');
  });

  it('явно пустая запись без плоского profile — тоже отказ, а не глобальный профиль', () => {
    // Второй перекошенный случай из того же ревью: без плоского profile
    // карта из одной пустой записи выбрасывалась normalizeProjects целиком,
    // и отказ терялся вовсе — profileForTerminal падал к cfg.profile.
    const mapCfg = {
      profile: 'Global',
      projects: normalizeProjects([{ name: 'y', cwd: 'D:\\p\\y', profiles: { wt: '' } }]),
    };
    expect(profileForTerminal('D:\\p\\y', 'wt', mapCfg)).toBe('');
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

  it('явно пустая запись в карте — тоже отказ, а не повод выбросить всю карту', () => {
    // Регрессия ревью: normalizeProjects судила по непустоте значения после
    // trim, и карта из одной пустой записи пропадала целиком — {wt: ''}
    // превращался в {} вместе с самим explicit-отказом.
    const [p] = normalizeProjects([{ name: 'a', cwd: 'C:\\a', profiles: { wt: '' } }]);
    expect(p.profiles).toEqual({ wt: '' });
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

describe('parseCursorPoint', () => {
  it('берёт точку, включая нуль и минус', () => {
    // Начало координат у главного монитора: экран слева от него весь в минусе,
    // и отбрось мы отрицательные, галка не работала бы ровно на той половине
    // стола, ради которой её и заводили.
    expect(parseCursorPoint({ x: 2560, y: 300 })).toEqual({ x: 2560, y: 300 });
    expect(parseCursorPoint({ x: -1920, y: 0 })).toEqual({ x: -1920, y: 0 });
  });

  it('мусор из чужого тела не доезжает до setBounds', () => {
    // Тело пишет пикер на другой машине. Строка или NaN здесь означали бы окно,
    // поставленное неизвестно куда, и сказать об этом было бы некому: ответа у
    // публикации нет.
    expect(parseCursorPoint({ x: '10', y: 20 })).toBe(null);
    expect(parseCursorPoint({ x: NaN, y: 20 })).toBe(null);
    expect(parseCursorPoint({ x: Infinity, y: 0 })).toBe(null);
    expect(parseCursorPoint({ x: 10 })).toBe(null);
    expect(parseCursorPoint(null)).toBe(null);
    expect(parseCursorPoint('10,20')).toBe(null);
    expect(parseCursorPoint(undefined)).toBe(null);
  });
});

describe('centerOnMonitor', () => {
  it('ставит окно посреди названного экрана, а не в углу', () => {
    // Угол — место, куда уже мог встать прошлый терминал, и стопка окон друг на
    // друге читается как «ничего не открылось».
    expect(centerOnMonitor({ x: 0, y: 0, width: 1920, height: 1080 }, { width: 920, height: 580 }))
      .toEqual({ x: 500, y: 250 });
  });

  it('второй монитор начинается там, где начинается', () => {
    expect(centerOnMonitor({ x: 1920, y: 0, width: 2560, height: 1440 }, { width: 1000, height: 800 }))
      .toEqual({ x: 1920 + 780, y: 320 });
    // И слева от главного — тоже: координаты там отрицательные.
    expect(centerOnMonitor({ x: -1920, y: 0, width: 1920, height: 1080 }, { width: 920, height: 580 }))
      .toEqual({ x: -1920 + 500, y: 250 });
  });

  it('окно больше экрана прижимается к его началу, а не уезжает за край', () => {
    // За краем у окна терминала нечего хватать мышью.
    expect(centerOnMonitor({ x: 0, y: 0, width: 1920, height: 1080 }, { width: 2400, height: 1200 }))
      .toEqual({ x: 0, y: 0 });
  });
});
