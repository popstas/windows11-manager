import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planLaunchNew, promptFromRequest, promptLaunch, PROMPT_MAX_BYTES } from './project-helpers.js';
import { mergeClaudeWtConfig } from './daemon-helpers.js';

// Удалённая команда живого `launchNew` на nb (2026-11-21), дословно: вывод
// шаблона с промптом обязан работать на ней без правки конфига.
const LIVE_REMOTE = `printf '\\033]1337\\073SetUserVar=wt_profile=%s\\007' '{profileB64}' && exec $SHELL -ic 'cd -- "$1" && exec claude -n "$2" --session-id "$3"' claude-wt '{cwd}' '{name}' '{sessionId}'`;
const LIVE = { args: ['ssh', '-A', 'user@host', '-t', LIVE_REMOTE] };

// Промпт, на котором ломается всё, что можно сломать: обе кавычки, `;`
// (разделитель панелей wt.exe), `$` и подстановка, перевод строки, кириллица.
const NASTY = `fix "it" now; don't $HOME \`id\` $(echo x)\nвторая строка — ёж`;

describe('promptFromRequest', () => {
  it('кодирует промпт в base64 байтами UTF-8', () => {
    const { prompt, promptB64 } = promptFromRequest(`  ${NASTY}  `);
    expect(prompt).toBe(NASTY);
    expect(Buffer.from(promptB64, 'base64').toString('utf8')).toBe(NASTY);
    expect(promptB64).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('пустой и не строка — отказ', () => {
    expect(promptFromRequest('').error).toMatch(/non-empty/);
    expect(promptFromRequest('   ').error).toMatch(/non-empty/);
    expect(promptFromRequest(undefined).error).toMatch(/non-empty/);
    expect(promptFromRequest({ a: 1 }).error).toMatch(/non-empty/);
  });

  it('длиннее предела — отказ с названным пределом, а не обрезка', () => {
    // Кириллица — два байта на знак: предел считается в байтах, не в знаках.
    const long = 'ж'.repeat(PROMPT_MAX_BYTES / 2 + 1);
    const { error } = promptFromRequest(long);
    expect(error).toContain(String(PROMPT_MAX_BYTES));
    expect(promptFromRequest('ж'.repeat(PROMPT_MAX_BYTES / 2)).error).toBeUndefined();
  });
});

describe('promptLaunch', () => {
  it('выводится из живого launchNew: хвост встаёт внутрь скрипта -ic', () => {
    const derived = promptLaunch({ launchNew: LIVE });
    expect(derived.args.slice(0, 4)).toEqual(LIVE.args.slice(0, 4));
    expect(derived.args[4]).toContain(
      `--session-id "$3" -- "$(printf %s {promptB64} | base64 --decode)"' claude-wt '{cwd}'`,
    );
    // Сам launchNew не тронут: обычная новая сессия идёт прежним шаблоном.
    expect(LIVE.args[4]).toBe(LIVE_REMOTE);
  });

  it('в выведенном шаблоне нет ни `;`, ни лишней одинарной кавычки', () => {
    const derived = promptLaunch({ launchNew: LIVE }).args[4];
    // `\\073` в printf — это не `;`, а его восьмеричная запись.
    expect(derived.replace(/\\073/g, '')).not.toContain(';');
    expect(derived.split("'").length).toBe(LIVE_REMOTE.split("'").length);
  });

  it('свой launchPrompt главнее выведенного', () => {
    const own = { args: ['own', '{promptB64}'] };
    expect(promptLaunch({ launchNew: LIVE, launchPrompt: own })).toBe(own);
  });

  it('пустой launchPrompt из умолчаний не мешает выводу', () => {
    const cfg = mergeClaudeWtConfig({ launchNew: LIVE });
    expect(cfg.launchPrompt).toEqual({ args: [] });
    expect(promptLaunch(cfg).args[4]).toContain('base64 --decode');
  });

  it('старая форма без -ic — отказ, а не догадка', () => {
    // «Первая кавычка после claude» здесь — внутри '{name}'.
    const legacy = { args: ['ssh', 'h', `cd '{cwd}' && exec claude -n '{name}'`] };
    expect(promptLaunch({ launchNew: legacy })).toBeNull();
    expect(promptLaunch({ launchNew: { args: [] } })).toBeNull();
    expect(promptLaunch({})).toBeNull();
  });

  it('скрипт -ic без claude — отказ', () => {
    const other = { args: [`exec $SHELL -ic 'cd -- "$1" && exec zsh' x '{cwd}'`] };
    expect(promptLaunch({ launchNew: other })).toBeNull();
  });
});

describe('промпт доезжает до claude целиком', () => {
  it.skipIf(process.platform === 'win32')('живой шаблон, настоящий шелл, подставной claude', () => {
    // Удалённая сторона ssh разбирает команду своим шеллом, `$SHELL -ic` —
    // вторым. Оба здесь настоящие (sh), claude — подставной: пишет свои
    // аргументы через \0, чтобы перевод строки в промпте не путал счёт.
    const dir = mkdtempSync(join(tmpdir(), 'w11m-prompt-'));
    const bin = join(dir, 'bin');
    spawnSync('mkdir', [bin]);
    const out = join(dir, 'argv');
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\nfor a; do printf '%s\\0' "$a"; done > "$OUT"\n`);
    chmodSync(join(bin, 'claude'), 0o755);
    const cwd = join(dir, "про'ект");
    spawnSync('mkdir', [cwd]);

    const { promptB64 } = promptFromRequest(NASTY);
    const { args } = planLaunchNew({
      launchNew: promptLaunch({ launchNew: LIVE }),
      cwd, name: 'site-2', sessionId: '11111111-2222-3333-4444-555555555555', promptB64,
    });
    const remote = args[4];
    const res = spawnSync('/bin/sh', ['-c', remote], {
      env: { PATH: `${bin}:/usr/bin:/bin`, SHELL: '/bin/sh', OUT: out, HOME: dir },
      encoding: 'utf8',
    });
    expect(res.status, res.stderr).toBe(0);
    const argv = readFileSync(out, 'utf8').split('\0').slice(0, -1);
    expect(argv).toEqual(['-n', 'site-2', '--session-id', '11111111-2222-3333-4444-555555555555', '--', NASTY]);
  });
});
