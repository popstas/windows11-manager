import { describe, it, expect } from 'vitest';
import {
  TERMINAL_DEFAULTS,
  normalizeTerminals,
  resolveTerminal,
  isLegacyLaunch,
  chooseTerminal,
} from './terminal-helpers.js';
import { planLaunchNew } from './project-helpers.js';

describe('normalizeTerminals', () => {
  it('без пользовательских правок отдаёт встроенные', () => {
    expect(normalizeTerminals(undefined)).toEqual(TERMINAL_DEFAULTS);
    expect(TERMINAL_DEFAULTS.wt.command).toBe('wt.exe');
    expect(TERMINAL_DEFAULTS.wezterm.command).toBe('wezterm-gui.exe');
  });

  it('пользовательская запись перекрывает встроенную целиком', () => {
    const out = normalizeTerminals({ wezterm: { command: 'D:\\wt\\wezterm-gui.exe', args: ['start', '--'] } });
    expect(out.wezterm.command).toBe('D:\\wt\\wezterm-gui.exe');
    expect(out.wt).toEqual(TERMINAL_DEFAULTS.wt);
  });

  it('мусорную запись выбрасывает, а не роняет разбор', () => {
    const out = normalizeTerminals({ wt: 'not-an-object', mine: { args: ['x'] } });
    expect(out.wt).toEqual(TERMINAL_DEFAULTS.wt);
    expect(out.mine).toBeUndefined();
  });
});

describe('resolveTerminal', () => {
  const cfg = { terminal: 'wt', terminals: TERMINAL_DEFAULTS };

  it('названный терминал выигрывает у дефолта машины', () => {
    expect(resolveTerminal('wezterm', cfg)).toMatchObject({ name: 'wezterm', fallback: false });
  });

  it('пустое имя — дефолт машины, и это не откат', () => {
    expect(resolveTerminal('', cfg)).toMatchObject({ name: 'wt', fallback: false });
  });

  it('незнакомое имя — дефолт машины и пометка отката', () => {
    expect(resolveTerminal('iterm2', cfg)).toMatchObject({ name: 'wt', fallback: true });
  });

  it('дефолт машины тоже незнаком — первый из реестра, лишь бы просьба не пропала', () => {
    const broken = { terminal: 'nope', terminals: TERMINAL_DEFAULTS };
    expect(resolveTerminal('also-nope', broken).entry).toBeTruthy();
  });
});

describe('isLegacyLaunch', () => {
  it('уцелевший launch.command значит старый конфиг', () => {
    expect(isLegacyLaunch({ launch: { command: 'wt.exe', args: [] } })).toBe(true);
  });

  it('без launch.command конфиг новый', () => {
    expect(isLegacyLaunch({ launch: { args: ['ssh'] } })).toBe(false);
    expect(isLegacyLaunch({})).toBe(false);
  });

  it('без имени блока спрашивает по-старому — про launch', () => {
    // Обратная совместимость: вызовы без второго аргумента не должны
    // разойтись с прежним поведением.
    expect(isLegacyLaunch({ launch: { command: 'wt.exe' } })).toBe(true);
    expect(isLegacyLaunch({ launchNew: { command: 'wt.exe' } })).toBe(false);
  });

  it('с именем блока судит по нему, а не всегда по launch', () => {
    // Полумигрированный конфиг: launch ещё старый, launchNew уже реестровый.
    const half = { launch: { command: 'wt.exe', args: [] }, launchNew: { args: ['ssh'] } };
    expect(isLegacyLaunch(half, 'launch')).toBe(true);
    expect(isLegacyLaunch(half, 'launchNew')).toBe(false);
  });
});

describe('chooseTerminal', () => {
  const cfg = { terminal: 'wt', terminals: TERMINAL_DEFAULTS };

  it('на новом конфиге решает как resolveTerminal и молчит', () => {
    const { chosen, message } = chooseTerminal('wezterm', cfg, 'launch');
    expect(chosen).toMatchObject({ name: 'wezterm', fallback: false });
    expect(message).toBeNull();
  });

  it('незнакомое имя — откат на дефолт машины, и об этом пишут в лог', () => {
    const { chosen, message } = chooseTerminal('iterm2', cfg, 'launch');
    expect(chosen).toMatchObject({ name: 'wt', fallback: true });
    expect(message).toBe('[claude-wt] terminal iterm2 is not in claudeWt.terminals, using wt');
  });

  it('пустое имя — не откат, и сообщать не о чем', () => {
    expect(chooseTerminal('', cfg, 'launch').message).toBeNull();
  });

  it('старый конфиг игнорирует просьбу и сообщает об этом, только если просьба была', () => {
    const legacyCfg = { launch: { command: 'wt.exe', args: [] } };
    const named = chooseTerminal('wezterm', legacyCfg, 'launch');
    expect(named.chosen).toEqual({ name: 'wt', entry: null, fallback: false });
    expect(named.message).toBe(
      '[claude-wt] claudeWt.launch.command is set: config is legacy, terminal choice is ignored',
    );
    expect(chooseTerminal('', legacyCfg, 'launch').message).toBeNull();
  });

  it('называет свой блок в сообщении о старом конфиге', () => {
    const legacyNew = { launchNew: { command: 'wt.exe', args: [] } };
    expect(chooseTerminal('wezterm', legacyNew, 'launchNew').message).toBe(
      '[claude-wt] claudeWt.launchNew.command is set: config is legacy, terminal choice is ignored',
    );
  });

  // Ниже — оба перекошенных случая из ревью ветки: полумигрированный конфиг,
  // где launch и launchNew разъехались по старости, а старая развилка судила
  // об обоих по одному только launch.command.

  it('перекос №1: launchNew ещё старый, launch уже реестровый — без дублирования аргументов', () => {
    // Раньше (isLegacyLaunch смотрела только на launch.command, у которого
    // command не назван) это читалось как «новый», reslveTerminal подставлял
    // реестровые -w -1 поверх уже зашитых в launchNew.args — команда
    // удваивалась: wt.exe -w -1 -w -1 ssh -A h -t claude-wt …
    const cfgA = {
      launch: { args: ['ssh', '-A', 'h', '-t', 'ccfzf --session {id} --kiosk'] },
      launchNew: { command: 'wt.exe', args: ['-w', '-1', 'ssh', '-A', 'h', '-t', 'claude-wt'] },
    };
    const { chosen } = chooseTerminal('', cfgA, 'launchNew');
    expect(chosen).toEqual({ name: 'wt', entry: null, fallback: false });
    const out = planLaunchNew({ launchNew: cfgA.launchNew, cwd: '/p/x', name: 'x', terminal: chosen.entry });
    expect(out).toEqual({
      command: 'wt.exe',
      args: ['-w', '-1', 'ssh', '-A', 'h', '-t', 'claude-wt'],
    });
  });

  it('перекос №2 (зеркальный): launch ещё старый, launchNew уже реестровый — отказа больше нет', () => {
    // Раньше тот же launch.command помечал старым и launchNew, у которого
    // command не задан вовсе (он уже мигрировал на реестр) — код отказывал
    // с «claudeWt.launchNew.command is not set in config» там, где реестр
    // был готов сработать сам.
    const cfgB = {
      launch: { command: 'wt.exe', args: ['-w', '-1', 'ssh', '-A', 'h', '-t', 'ccfzf --session {id}'] },
      launchNew: { args: ['ssh', '-A', 'h', '-t', "cd '{cwd}' && exec claude -n '{name}'"] },
      terminal: 'wt',
      terminals: {},
    };
    expect(isLegacyLaunch(cfgB, 'launch')).toBe(true);
    expect(isLegacyLaunch(cfgB, 'launchNew')).toBe(false);
    const { chosen, message } = chooseTerminal('', cfgB, 'launchNew');
    expect(chosen.fallback).toBe(false);
    expect(chosen.entry).toBeTruthy();
    expect(message).toBeNull();
    const out = planLaunchNew({ launchNew: cfgB.launchNew, cwd: '/p', name: 'x', terminal: chosen.entry });
    expect(out.command).toBe(chosen.entry.command);
  });
});
