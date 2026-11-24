import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTaskbarHideStore, KEEP_MS } from './taskbar-hide-store.js';

describe('createTaskbarHideStore', () => {
  let file;
  let clock;
  const make = () => createTaskbarHideStore({ file, now: () => clock });
  beforeEach(() => {
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'w11m-th-')), 'data', 'session-taskbar.json');
    clock = 1_000_000;
  });

  it('set/get, set(null) удаляет', () => {
    const s = make();
    expect(s.get('a')).toBeUndefined();
    s.set('a', 'hide');
    expect(s.get('a')).toEqual({ mode: 'hide' });
    expect(s.ids()).toEqual(['a']);
    s.set('a', null);
    expect(s.get('a')).toBeUndefined();
  });

  it('patch дописывает поля, version растёт', () => {
    const s = make();
    s.set('a', 'hide');
    const v = s.version;
    s.patch('a', { hwnd: 42, sawIdle: true });
    expect(s.get('a')).toEqual({ mode: 'hide', hwnd: 42, sawIdle: true });
    expect(s.version).toBeGreaterThan(v);
  });

  it('переживает пересоздание из файла', () => {
    const s = make();
    s.set('a', 'show');
    s.patch('a', { hwnd: 7 });
    expect(make().get('a')).toEqual({ mode: 'show', hwnd: 7 });
  });

  it('время постановки отметки: не сдвигается patch-ем, переживает пересоздание', () => {
    // По нему служба отличает устаревшее чтение состояния агента от паузы
    // после отметки (taskbar-hide.js, advanceExplicit).
    const s = make();
    expect(s.setAtOf('a')).toBeUndefined();
    s.set('a', 'hide');
    clock += 5000;
    s.patch('a', { hwnd: 1, sawIdle: true });
    expect(s.setAtOf('a')).toBe(1_000_000);
    expect(s.get('a'), 'в виде отметки его нет').toEqual({ mode: 'hide', hwnd: 1, sawIdle: true });
    expect(make().setAtOf('a')).toBe(1_000_000);
    s.patch('a', { setAt: 1 });
    expect(s.setAtOf('a'), 'patch его не перезаписывает').toBe(1_000_000);
    s.set('a', 'hide');
    expect(s.setAtOf('a'), 'новая постановка — новое время').toBe(1_005_000);
  });

  it('битый файл — пусто', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{oops');
    expect(make().ids()).toEqual([]);
  });

  it('ключ __proto__ из файла — обычная запись', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"__proto__":{"mode":"hide","at":1000000}}');
    expect(make().get('__proto__')).toEqual({ mode: 'hide' });
  });

  it('clearAll очищает и файл', () => {
    const s = make();
    s.set('a', 'hide');
    s.clearAll();
    expect(s.ids()).toEqual([]);
    expect(make().ids()).toEqual([]);
  });

  it('старые записи выбрасываются при записи', () => {
    const s = make();
    s.set('old', 'hide');
    clock += KEEP_MS + 1;
    s.set('new', 'hide');
    expect(s.ids()).toEqual(['new']);
    expect(make().ids()).toEqual(['new']);
  });
});
