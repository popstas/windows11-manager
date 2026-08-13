import { describe, it, expect } from 'vitest';
import { focusSpawnedWindow } from './project.js';

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
