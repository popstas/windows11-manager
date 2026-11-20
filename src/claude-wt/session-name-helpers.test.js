import { describe, it, expect } from 'vitest';
import { isSessionUuid, sessionNameProblem, pickSessionByTitle } from './session-name-helpers.js';

describe('isSessionUuid', () => {
  it('узнаёт id сессии', () => {
    expect(isSessionUuid('bbb704a8-18fb-4c93-accb-f51a223de0ad')).toBe(true);
    expect(isSessionUuid('BBB704A8-18FB-4C93-ACCB-F51A223DE0AD')).toBe(true);
  });
  it('имя — не id', () => {
    expect(isSessionUuid('nginx-cve-1811')).toBe(false);
    expect(isSessionUuid('bbb704a8-18fb-4c93-accb-f51a223de0ad ')).toBe(false);
    expect(isSessionUuid(undefined)).toBe(false);
  });
});

describe('sessionNameProblem', () => {
  it.each(['nginx-cve-1811', 'задача_1.2', '└child', 'Ελληνικά9'])('пускает %s', (n) => {
    expect(sessionNameProblem(n)).toBeNull();
  });
  it.each(['', 'a b', "a'b", 'a"b', 'a;b', 'a|b', '$x', '`x`', 'a/b', 'a\\b', 'a\nb', 'a&b', 'a%b', '-x', '--kiosk'])(
    'не пускает %j', (n) => {
      expect(sessionNameProblem(n)).not.toBeNull();
    },
  );
  it('не пускает слишком длинное', () => {
    expect(sessionNameProblem('a'.repeat(128))).toBeNull();
    expect(sessionNameProblem('a'.repeat(129))).toMatch(/longer/);
  });
});

describe('pickSessionByTitle', () => {
  it('нет такого заголовка — null', () => {
    expect(pickSessionByTitle([{ id: '1', title: 'a' }], 'b')).toBeNull();
  });
  it('заголовок сравнивается точно', () => {
    expect(pickSessionByTitle([{ id: '1', title: 'site-2' }], 'site')).toBeNull();
  });
  it('открытое живое окно впереди свежей активности', () => {
    const list = [
      { id: '1', title: 'a', open: false, lastActivity: 999 },
      { id: '2', title: 'a', open: true, windowId: 5, lastActivity: 1 },
    ];
    expect(pickSessionByTitle(list, 'a').id).toBe('2');
  });
  it('мёртвый hwnd окном на экране не считается', () => {
    const list = [
      { id: '1', title: 'a', open: false, lastActivity: 999 },
      { id: '2', title: 'a', open: true, windowId: 5, lastActivity: 1 },
    ];
    expect(pickSessionByTitle(list, 'a', () => false).id).toBe('1');
  });
  it('при равной активности решает фокус', () => {
    const list = [
      { id: '1', title: 'a', lastActivity: 5, focusedAt: 1 },
      { id: '2', title: 'a', lastActivity: 5, focusedAt: 9 },
    ];
    expect(pickSessionByTitle(list, 'a').id).toBe('2');
  });
});
