import { describe, it, expect } from 'vitest';
import {
  BUILTIN_HEAD_ICON, resolveIconPath, iconFor, headsDirFor, planIcons, iconsSidecarPath, publishedIcons,
  projectIcons, headIcon,
} from './window-icons-helpers.js';
import { mergeClaudeWtConfig } from './daemon-helpers.js';

const cfg = mergeClaudeWtConfig({
  profile: 'popstas',
  sessionsFile: 'V:/.ccfzf.sessions.json',
  windowIcons: { profiles: { popstas: 'C:\\ico\\me.ico', home: 'C:\\ico\\me.ico', ExpertizeMe: 'C:\\ico\\exp.ico' } },
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
    expect(iconFor({ sessionId: 's', cwd: '/p/home' }, { heads: new Set(), cfg })).toBe('C:\\ico\\me.ico');
    expect(iconFor({ sessionId: 's', cwd: '/p/exp' }, { heads: new Set(), cfg })).toBe('C:\\ico\\exp.ico');
  });

  it('сессия вне проектов — по общему профилю claudeWt.profile', () => {
    expect(iconFor({ sessionId: 's', cwd: '/p/elsewhere' }, { heads: new Set(), cfg })).toBe('C:\\ico\\me.ico');
  });

  it('проект с явно пустым профилем — иконку не трогать', () => {
    expect(iconFor({ sessionId: 's', cwd: '/p/bare' }, { heads: new Set(), cfg })).toBe('');
  });

  it('профиль без иконки в карте — иконку не трогать', () => {
    const c = mergeClaudeWtConfig({ profile: 'Unknown', projects: [] });
    expect(iconFor({ sessionId: 's', cwd: '/x' }, { heads: new Set(), cfg: c })).toBe('');
  });

  it('встроенной карты профилей нет — без конфига дети без иконки', () => {
    const c = mergeClaudeWtConfig({ profile: 'popstas', projects: [{ name: 'home', cwd: '/p/home', profile: 'home' }] });
    expect(c.windowIcons.profiles).toEqual({});
    expect(iconFor({ sessionId: 's', cwd: '/p/home' }, { heads: new Set(), cfg: c })).toBe('');
  });

  it('карта профилей из конфига доходит как есть', () => {
    const c = mergeClaudeWtConfig({ windowIcons: { profiles: { mine: 'icons/mine.ico' } } });
    expect(c.windowIcons.profiles).toEqual({ mine: 'icons/mine.ico' });
  });
});

describe('resolveIconPath', () => {
  it('относительный путь — от корня репозитория, с разделителем корня', () => {
    expect(resolveIconPath('icons/crown.ico', 'C:\\repo')).toBe('C:\\repo\\icons\\crown.ico');
    expect(resolveIconPath('icons/crown.ico', '/srv/repo/')).toBe('/srv/repo/icons/crown.ico');
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

describe('iconsSidecarPath', () => {
  it('рядом с файлом состояния', () => {
    expect(iconsSidecarPath('C:/Users/p/AppData/Local/windows11-manager/claude-wt.json'))
      .toBe('C:/Users/p/AppData/Local/windows11-manager/window-icons.json');
  });

  it('без каталога — некуда', () => {
    expect(iconsSidecarPath('s')).toBe('');
    expect(iconsSidecarPath(undefined)).toBe('');
  });
});

describe('publishedIcons', () => {
  it('по sessionId, абсолютным путём; без иконки — пустая строка', () => {
    const sessions = [{ id: 1, sessionId: 'h' }, { id: 2, sessionId: 'c' }, { id: 3, sessionId: 'n' }];
    const wanted = new Map([[1, 'icons/crown.ico'], [2, 'C:\\ico\\w11m.ico'], [3, '']]);
    expect(publishedIcons(sessions, wanted, 'C:\\repo')).toEqual({
      h: 'C:\\repo\\icons\\crown.ico', c: 'C:\\ico\\w11m.ico', n: '',
    });
  });
});

describe('projectIcons', () => {
  // Строке без окна (история, проекты пикера) иконку решают так же, как окну
  // не-head сессии того же каталога: иначе одна сессия выглядела бы в списке
  // по-разному с окном и без него.
  it('cwd → абсолютный путь, как у окна сессии того же каталога', () => {
    const icons = projectIcons(cfg, 'C:\\repo');
    expect(icons).toEqual({
      '/p/home': 'C:\\ico\\me.ico',
      '/p/exp': 'C:\\ico\\exp.ico',
      '/p/own': 'D:\\pics\\own.png',
      // '/p/bare' — явно пустой профиль: и окну этого каталога иконки нет.
    });
  });

  it('относительный путь иконки — от корня репозитория', () => {
    const own = mergeClaudeWtConfig({ projects: [{ name: 'a', cwd: '/p/a', icon: 'icons/a.ico' }] });
    expect(projectIcons(own, 'C:\\repo')).toEqual({ '/p/a': 'C:\\repo\\icons\\a.ico' });
  });

  it('проект без иконки и без профиля с иконкой в карту не попадает', () => {
    const bare = mergeClaudeWtConfig({ projects: [{ name: 'a', cwd: '/p/a' }] });
    expect(projectIcons(bare, 'C:\\repo')).toEqual({});
  });
});

describe('выключенные иконки окон', () => {
  // Человек выключил иконки окнам — у строк без окна их тоже нет: иначе
  // история рисовала бы то, чего на экране нет ни у одного окна.
  it('ни иконок проектов, ни короны', () => {
    const off = mergeClaudeWtConfig({
      windowIcons: { enabled: false },
      projects: [{ name: 'a', cwd: '/p/a', icon: 'C:\\a.ico' }],
    });
    expect(projectIcons(off, 'C:\\repo')).toEqual({});
    expect(headIcon(off, 'C:\\repo')).toBe('');
  });
});

describe('headIcon', () => {
  it('встроенная корона — от корня репозитория', () => {
    expect(headIcon(mergeClaudeWtConfig({}), 'C:\\repo')).toBe('C:\\repo\\icons\\crown.ico');
  });

  it('своя корона из конфига — как есть', () => {
    const own = mergeClaudeWtConfig({ windowIcons: { head: 'C:\\icons\\king.ico' } });
    expect(headIcon(own, 'C:\\repo')).toBe('C:\\icons\\king.ico');
  });
});
