import { describe, it, expect, vi } from 'vitest';
import { indexSessions, indexBackgroundAgents, compareSessions, hasHookStamp } from './sessions-helpers.js';

const session = (over = {}) => ({
  id: 'a1', cwd: '/home/popstas/p', title: 'ccfzf', mtime: 100, live: false, ...over,
});

describe('indexSessions', () => {
  it('indexes sessions by title', () => {
    const index = indexSessions({ sessions: [session()] });
    expect(index.ccfzf).toEqual({ id: 'a1', cwd: '/home/popstas/p', title: 'ccfzf', ambiguous: false });
  });

  it('prefers a live session over a dead one with the same title', () => {
    const index = indexSessions({ sessions: [
      session({ id: 'dead', mtime: 500, live: false }),
      session({ id: 'live', mtime: 100, live: true }),
    ] });
    expect(index.ccfzf.id).toBe('live');
    expect(index.ccfzf.ambiguous).toBe(false);
  });

  it('prefers the newer session when liveness is equal', () => {
    const index = indexSessions({ sessions: [
      session({ id: 'old', mtime: 100 }),
      session({ id: 'new', mtime: 900 }),
    ] });
    expect(index.ccfzf.id).toBe('new');
  });

  it('marks a title ambiguous when the top two are indistinguishable', () => {
    const index = indexSessions({ sessions: [
      session({ id: 'x', mtime: 100, live: true }),
      session({ id: 'y', mtime: 100, live: true }),
    ] });
    expect(index.ccfzf.ambiguous).toBe(true);
  });

  it('skips entries without an id or a title', () => {
    const index = indexSessions({ sessions: [
      session({ id: '', title: 'no-id' }),
      session({ title: '', id: 'no-title' }),
      session({ id: 'ok', title: 'ok' }),
    ] });
    expect(Object.keys(index)).toEqual(['ok']);
  });

  it('indexes a decorated dump title under its bare form', () => {
    // В окне заголовок приходит со статус-глифом Claude Code, в дампе — без
    // него. Индекс ключуется той же формой, в которой заголовок сравнивается.
    const index = indexSessions({ sessions: [session({ title: '✳ ccfzf' })] });
    expect(index.ccfzf.id).toBe('a1');
    expect(index.ccfzf.title).toBe('✳ ccfzf');
  });

  it('treats decorated and bare spellings of one title as the same session', () => {
    const index = indexSessions({ sessions: [
      session({ id: 'x', title: '✳ ccfzf', mtime: 100, live: true }),
      session({ id: 'y', title: 'ccfzf', mtime: 100, live: true }),
    ] });
    expect(Object.keys(index)).toEqual(['ccfzf']);
    expect(index.ccfzf.ambiguous).toBe(true);
  });

  it('returns an empty index for a missing or malformed dump', () => {
    expect(indexSessions(null)).toEqual({});
    expect(indexSessions({})).toEqual({});
    expect(indexSessions({ sessions: 'nope' })).toEqual({});
  });

  it('берёт отметку активности из дампа и не ходит по сети', () => {
    const probe = vi.fn(() => 0);
    const index = indexSessions({ sessions: [
      { id: 'stale', title: 'ccfzf', cwd: '/p', mtime: 900, live: true, activityAt: 100 },
      { id: 'fresh', title: 'ccfzf', cwd: '/p', mtime: 100, live: false, activityAt: 900 },
    ] }, probe);
    expect(index.ccfzf.id).toBe('fresh');
    expect(probe).not.toHaveBeenCalled();
  });

  it('ранжирует по отметке из дампа и без сетевой функции вовсе', () => {
    // Читатель может быть позван без progressDir — раньше это значило
    // «сравнивать только по live и mtime», и работающая сессия с live: false
    // проигрывала мёртвой тёзке. Поле в дампе снимает и этот случай.
    const index = indexSessions({ sessions: [
      { id: 'stale', title: 'ccfzf', cwd: '/p', mtime: 900, live: true, activityAt: 100 },
      { id: 'fresh', title: 'ccfzf', cwd: '/p', mtime: 100, live: false, activityAt: 900 },
    ] });
    expect(index.ccfzf.id).toBe('fresh');
  });

  it('запись без отметки идёт в пробу, даже если у соседки по группе она есть', () => {
    // Смешанный дамп бывает между поколениями писателя. Откат к сети —
    // по-записочный: соседняя запись со своим activityAt не должна глушить
    // пробу для той, у которой поля нет.
    const probe = vi.fn(id => (id === 'none' ? 5000 : 0));
    const index = indexSessions({ sessions: [
      { id: 'has', title: 'ccfzf', cwd: '/p', mtime: 100, live: false, activityAt: 900 },
      { id: 'none', title: 'ccfzf', cwd: '/p', mtime: 900, live: true },
    ] }, probe);
    expect(index.ccfzf.id).toBe('none');
    expect(probe).toHaveBeenCalledWith('none');
    expect(probe).not.toHaveBeenCalledWith('has');
  });

  it('устаревшая отметка в дампе не побеждает свежую пробу у тёзки без поля', () => {
    // Ровно тот отказ, который давала групповая калитка: X несёт старый
    // activityAt, у Y поля нет вовсе, но Y работает прямо сейчас — и её
    // проба это подтверждает. Окно обязано уйти к Y, а не к X по умолчанию.
    const probe = vi.fn(id => (id === 'Y' ? 9000 : 0));
    const index = indexSessions({ sessions: [
      { id: 'X', title: 'ccfzf', cwd: '/p', mtime: 900, live: true, activityAt: 5 },
      { id: 'Y', title: 'ccfzf', cwd: '/p', mtime: 100, live: false },
    ] }, probe);
    expect(index.ccfzf.id).toBe('Y');
  });
});

describe('compareSessions', () => {
  it('returns 0 for sessions with equal liveness and mtime', () => {
    expect(compareSessions(session(), session({ id: 'b1' }))).toBe(0);
  });
});

describe('indexSessions with agent activity', () => {
  const dump = {
    sessions: [
      { id: 'stale', title: 'shared', cwd: '/a', live: true, mtime: 1000 },
      { id: 'working', title: 'shared', cwd: '/a', live: false, mtime: 2000 },
    ],
  };

  it('believes the hook over the dump when they disagree about who is alive', () => {
    // Measured 2026-08-01: two sessions shared the title `shared`, the one
    // actually running was marked live=false and a dead one carried
    // live=true. The hook fires on every tool call of a real agent, so a
    // fresh write from it outweighs any flag in the dump.
    const activity = id => (id === 'working' ? 5000 : 0);
    expect(indexSessions(dump, activity).shared.id).toBe('working');
  });

  it('falls back to the dump when the hook knows nothing', () => {
    expect(indexSessions(dump, () => 0).shared.id).toBe('stale');
    expect(indexSessions(dump).shared.id).toBe('stale');
  });

  it('prefers the more recent of two sessions the hook has seen', () => {
    const activity = id => (id === 'working' ? 9000 : 8000);
    expect(indexSessions(dump, activity).shared.id).toBe('working');
  });

  it('never asks about a title only one session claims', () => {
    // Every question is a stat over a network share; with no rival there is
    // nothing to decide.
    const asked = [];
    const one = { sessions: [{ id: 'solo', title: 'alone', cwd: '/a', live: true, mtime: 1 }] };
    indexSessions(one, id => { asked.push(id); return 0; });
    expect(asked).toEqual([]);
  });

  it('still reports a tie as ambiguous', () => {
    const tied = {
      sessions: [
        { id: 'a', title: 'same', cwd: '/x', live: true, mtime: 100 },
        { id: 'b', title: 'same', cwd: '/x', live: true, mtime: 100 },
      ],
    };
    expect(indexSessions(tied, () => 0).same.ambiguous).toBe(true);
  });
});

describe('indexSessions без activityAt в дампе', () => {
  const twin = (id, mtime, over = {}) => ({
    id, title: 'ExpertizeMe', cwd: '/p', mtime, live: false, ...over,
  });

  it('спрашивает про каждый id не больше одного раза за сборку, и сортировка остаётся верной', () => {
    // Раньше каждое сравнение внутри sort() било в сеть заново — 354
    // обращения на 200 сессий. mtime у всех троих одинаков нарочно: победителя
    // должна решать только проба, а не случайное совпадение с сортировкой по
    // mtime, — так тест ловит и сломанный порядок, а не только число вызовов.
    const stamps = { a: 100, b: 300, c: 200 };
    const probe = vi.fn(id => stamps[id] ?? 0);
    const index = indexSessions({ sessions: [twin('a', 1), twin('b', 1), twin('c', 1)] }, probe);
    expect(index.ExpertizeMe.id).toBe('b');
    expect(new Set(probe.mock.calls.map(c => c[0])).size).toBe(probe.mock.calls.length);
  });

  it('не спрашивает дважды и про пару, которую отдельно проверяет ambiguous', () => {
    // 'x' и 'y' делят одну пробу — ambiguous будет true, а вычисление этого
    // поля зовёт compare(best, second) ещё раз, отдельно от сортировки. Без
    // памятки это второй сетевой stat за ту же пару.
    const probe = vi.fn(() => 500);
    const index = indexSessions({ sessions: [twin('x', 1), twin('y', 1)] }, probe);
    expect(index.ExpertizeMe.ambiguous).toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(new Set(probe.mock.calls.map(c => c[0]))).toEqual(new Set(['x', 'y']));
  });
});

describe('background agents', () => {
  const bg = (over = {}) => session({
    id: 'child', kind: 'background', parent: 'a1', live: true, mtime: 200, ...over,
  });

  it('keeps a background agent out of the title index', () => {
    // Форк наследует заголовок родителя и работает вместо него, то есть по
    // любому признаку выигрывает окно, в котором его нет.
    const index = indexSessions({ sessions: [session(), bg()] });
    expect(index.ccfzf.id).toBe('a1');
  });

  it('leaves a title with nothing but background agents unindexed', () => {
    expect(indexSessions({ sessions: [bg()] })).toEqual({});
  });

  it('groups background agents under their parent, newest first', () => {
    const agents = indexBackgroundAgents({ sessions: [
      session(),
      bg({ id: 'old', mtime: 100 }),
      bg({ id: 'new', mtime: 900 }),
    ] });
    expect(agents.a1.map(a => a.id)).toEqual(['new', 'old']);
    expect(agents.a1[0]).toEqual({ id: 'new', title: 'ccfzf', live: true });
  });

  it('ignores a background agent whose parent is unknown', () => {
    expect(indexBackgroundAgents({ sessions: [bg({ parent: '' })] })).toEqual({});
  });

  it('yields nothing for a dump without agents', () => {
    expect(indexBackgroundAgents({ sessions: [session()] })).toEqual({});
    expect(indexBackgroundAgents(null)).toEqual({});
  });
});

describe('hasHookStamp', () => {
  // Общая калитка со stampOf (см. её докстринг) и с dumpNeedsHookStamps в
  // sessions.js — sessions.js своего условия не заводит, а зовёт эту же
  // функцию, так что расхождение между «нужны ли сетевые отметки» и «откуда
  // stampOf берёт число» структурно исключено, а не просто протестировано.
  it('верно для записи со своей отметкой, даже нулевой', () => {
    expect(hasHookStamp({ activityAt: 0 })).toBe(true);
    expect(hasHookStamp({ activityAt: 900 })).toBe(true);
  });

  it('ложно, когда отметки нет вовсе', () => {
    expect(hasHookStamp({})).toBe(false);
    expect(hasHookStamp({ activityAt: undefined })).toBe(false);
    expect(hasHookStamp({ activityAt: NaN })).toBe(false);
    expect(hasHookStamp(null)).toBe(false);
  });
});
