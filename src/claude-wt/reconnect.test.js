import { describe, it, expect } from 'vitest';
import {
  isConnectionLost,
  encodeArgv,
  decodeArgv,
  parseWrapperArgs,
  nextStep,
  exitCodeFor,
  isEnterKey,
  RETRY_QUICK_MS,
} from './reconnect-helpers.js';
import { planWtLaunch, planLaunchNew, RECONNECT_WRAPPER } from './project-helpers.js';
import { TERMINAL_DEFAULTS, normalizeTerminals } from './terminal-helpers.js';

describe('isConnectionLost', () => {
  it('255, -1 и беззнаковый -1 — потеря связи', () => {
    for (const code of [255, -1, 4294967295]) expect(isConnectionLost(code)).toBe(true);
  });
  it('0, 1, 130 и null — нет', () => {
    for (const code of [0, 1, 130, null]) expect(isConnectionLost(code)).toBe(false);
  });
});

describe('encodeArgv / decodeArgv', () => {
  it('кавычки и $ удалённой команды переживают кодирование', () => {
    const argv = ['ssh', '-t', 'h', `printf '\\033]1337' && exec $SHELL -ic 'cd -- "$1"' x '/p'`];
    expect(decodeArgv(encodeArgv(argv))).toEqual(argv);
  });
  it('мусор — null', () => {
    for (const bad of ['', 'not-base64!', Buffer.from('{"a":1}').toString('base64'), Buffer.from('[]').toString('base64'), undefined]) {
      expect(decodeArgv(bad)).toBeNull();
    }
  });
});

describe('parseWrapperArgs', () => {
  it('исходная команда — всё после --', () => {
    const retry = ['ssh', 'h', 'ccfzf --session s1 --kiosk'];
    expect(parseWrapperArgs(['--retry', encodeArgv(retry), '--', 'ssh', '-t', 'h', 'cmd']))
      .toEqual({ ok: true, original: ['ssh', '-t', 'h', 'cmd'], retry });
  });
  it('-- внутри исходной команды остаётся её частью', () => {
    expect(parseWrapperArgs(['--', 'a', '--', 'b']).original).toEqual(['a', '--', 'b']);
  });
  it('без повтора и с битым повтором — retry null, запуск всё равно есть', () => {
    expect(parseWrapperArgs(['--', 'ssh'])).toEqual({ ok: true, original: ['ssh'], retry: null });
    expect(parseWrapperArgs(['--retry', '%%', '--', 'ssh'])).toEqual({ ok: true, original: ['ssh'], retry: null });
  });
  it('без -- или без команды — отказ', () => {
    expect(parseWrapperArgs(['ssh']).ok).toBe(false);
    expect(parseWrapperArgs(['--retry', 'x', '--']).ok).toBe(false);
  });
});

describe('nextStep', () => {
  it('0 — выход с 0', () => {
    expect(nextStep({ code: 0, attempt: 'original', elapsedMs: 1, hasRetry: true })).toEqual({ kind: 'exit', code: 0 });
  });
  it('потеря связи — спросить и переподключиться повтором', () => {
    for (const attempt of ['original', 'retry']) {
      const step = nextStep({ code: 4294967295, attempt, elapsedMs: 60000, hasRetry: true });
      expect(step).toMatchObject({ kind: 'ask', next: 'retry' });
      expect(step.message).toMatch(/Соединение потеряно\. Enter — переподключиться/);
    }
  });
  it('потеря связи без повтора — исходная команда', () => {
    expect(nextStep({ code: 255, attempt: 'original', elapsedMs: 1, hasRetry: false })).toMatchObject({ kind: 'ask', next: 'original' });
  });
  it('быстро упавший повтор — предложить исходную команду', () => {
    expect(nextStep({ code: 1, attempt: 'retry', elapsedMs: RETRY_QUICK_MS - 1, hasRetry: true }))
      .toMatchObject({ kind: 'ask', next: 'original' });
  });
  it('долгий повтор с ошибкой и ошибка исходной — выход с тем же кодом', () => {
    expect(nextStep({ code: 1, attempt: 'retry', elapsedMs: RETRY_QUICK_MS, hasRetry: true })).toEqual({ kind: 'exit', code: 1 });
    expect(nextStep({ code: 2, attempt: 'original', elapsedMs: 1, hasRetry: true })).toEqual({ kind: 'exit', code: 2 });
  });
  it('убит сигналом (null) — выход с 1', () => {
    expect(nextStep({ code: null, attempt: 'original', elapsedMs: 1, hasRetry: true })).toEqual({ kind: 'exit', code: 1 });
    expect(exitCodeFor(null)).toBe(1);
  });
});

describe('isEnterKey', () => {
  it('\\r и \\n — Enter, остальное нет', () => {
    expect(isEnterKey(Buffer.from('\r'))).toBe(true);
    expect(isEnterKey('\n')).toBe(true);
    for (const k of ['\x03', 'q', ' ', '\x1b']) expect(isEnterKey(k)).toBe(false);
  });
});

describe('реестр: reconnect', () => {
  it('у встроенного wezterm он включён, у wt нет', () => {
    expect(TERMINAL_DEFAULTS.wezterm.reconnect).toBe(true);
    expect(TERMINAL_DEFAULTS.wt.reconnect).toBeUndefined();
  });
  it('запись из конфига сохраняет reconnect: true и не выдумывает его', () => {
    const t = normalizeTerminals({ wezterm: { command: 'w.exe', args: [], reconnect: true }, wt: { command: 'wt.exe' } });
    expect(t.wezterm.reconnect).toBe(true);
    expect(t.wt.reconnect).toBeUndefined();
  });
});

describe('planWtLaunch: обёртка переподключения', () => {
  const launch = { args: ['ssh', '-t', 'h', "printf '{profileB64}' && ccfzf --session {id} --kiosk"] };
  const wez = TERMINAL_DEFAULTS.wezterm;

  it('restore: хвост уходит обёртке, повтор — тот же шаблон', () => {
    const out = planWtLaunch({ launch, vars: { id: 's1' }, profile: 'home', terminal: wez, retry: launch });
    const tail = ['ssh', '-t', 'h', "printf 'aG9tZQ==' && ccfzf --session s1 --kiosk"];
    expect(out.command).toBe('wezterm-gui.exe');
    expect(out.args.slice(0, 2)).toEqual(['start', '--']);
    expect(out.args.slice(2, 4)).toEqual(RECONNECT_WRAPPER);
    expect(out.args[4]).toBe('--retry');
    expect(decodeArgv(out.args[5])).toEqual(tail);
    expect(out.args.slice(6)).toEqual(['--', ...tail]);
  });

  it('launchNew с {sessionId}: исходная — claude -n, повтор — ccfzf --session по тому же id', () => {
    const launchNew = { args: ['ssh', `exec claude -n "$2" --session-id "$3"' x '{cwd}' '{name}' '{sessionId}'`] };
    const out = planLaunchNew({ launchNew, cwd: '/p/home', name: 'home-5', sessionId: 'u-1', terminal: wez, retry: launch });
    expect(out.args.slice(out.args.indexOf('--', 2) + 1))
      .toEqual(['ssh', `exec claude -n "$2" --session-id "$3"' x '/p/home' 'home-5' 'u-1'`]);
    expect(decodeArgv(out.args[out.args.indexOf('--retry') + 1]))
      .toEqual(['ssh', '-t', 'h', "printf '' && ccfzf --session u-1 --kiosk"]);
  });

  it('шаблон, не передающий id удалённой стороне, — без обёртки', () => {
    const launchNew = { args: ['ssh', `exec claude -n '{name}'`] };
    const out = planLaunchNew({ launchNew, cwd: '/p', name: 'n', sessionId: 'u-1', terminal: wez, retry: launch });
    expect(out.args).toEqual(['start', '--', 'ssh', "exec claude -n 'n'"]);
  });

  it('без retry, без id или у терминала без reconnect — как раньше', () => {
    const plain = ['start', '--', 'ssh', '-t', 'h', "printf '' && ccfzf --session s1 --kiosk"];
    expect(planWtLaunch({ launch, vars: { id: 's1' }, terminal: wez }).args).toEqual(plain);
    expect(planWtLaunch({ launch, vars: { id: 's1' }, terminal: { command: 'wezterm-gui.exe', args: ['start', '--'] }, retry: launch }).args).toEqual(plain);
    expect(planWtLaunch({ launch, vars: {}, terminal: wez, retry: launch }).args)
      .toEqual(['start', '--', 'ssh', '-t', 'h', "printf '' && ccfzf --session  --kiosk"]);
  });

  it('wt не оборачивается — у него свой перезапуск по Enter', () => {
    const out = planWtLaunch({ launch, vars: { id: 's1' }, terminal: TERMINAL_DEFAULTS.wt, retry: launch });
    expect(out.args).not.toContain('--retry');
  });

  it('старая дорога (launch.command) не оборачивается', () => {
    const out = planWtLaunch({ launch: { command: 'wt.exe', args: ['ssh', '{id}'] }, vars: { id: 's1' }, retry: launch });
    expect(out.args).not.toContain('--retry');
  });
});
