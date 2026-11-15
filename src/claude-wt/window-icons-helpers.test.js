import { describe, it, expect } from 'vitest';
import { BUILTIN_HEAD_ICON, resolveIconPath, iconFor, headsDirFor, planIcons } from './window-icons-helpers.js';
import { mergeClaudeWtConfig } from './daemon-helpers.js';

const cfg = mergeClaudeWtConfig({
  profile: 'popstas',
  sessionsFile: 'V:/.ccfzf.sessions.json',
  projects: [
    { name: 'home', cwd: '/p/home', profile: 'home' },
    { name: 'exp', cwd: '/p/exp', profile: 'ExpertizeMe' },
    { name: 'own', cwd: '/p/own', profile: 'home', icon: 'D:\\pics\\own.png' },
    { name: 'bare', cwd: '/p/bare', profile: '' },
  ],
});

describe('iconFor', () => {
  it('head — корона, даже если у проекта своя иконка', () => {
    const heads = new Set(['h1']);
    expect(iconFor({ sessionId: 'h1', cwd: '/p/own' }, { heads, cfg })).toBe(BUILTIN_HEAD_ICON);
  });

  it('head со своей иконкой в конфиге', () => {
    const own = mergeClaudeWtConfig({ windowIcons: { head: 'C:\\icons\\king.ico' } });
    expect(iconFor({ sessionId: 'h1', cwd: '' }, { heads: new Set(['h1']), cfg: own })).toBe('C:\\icons\\king.ico');
  });

  it('иконка проекта главнее иконки профиля', () => {
    expect(iconFor({ sessionId: 's', cwd: '/p/own' }, { heads: new Set(), cfg })).toBe('D:\\pics\\own.png');
  });

  it('без своей иконки — по профилю проекта, как у профилей wt', () => {
    expect(iconFor({ sessionId: 's', cwd: '/p/home' }, { heads: new Set(), cfg })).toBe('icons/popstas.ico');
    expect(iconFor({ sessionId: 's', cwd: '/p/exp' }, { heads: new Set(), cfg })).toBe('icons/expertizeme.ico');
  });

  it('сессия вне проектов — по общему профилю claudeWt.profile', () => {
    expect(iconFor({ sessionId: 's', cwd: '/p/elsewhere' }, { heads: new Set(), cfg })).toBe('icons/popstas.ico');
  });

  it('проект с явно пустым профилем — иконку не трогать', () => {
    expect(iconFor({ sessionId: 's', cwd: '/p/bare' }, { heads: new Set(), cfg })).toBe('');
  });

  it('профиль без иконки в карте — иконку не трогать', () => {
    const c = mergeClaudeWtConfig({ profile: 'Unknown', projects: [] });
    expect(iconFor({ sessionId: 's', cwd: '/x' }, { heads: new Set(), cfg: c })).toBe('');
  });

  it('свой профиль в конфиге дополняет встроенную карту, а не стирает её', () => {
    const c = mergeClaudeWtConfig({ windowIcons: { profiles: { mine: 'icons/mine.ico' } } });
    expect(c.windowIcons.profiles.mine).toBe('icons/mine.ico');
    expect(c.windowIcons.profiles.home).toBe('icons/popstas.ico');
  });
});

describe('resolveIconPath', () => {
  it('относительный путь — от корня репозитория', () => {
    expect(resolveIconPath('icons/crown.ico', 'C:\\repo')).toBe('C:\\repo/icons/crown.ico');
  });

  it('абсолютный путь не трогается', () => {
    expect(resolveIconPath('D:\\pics\\own.png', 'C:\\repo')).toBe('D:\\pics\\own.png');
    expect(resolveIconPath('C:/pics/own.png', 'C:\\repo')).toBe('C:/pics/own.png');
  });

  it('пусто — пусто', () => {
    expect(resolveIconPath('', 'C:\\repo')).toBe('');
  });
});

describe('headsDirFor', () => {
  it('рядом с sessionsFile, если не задан явно', () => {
    expect(headsDirFor(cfg)).toBe('V:/.ccfzf/heads');
  });

  it('явный headsDir главнее', () => {
    const c = mergeClaudeWtConfig({ sessionsFile: 'V:/.ccfzf.sessions.json', windowIcons: { headsDir: 'X:/heads' } });
    expect(headsDirFor(c)).toBe('X:/heads');
  });

  it('без sessionsFile — некуда смотреть', () => {
    expect(headsDirFor(mergeClaudeWtConfig({}))).toBe('');
  });
});

describe('planIcons', () => {
  it('новое окно получает иконку', () => {
    const { ops, next } = planIcons(new Map(), new Map([[1, 'a.ico']]), new Set([1]));
    expect(ops).toEqual([{ id: 1, path: 'a.ico' }]);
    expect(next.get(1)).toBe('a.ico');
  });

  it('та же иконка — без вызовов', () => {
    expect(planIcons(new Map([[1, 'a.ico']]), new Map([[1, 'a.ico']]), new Set([1])).ops).toEqual([]);
  });

  it('смена роли — новая иконка', () => {
    expect(planIcons(new Map([[1, 'a.ico']]), new Map([[1, 'crown.ico']]), new Set([1])).ops)
      .toEqual([{ id: 1, path: 'crown.ico' }]);
  });

  it('иконку больше не надо — снять, но только если ставили мы', () => {
    const { ops, next } = planIcons(new Map([[1, 'a.ico']]), new Map([[1, '']]), new Set([1]));
    expect(ops).toEqual([{ id: 1, path: '' }]);
    expect(next.has(1)).toBe(false);
    expect(planIcons(new Map(), new Map([[2, '']]), new Set([2])).ops).toEqual([]);
  });

  it('живое окно без сессии — снять', () => {
    expect(planIcons(new Map([[1, 'a.ico']]), new Map(), new Set([1])).ops).toEqual([{ id: 1, path: '' }]);
  });

  it('закрытое окно забывается без вызовов', () => {
    const { ops, next } = planIcons(new Map([[1, 'a.ico']]), new Map(), new Set());
    expect(ops).toEqual([]);
    expect(next.size).toBe(0);
  });
});
