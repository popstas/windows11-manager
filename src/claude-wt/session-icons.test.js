import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listIcons, resolveIcon, createSessionIconStore, DAY_MS, KEEP_MS } from './session-icons.js';

const HOUR = 60 * 60 * 1000;

describe('listIcons / resolveIcon', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w11m-ico-'));
    for (const f of ['telegram.ico', 'Planfix.ICO', 'home assistant.png']) fs.writeFileSync(path.join(dir, f), '');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'deep.ico'), '');
  });

  it('listIcons — только .ico, без расширения, по алфавиту', () => {
    expect(listIcons(dir)).toEqual(['Planfix', 'telegram']);
  });

  it('listIcons — нет папки — бросает', () => {
    expect(() => listIcons(path.join(dir, 'nope'))).toThrow();
  });

  it('resolveIcon — без учёта регистра', () => {
    expect(resolveIcon('planfix', dir)).toBe(path.join(dir, 'Planfix.ICO'));
    expect(resolveIcon('TELEGRAM', dir)).toBe(path.join(dir, 'telegram.ico'));
  });

  it('resolveIcon — путь и .. не проходят', () => {
    for (const name of ['../x', 'sub/telegram', 'sub/deep', path.join(dir, 'telegram.ico'), 'telegram.ico', '', 'home assistant']) {
      expect(resolveIcon(name, dir), name).toBeNull();
    }
  });
});

describe('createSessionIconStore', () => {
  let file;
  let clock;
  const now = () => clock;
  const onDisk = () => JSON.parse(fs.readFileSync(file, 'utf8'));

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w11m-store-'));
    file = path.join(dir, 'data', 'session-icons.json');
    clock = 1000;
  });

  it('set и get, снятие поля, пустая запись удаляется', () => {
    const store = createSessionIconStore({ file, now });
    expect(store.get('a')).toBeUndefined();
    const v0 = store.version;
    store.set('a', 'icon', 'C:\\ico\\tg.ico');
    store.set('a', 'badge', 'C:\\ico\\pf.ico');
    expect(store.get('a')).toEqual({ icon: 'C:\\ico\\tg.ico', badge: 'C:\\ico\\pf.ico' });
    expect(store.version).toBeGreaterThan(v0);
    store.set('a', 'icon', null);
    expect(store.get('a')).toEqual({ badge: 'C:\\ico\\pf.ico' });
    store.set('a', 'badge', null);
    expect(store.get('a')).toBeUndefined();
    expect(onDisk()).toEqual({});
  });

  it('заданное переживает перезапуск', () => {
    createSessionIconStore({ file, now }).set('a', 'badge', 'C:\\ico\\tg.ico');
    const again = createSessionIconStore({ file, now });
    expect(again.get('a')).toEqual({ badge: 'C:\\ico\\tg.ico' });
  });

  it('touch пишет на диск не чаще раза в сутки', () => {
    const store = createSessionIconStore({ file, now });
    store.set('a', 'icon', 'x.ico');
    const v = store.version;
    clock += HOUR;
    store.touch(['a', 'unknown']);
    expect(onDisk().a.at).toBe(1000);
    clock += 24 * HOUR;
    store.touch(['a']);
    expect(onDisk().a.at).toBe(1000 + 25 * HOUR);
    expect(onDisk().unknown).toBeUndefined();
    // touch содержимое не меняет — отпечаток службы иконок не дёргается.
    expect(store.version).toBe(v);
  });

  it('запись старше 30 дней удаляется при записи', () => {
    const store = createSessionIconStore({ file, now });
    store.set('A', 'icon', 'a.ico');
    clock += 31 * DAY_MS;
    store.set('B', 'icon', 'b.ico');
    expect(Object.keys(onDisk())).toEqual(['B']);
    expect(store.get('A')).toBeUndefined();
    expect(KEEP_MS).toBe(30 * DAY_MS);
  });

  it('touch держит нужную запись дольше 30 дней', () => {
    const store = createSessionIconStore({ file, now });
    store.set('A', 'icon', 'a.ico');
    for (let d = 0; d < 40; d += 1) {
      clock += DAY_MS;
      store.touch(['A']);
    }
    store.set('B', 'icon', 'b.ico');
    expect(store.get('A')).toEqual({ icon: 'a.ico' });
  });

  it('битый файл — пустое хранилище, а не падение', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{oops');
    const store = createSessionIconStore({ file, now });
    expect(store.get('a')).toBeUndefined();
    store.set('a', 'icon', 'x.ico');
    expect(onDisk().a.icon).toBe('x.ico');
  });
});
