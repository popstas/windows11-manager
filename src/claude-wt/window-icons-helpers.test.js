import { describe, it, expect } from 'vitest';
import {
  BUILTIN_HEAD_ICON, resolveIconPath, iconFor, headsDirFor, planIcons, iconsSidecarPath, publishedIcons,
  projectIcons, headIcon, headModeOf,
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
  const replace = mergeClaudeWtConfig({ ...cfg, windowIcons: { ...cfg.windowIcons, headMode: 'replace' } });

  it('head по умолчанию — иконка проекта и корона значком', () => {
    const heads = new Set(['h1']);
    expect(iconFor({ sessionId: 'h1', cwd: '/p/own' }, { heads, cfg }))
      .toEqual({ icon: 'D:\\pics\\own.png', overlay: BUILTIN_HEAD_ICON });
  });

  it('head без иконки проекта — только значок, иконку окна не трогать', () => {
    expect(iconFor({ sessionId: 'h1', cwd: '/p/bare' }, { heads: new Set(['h1']), cfg }))
      .toEqual({ icon: '', overlay: BUILTIN_HEAD_ICON });
  });

  it('head в режиме replace — корона вместо иконки, без значка', () => {
    expect(iconFor({ sessionId: 'h1', cwd: '/p/own' }, { heads: new Set(['h1']), cfg: replace }))
      .toEqual({ icon: BUILTIN_HEAD_ICON, overlay: '' });
  });

  it('head со своей иконкой в конфиге — она и значком, и заменой', () => {
    const own = mergeClaudeWtConfig({ windowIcons: { head: 'C:\\icons\\king.ico' } });
    expect(iconFor({ sessionId: 'h1', cwd: '' }, { heads: new Set(['h1']), cfg: own }))
      .toEqual({ icon: '', overlay: 'C:\\icons\\king.ico' });
    const ownReplace = mergeClaudeWtConfig({ windowIcons: { head: 'C:\\icons\\king.ico', headMode: 'replace' } });
    expect(iconFor({ sessionId: 'h1', cwd: '' }, { heads: new Set(['h1']), cfg: ownReplace }))
      .toEqual({ icon: 'C:\\icons\\king.ico', overlay: '' });
  });

  it('не-head — без значка в обоих режимах', () => {
    for (const c of [cfg, replace]) {
      expect(iconFor({ sessionId: 's', cwd: '/p/own' }, { heads: new Set(['h1']), cfg: c }))
        .toEqual({ icon: 'D:\\pics\\own.png', overlay: '' });
    }
  });

  it('иконка проекта главнее иконки профиля', () => {
    expect(iconFor({ sessionId: 's', cwd: '/p/own' }, { heads: new Set(), cfg })).toEqual({ icon: 'D:\\pics\\own.png', overlay: '' });
  });

  it('без своей иконки — по профилю проекта, как у профилей wt', () => {
    expect(iconFor({ sessionId: 's', cwd: '/p/home' }, { heads: new Set(), cfg })).toEqual({ icon: 'C:\\ico\\me.ico', overlay: '' });
    expect(iconFor({ sessionId: 's', cwd: '/p/exp' }, { heads: new Set(), cfg })).toEqual({ icon: 'C:\\ico\\exp.ico', overlay: '' });
  });

  it('сессия вне проектов — по общему профилю claudeWt.profile', () => {
    expect(iconFor({ sessionId: 's', cwd: '/p/elsewhere' }, { heads: new Set(), cfg })).toEqual({ icon: 'C:\\ico\\me.ico', overlay: '' });
  });

  it('проект с явно пустым профилем — иконку не трогать', () => {
    expect(iconFor({ sessionId: 's', cwd: '/p/bare' }, { heads: new Set(), cfg })).toEqual({ icon: '', overlay: '' });
  });

  it('профиль без иконки в карте — иконку не трогать', () => {
    const c = mergeClaudeWtConfig({ profile: 'Unknown', projects: [] });
    expect(iconFor({ sessionId: 's', cwd: '/x' }, { heads: new Set(), cfg: c })).toEqual({ icon: '', overlay: '' });
  });

  it('встроенной карты профилей нет — без конфига дети без иконки', () => {
    const c = mergeClaudeWtConfig({ profile: 'popstas', projects: [{ name: 'home', cwd: '/p/home', profile: 'home' }] });
    expect(c.windowIcons.profiles).toEqual({});
    expect(iconFor({ sessionId: 's', cwd: '/p/home' }, { heads: new Set(), cfg: c })).toEqual({ icon: '', overlay: '' });
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
  const A = { icon: 'a.ico' };
  const HEAD = { icon: 'a.ico', overlay: 'crown.ico' };

  it('новое окно получает иконку', () => {
    const { ops, next } = planIcons(new Map(), new Map([[1, A]]), new Set([1]));
    expect(ops).toEqual([{ id: 1, kind: 'icon', path: 'a.ico' }]);
    expect(next.get(1)).toEqual({ icon: 'a.ico' });
  });

  it('новое окно head — иконка проекта и значок', () => {
    const { ops, next } = planIcons(new Map(), new Map([[1, HEAD]]), new Set([1]));
    expect(ops).toEqual([
      { id: 1, kind: 'icon', path: 'a.ico' },
      { id: 1, kind: 'overlay', path: 'crown.ico' },
    ]);
    expect(next.get(1)).toEqual(HEAD);
  });

  it('то же самое — без вызовов', () => {
    expect(planIcons(new Map([[1, A]]), new Map([[1, A]]), new Set([1])).ops).toEqual([]);
    expect(planIcons(new Map([[1, HEAD]]), new Map([[1, HEAD]]), new Set([1])).ops).toEqual([]);
  });

  it('окно стало head — только значок, иконку не трогать', () => {
    expect(planIcons(new Map([[1, A]]), new Map([[1, HEAD]]), new Set([1])).ops)
      .toEqual([{ id: 1, kind: 'overlay', path: 'crown.ico' }]);
  });

  it('смена режима overlay → replace — иконка короной, значок снять', () => {
    expect(planIcons(new Map([[1, HEAD]]), new Map([[1, { icon: 'crown.ico', overlay: '' }]]), new Set([1])).ops)
      .toEqual([
        { id: 1, kind: 'icon', path: 'crown.ico' },
        { id: 1, kind: 'overlay', path: '' },
      ]);
  });

  it('иконку больше не надо — снять, но только если ставили мы', () => {
    const { ops, next } = planIcons(new Map([[1, A]]), new Map([[1, { icon: '', overlay: '' }]]), new Set([1]));
    expect(ops).toEqual([{ id: 1, kind: 'icon', path: '' }]);
    expect(next.has(1)).toBe(false);
    expect(planIcons(new Map(), new Map([[2, { icon: '', overlay: '' }]]), new Set([2])).ops).toEqual([]);
  });

  it('живое окно без сессии — снять и иконку, и значок', () => {
    expect(planIcons(new Map([[1, HEAD]]), new Map(), new Set([1])).ops).toEqual([
      { id: 1, kind: 'icon', path: '' },
      { id: 1, kind: 'overlay', path: '' },
    ]);
  });

  it('закрытое окно забывается без вызовов', () => {
    const { ops, next } = planIcons(new Map([[1, HEAD]]), new Map(), new Set());
    expect(ops).toEqual([]);
    expect(next.size).toBe(0);
  });
});

describe('headModeOf', () => {
  it('умолчание и мусор — overlay, replace — replace', () => {
    expect(headModeOf(mergeClaudeWtConfig({}))).toBe('overlay');
    expect(headModeOf(mergeClaudeWtConfig({ windowIcons: { headMode: 'nonsense' } }))).toBe('overlay');
    expect(headModeOf(mergeClaudeWtConfig({ windowIcons: { headMode: 'replace' } }))).toBe('replace');
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
    const wanted = new Map([
      [1, { icon: 'icons/crown.ico', overlay: '' }], [2, { icon: 'C:\\ico\\w11m.ico', overlay: '' }], [3, { icon: '', overlay: '' }],
    ]);
    expect(publishedIcons(sessions, wanted, 'C:\\repo')).toEqual({
      h: 'C:\\repo\\icons\\crown.ico', c: 'C:\\ico\\w11m.ico', n: '',
    });
  });

  it('head со значком — читателю иконка проекта, корона только на панели задач', () => {
    const sessions = [{ id: 1, sessionId: 'h' }];
    const wanted = new Map([[1, { icon: 'C:\\ico\\home.ico', overlay: 'icons/crown.ico' }]]);
    expect(publishedIcons(sessions, wanted, 'C:\\repo')).toEqual({ h: 'C:\\ico\\home.ico' });
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
  it('режим overlay (умолчание) — пусто: закрытый head в истории идёт с иконкой проекта', () => {
    expect(headIcon(mergeClaudeWtConfig({}), 'C:\\repo')).toBe('');
    expect(headIcon(mergeClaudeWtConfig({ windowIcons: { head: 'C:\\icons\\king.ico' } }), 'C:\\repo')).toBe('');
  });

  it('режим replace — встроенная корона от корня репозитория', () => {
    expect(headIcon(mergeClaudeWtConfig({ windowIcons: { headMode: 'replace' } }), 'C:\\repo'))
      .toBe('C:\\repo\\icons\\crown.ico');
  });

  it('режим replace — своя корона из конфига как есть', () => {
    const own = mergeClaudeWtConfig({ windowIcons: { head: 'C:\\icons\\king.ico', headMode: 'replace' } });
    expect(headIcon(own, 'C:\\repo')).toBe('C:\\icons\\king.ico');
  });
});
