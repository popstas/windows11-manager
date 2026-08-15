import { describe, it, expect } from 'vitest';
import {
  TERMINAL_DEFAULTS,
  normalizeTerminals,
  resolveTerminal,
  isLegacyLaunch,
} from './terminal-helpers.js';

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
});
