import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BELL_CHILDREN_FILE, BELL_FLAG_OFF, BELL_FLAG_CHILDREN_OFF, BELL_HEADER, GLYPH_RANGES,
  BELL_QUIET_FILE, BELL_QUIET_HEADER, bellQuietKeys,
  bellTitleKey, childSessionIds, bellChildKeys, bellChildrenText, childrenDirFor,
} from './bell-children-helpers.js';

const LUA = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'wezterm', 'wezterm.lua'), 'utf8');
const CASES = JSON.parse(fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'wezterm', 'bell-title-cases.json'), 'utf8'));

describe('bellTitleKey', () => {
  // Общая таблица с прогоном wezterm.lua (bell-lua.test.js): одно правило на обе стороны.
  it.each(CASES.map(c => [c.title, c.key]))('%j → %j', (title, key) => {
    expect(bellTitleKey(title)).toBe(key);
  });

  it('не строка — пустой ключ', () => {
    expect(bellTitleKey(undefined)).toBe('');
    expect(bellTitleKey(null)).toBe('');
  });
});

describe('контракт имён с wezterm.lua и пикером', () => {
  it('флаги режима — ровно два имени из дизайна', () => {
    expect(BELL_FLAG_OFF).toBe('.wezterm-bell-off');
    expect(BELL_FLAG_CHILDREN_OFF).toBe('.wezterm-bell-children-off');
  });

  it('wezterm.lua называет в путях ровно флаги и оба файла списков', () => {
    // Только строки пути вида '/.wezterm-bell…' — имя в комментарии не в счёт.
    const names = new Set([...LUA.matchAll(/'\/(\.wezterm-bell[a-z-]*)'/g)].map(m => m[1]));
    expect([...names].sort())
      .toEqual([BELL_CHILDREN_FILE, BELL_QUIET_FILE, BELL_FLAG_CHILDREN_OFF, BELL_FLAG_OFF].sort());
  });

  it('заголовок файла списка в lua тот же', () => {
    const m = LUA.match(/BELL_CHILDREN_HEADER = '([^']+)'/);
    expect(m?.[1]).toBe(BELL_HEADER);
  });

  it('заголовок списка тихих в lua тот же', () => {
    expect(BELL_QUIET_FILE).toBe('.wezterm-bell-quiet');
    const m = LUA.match(/BELL_QUIET_HEADER = '([^']+)'/);
    expect(m?.[1]).toBe(BELL_QUIET_HEADER);
    expect(BELL_QUIET_HEADER).toBe('# wezterm-bell-quiet');
  });

  it('таблица глифов в lua совпадает с js', () => {
    const block = LUA.match(/local BELL_GLYPHS = \{([^}]*(?:\}[^}]*)*?)\n\}/)?.[1] ?? '';
    const pairs = [...block.matchAll(/\{\s*(0x[0-9A-Fa-f]+)\s*,\s*(0x[0-9A-Fa-f]+)\s*\}/g)]
      .map(m => [Number(m[1]), Number(m[2])]);
    expect(pairs).toEqual(GLYPH_RANGES);
  });
});

describe('childSessionIds', () => {
  const now = 10_000_000;
  it('каталог детей и местный реестр вместе', () => {
    const ids = childSessionIds(new Set(['a', 'b']), [
      { sessionId: 'c', headId: 'h', windowId: 1, at: now - 1000 },
    ], now);
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
  });

  it('старая (дольше 10 минут), битая и без head запись реестра — не ребёнок', () => {
    // Ребёнка могли снять из каталога (head adopt), а реестр живёт неделю.
    const ids = childSessionIds(new Set(), [
      { sessionId: 'old', headId: 'h', windowId: 1, at: now - 11 * 60_000 },
      { sessionId: 'nohead', windowId: 2, at: now - 1000 },
      { sessionId: 'x' },
      null,
    ], now);
    expect([...ids]).toEqual([]);
  });
});

describe('bellChildKeys', () => {
  const now = 10_000_000;
  const win = (id, title) => ({ id, title });

  it('ключ окна дочерней сессии, найденной по sessionId', () => {
    const keys = bellChildKeys({
      windows: [win(1, '✳ kid'), win(2, '✳ boss')],
      sessions: [{ id: 1, sessionId: 'k' }, { id: 2, sessionId: 'b' }],
      children: new Set(['k']),
      registry: [],
      now,
    });
    expect(keys).toEqual(['kid']);
  });

  it('заголовок берётся у окна, а не из имени: переименованный ребёнок', () => {
    const keys = bellChildKeys({
      windows: [win(1, '⠂ renamed-kid')],
      sessions: [{ id: 1, sessionId: 'k' }],
      children: new Set(['k']),
      registry: [],
      now,
    });
    expect(keys).toEqual(['renamed-kid']);
  });

  it('тёзка не-ребёнок — ключ не пишется: head не должен замолчать', () => {
    const keys = bellChildKeys({
      windows: [win(1, '✳ same'), win(2, 'same'), win(3, 'popstas | ✳ same')],
      sessions: [{ id: 1, sessionId: 'k' }, { id: 2, sessionId: 'h' }],
      children: new Set(['k']),
      registry: [],
      now,
    });
    expect(keys).toEqual([]);
  });

  it('окно без привязки с тем же ключом тоже блокирует', () => {
    const keys = bellChildKeys({
      windows: [win(1, '✳ same'), win(2, 'same')],
      sessions: [{ id: 1, sessionId: 'k' }],
      children: new Set(['k']),
      registry: [],
      now,
    });
    expect(keys).toEqual([]);
  });

  it('пустой ключ не пишется', () => {
    const keys = bellChildKeys({
      windows: [win(1, '   ')],
      sessions: [{ id: 1, sessionId: 'k' }],
      children: new Set(['k']),
      registry: [],
      now,
    });
    expect(keys).toEqual([]);
  });

  it('свежий ребёнок из реестра — по его hwnd, до привязки демоном', () => {
    const keys = bellChildKeys({
      windows: [win(7, 'fresh-kid')],
      sessions: [],
      children: new Set(),
      registry: [{ sessionId: 'f', headId: 'h', windowId: 7, at: now - 60_000 }],
      now,
    });
    expect(keys).toEqual(['fresh-kid']);
  });

  it('hwnd реестра не верится, если окно привязано к другой сессии', () => {
    const keys = bellChildKeys({
      windows: [win(7, 'boss')],
      sessions: [{ id: 7, sessionId: 'other' }],
      children: new Set(),
      registry: [{ sessionId: 'f', headId: 'h', windowId: 7, at: now - 60_000 }],
      now,
    });
    expect(keys).toEqual([]);
  });

  it('hwnd старой записи реестра не верится: Windows переиспользует хэндлы', () => {
    const keys = bellChildKeys({
      windows: [win(7, 'stranger')],
      sessions: [],
      children: new Set(),
      registry: [{ sessionId: 'f', headId: 'h', windowId: 7, at: now - 3600_000 }],
      now,
    });
    expect(keys).toEqual([]);
  });

  it('ключи без повторов и по порядку', () => {
    const keys = bellChildKeys({
      windows: [win(1, 'b-kid'), win(2, '✳ a-kid'), win(3, '⠐ a-kid')],
      sessions: [{ id: 1, sessionId: 'b' }, { id: 2, sessionId: 'a' }, { id: 3, sessionId: 'a2' }],
      children: new Set(['a', 'a2', 'b']),
      registry: [],
      now,
    });
    expect(keys).toEqual(['a-kid', 'b-kid']);
  });
});

describe('bellChildrenText', () => {
  it('первая строка — заголовок со временем в секундах, дальше по ключу на строку', () => {
    expect(bellChildrenText(['a', 'b'], 1795650000)).toBe(`${BELL_HEADER} 1795650000\na\nb\n`);
  });

  it('без детей — только заголовок', () => {
    expect(bellChildrenText([], 5)).toBe(`${BELL_HEADER} 5\n`);
  });
});

describe('childrenDirFor', () => {
  it('рядом с sessionsFile, как каталог меток head', () => {
    expect(childrenDirFor({ sessionsFile: 'V:/.ccfzf.sessions.json' })).toBe('V:/.ccfzf/children');
  });

  it('без sessionsFile — пусто', () => {
    expect(childrenDirFor({})).toBe('');
  });
});

describe('bellQuietKeys', () => {
  it('ключи тихих окон по сырому заголовку, отсортированы', () => {
    const windows = [{ id: 1, title: '✳ pf-inbox-head' }, { id: 2, title: 'kp-agent-head' }, { id: 3, title: 'boss' }];
    expect(bellQuietKeys({ windows, quiet: new Set([2, 1]) })).toEqual(['kp-agent-head', 'pf-inbox-head']);
  });

  it('тёзка не тихий — ключа нет: его вопрос иначе замолчал бы', () => {
    const windows = [{ id: 1, title: '✳ head' }, { id: 2, title: '⠂ head' }];
    expect(bellQuietKeys({ windows, quiet: new Set([1]) })).toEqual([]);
    expect(bellQuietKeys({ windows, quiet: new Set([1, 2]) })).toEqual(['head']);
  });

  it('пустой заголовок и пустые входы — ничего', () => {
    expect(bellQuietKeys({ windows: [{ id: 1, title: '   ' }], quiet: new Set([1]) })).toEqual([]);
    expect(bellQuietKeys({})).toEqual([]);
  });

  it('текст файла — тот же формат с заголовком тихих', () => {
    expect(bellChildrenText(['a'], 7, BELL_QUIET_HEADER)).toBe('# wezterm-bell-quiet 7\na\n');
  });
});
