/**
 * Звонок в wezterm.lua — настоящий обработчик 'bell' под заглушкой модуля
 * wezterm (wezterm/test/bell-harness.lua). Нужен интерпретатор Lua 5.4:
 * переменная LUA или lua5.4 / lua на PATH; без него тест пропускается — тогда
 * от расхождения js и lua сторожат только разбор констант в
 * bell-children-helpers.test.js.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BELL_HEADER, BELL_QUIET_HEADER } from './bell-children-helpers.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEZ = path.join(ROOT, 'wezterm', 'wezterm.lua');
const HARNESS = path.join(ROOT, 'wezterm', 'test', 'bell-harness.lua');
const CASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'wezterm', 'bell-title-cases.json'), 'utf8'));

function findLua() {
  for (const bin of [process.env.LUA, 'lua5.4', 'lua'].filter(Boolean)) {
    const r = spawnSync(bin, ['-e', 'io.write(_VERSION)'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.includes('5.4')) return bin;
  }
  return '';
}
const LUA = findLua();
const US = '\x1f';

describe.skipIf(!LUA)('wezterm.lua: звонок по режимам', () => {
  let home;
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'bell-')); });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  const flag = name => fs.writeFileSync(path.join(home, name), '');
  const list = (text) => fs.writeFileSync(path.join(home, '.wezterm-bell-children'), text);
  const quiet = (text) => fs.writeFileSync(path.join(home, '.wezterm-bell-quiet'), text);
  const nowSec = () => Math.floor(Date.now() / 1000);
  // [cmd, key, title] → 'play' | 'mute' на каждую строку.
  function bell(rows) {
    const input = rows.map(r => r.join(US)).join('\n') + '\n';
    const r = spawnSync(LUA, [HARNESS, WEZ, home], { input, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    return r.stdout.trim().split('\n');
  }

  it('без флагов звенят все, и дети из списка тоже', () => {
    list(`${BELL_HEADER} ${nowSec()}\nkid\n`);
    expect(bell([['keep', '', '✳ kid'], ['keep', '', 'boss']])).toEqual(['play', 'play']);
  });

  it('off — молчат все', () => {
    flag('.wezterm-bell-off');
    expect(bell([['keep', '', 'boss']])).toEqual(['mute']);
  });

  it('off важнее no children', () => {
    flag('.wezterm-bell-off');
    flag('.wezterm-bell-children-off');
    expect(bell([['keep', '', 'boss']])).toEqual(['mute']);
  });

  it('no children: ключ каждой фикстуры заголовка совпадает с js', () => {
    flag('.wezterm-bell-children-off');
    const rows = CASES.filter(c => c.key).map(c => ['set', c.key, c.title]);
    expect(bell(rows)).toEqual(rows.map(() => 'mute'));
  });

  it('no children: не тот ключ — звенит', () => {
    flag('.wezterm-bell-children-off');
    const rows = CASES.filter(c => c.key).map(c => ['set', `${c.key}x`, c.title]);
    expect(bell(rows)).toEqual(rows.map(() => 'play'));
  });

  it('no children: пустой заголовок не совпадает ни с чем', () => {
    flag('.wezterm-bell-children-off');
    list(`${BELL_HEADER} ${nowSec()}\n\n`);
    expect(bell([['keep', '', '   ']])).toEqual(['play']);
  });

  it('no children: нет файла списка — звенят все', () => {
    flag('.wezterm-bell-children-off');
    expect(bell([['keep', '', 'kid']])).toEqual(['play']);
  });

  it('no children: протухший список — звенят все', () => {
    flag('.wezterm-bell-children-off');
    list(`${BELL_HEADER} ${nowSec() - 1000}\nkid\n`);
    expect(bell([['keep', '', 'kid']])).toEqual(['play']);
  });

  it('no children: время из будущего — тоже не верится', () => {
    flag('.wezterm-bell-children-off');
    list(`${BELL_HEADER} ${nowSec() + 1000}\nkid\n`);
    expect(bell([['keep', '', 'kid']])).toEqual(['play']);
  });

  it('no children: битый заголовок или пустой файл — звенят все', () => {
    flag('.wezterm-bell-children-off');
    list('kid\nkid\n');
    expect(bell([['keep', '', 'kid']])).toEqual(['play']);
    list('');
    expect(bell([['keep', '', 'kid']])).toEqual(['play']);
  });

  it('no children: сбой внутри проверки — звенит', () => {
    flag('.wezterm-bell-children-off');
    list(`${BELL_HEADER} ${nowSec()}\nkid\n`);
    expect(bell([['keep', '', '!error']])).toEqual(['play']);
  });

  it('quiet: окно из списка тихих молчит без флагов', () => {
    quiet(`${BELL_QUIET_HEADER} ${nowSec()}\nhead\n`);
    expect(bell([['keep', '', '✳ head'], ['keep', '', 'boss']])).toEqual(['mute', 'play']);
  });

  it('quiet: молчит и в режиме no children, даже если не ребёнок', () => {
    flag('.wezterm-bell-children-off');
    quiet(`${BELL_QUIET_HEADER} ${nowSec()}\nhead\n`);
    list(`${BELL_HEADER} ${nowSec()}\nkid\n`);
    expect(bell([['keep', '', 'head'], ['keep', '', 'kid'], ['keep', '', 'boss']])).toEqual(['mute', 'mute', 'play']);
  });

  it('quiet: протухший, из будущего, битый или чужой заголовок — звенит', () => {
    for (const text of [
      `${BELL_QUIET_HEADER} ${nowSec() - 1000}\nhead\n`,
      `${BELL_QUIET_HEADER} ${nowSec() + 1000}\nhead\n`,
      'head\n',
      `${BELL_HEADER} ${nowSec()}\nhead\n`,
      '',
    ]) {
      quiet(text);
      expect(bell([['keep', '', 'head']])).toEqual(['play']);
    }
  });

  it('quiet: сбой внутри проверки — звенит', () => {
    quiet(`${BELL_QUIET_HEADER} ${nowSec()}\nhead\n`);
    expect(bell([['keep', '', '!error']])).toEqual(['play']);
  });
});
