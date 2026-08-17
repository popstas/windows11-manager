import { describe, it, expect, vi } from 'vitest';
import { focusSpawnedWindow, resumeClaudeSession } from './project.js';

/**
 * Часы и ожидание — подставные: настоящие четыре секунды паузы проверяли бы
 * только терпение, а порядок «дождались окна → выждали расстановку → подняли»
 * виден лишь по журналу вызовов.
 */
function harness({ appearsAfterMs = 0, found = { id: 77 } } = {}) {
  const calls = [];
  let clock = 1000;
  return {
    calls,
    deps: {
      now: () => clock,
      wait: (ms) => { calls.push(`wait:${ms}`); clock += ms; return Promise.resolve(); },
      findWindow: (title) => {
        calls.push(`find:${title}`);
        return clock - 1000 >= appearsAfterMs ? found : null;
      },
      focus: (id) => { calls.push(`focus:${id}`); return Promise.resolve(true); },
      waitMs: 15000,
      pollMs: 250,
      settleMs: 4000,
    },
  };
}

describe('focusSpawnedWindow', () => {
  it('поднимает окно, появившееся сразу, — но не раньше паузы на расстановку', async () => {
    const h = harness();
    expect(await focusSpawnedWindow('skill-do', h.deps)).toBe(true);
    expect(h.calls).toEqual(['find:skill-do', 'wait:4000', 'focus:77']);
  });

  it('ждёт окно опросом, пока заголовок ставит запускающийся claude', async () => {
    const h = harness({ appearsAfterMs: 500 });
    expect(await focusSpawnedWindow('skill-do', h.deps)).toBe(true);
    expect(h.calls).toEqual([
      'find:skill-do', 'wait:250',
      'find:skill-do', 'wait:250',
      'find:skill-do', 'wait:4000',
      'focus:77',
    ]);
  });

  it('не поднимает ничего, если окно так и не появилось', async () => {
    const h = harness({ appearsAfterMs: Infinity });
    expect(await focusSpawnedWindow('skill-do', h.deps)).toBe(false);
    // Паузы на расстановку среди вызовов нет: поднимать нечего, и ждать нечего.
    expect(h.calls.filter(c => c === 'wait:4000')).toEqual([]);
    expect(h.calls.some(c => c.startsWith('focus:'))).toBe(false);
  });

  it('перестаёт ждать по таймауту, а не опрашивает вечно', async () => {
    const h = harness({ appearsAfterMs: Infinity });
    await focusSpawnedWindow('skill-do', h.deps);
    // 15 с ожидания тактом в 250 мс — шестьдесят опросов и ни одним больше.
    expect(h.calls.filter(c => c === 'wait:250').length).toBe(60);
  });
});

/**
 * Запуск и окна — подставные: настоящий терминал проверял бы наличие Windows, а
 * не то, что здесь важно, — какая команда собралась и какое окно поднялось.
 */
function resumeHarness({ cfg = {}, deps = {} } = {}) {
  const spawned = [];
  const focused = [];
  const seen = [];
  return {
    spawned,
    focused,
    seen,
    deps: {
      cfg: {
        launch: { args: ['ssh', '-t', 'pc-virt', 'ccfzf --session {id} --kiosk'] },
        projects: [{ name: 'em', cwd: '/home/popstas/projects/ExpertizeMe', profile: 'Work' }],
        ...cfg,
      },
      spawnProcess: (command, args) => {
        spawned.push({ command, args });
        return { unref: () => {} };
      },
      listWindows: () => [{ id: 11 }, { id: 22 }],
      waitForWindow: async (knownIds) => {
        seen.push([...knownIds]);
        return { id: 33 };
      },
      focus: async (windowId) => { focused.push(windowId); return true; },
      wait: async () => {},
      ...deps,
    },
  };
}

describe('resumeClaudeSession', () => {
  it('собирает команду возобновления из launch и профиля каталога', async () => {
    const h = resumeHarness();
    const res = await resumeClaudeSession(
      { id: '60a28071', cwd: '/home/popstas/projects/ExpertizeMe' },
      h.deps,
    );
    expect(res).toEqual({ ok: true, action: 'resume', sessionId: '60a28071' });
    expect(h.spawned).toEqual([{
      command: 'wt.exe',
      // Профиль подставлен по каталогу: собранная в пикере команда его теряет,
      // и ради этого просьба вообще ходит через менеджер.
      args: ['-w', '-1', '-p', 'Work', 'ssh', '-t', 'pc-virt', 'ccfzf --session 60a28071 --kiosk'],
    }]);
  });

  it('поднимает окно, которого не было среди терминалов до запуска', async () => {
    const h = resumeHarness();
    await resumeClaudeSession({ id: 'abc' }, h.deps);
    await vi.waitFor(() => expect(h.focused).toEqual([33]));
    // Список снят до spawn — иначе новое окно уже не отличить от старых.
    expect(h.seen).toEqual([[11, 22]]);
  });

  it('каталог без своего профиля не добавляет профильных аргументов', async () => {
    const h = resumeHarness();
    await resumeClaudeSession({ id: 'abc', cwd: '/home/popstas/projects/other' }, h.deps);
    expect(h.spawned[0].args).toEqual(['-w', '-1', 'ssh', '-t', 'pc-virt', 'ccfzf --session abc --kiosk']);
  });

  it('без id не запускает ничего: резюмировать нечего', async () => {
    const h = resumeHarness();
    expect(await resumeClaudeSession({ cwd: '/p/x' }, h.deps)).toEqual({
      ok: false, reason: 'id is required',
    });
    expect(h.spawned).toEqual([]);
  });

  it('упавший запуск возвращает отказ, а не тишину', async () => {
    const h = resumeHarness({
      deps: { spawnProcess: () => { throw new Error('wt.exe not found'); } },
    });
    expect(await resumeClaudeSession({ id: 'abc' }, h.deps)).toEqual({
      ok: false, action: 'spawn', reason: 'wt.exe not found',
    });
    expect(h.focused).toEqual([]);
  });

  it('старый конфиг с launch.command запускает им, а не реестром', async () => {
    const h = resumeHarness({
      cfg: { launch: { command: 'wt.exe', args: ['-w', '-1', 'ssh', '{id}'] } },
    });
    await resumeClaudeSession({ id: 'abc' }, h.deps);
    expect(h.spawned).toEqual([{ command: 'wt.exe', args: ['-w', '-1', 'ssh', 'abc'] }]);
  });
});
