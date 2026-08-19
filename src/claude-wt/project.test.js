import { describe, it, expect, vi } from 'vitest';
import { focusSpawnedWindow, focusNewTerminalWindow, resumeClaudeSession, cursorRule } from './project.js';

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
      place: (w, title) => { calls.push(`place:${w.id}:${title}`); return Promise.resolve(true); },
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
    // Место — раньше фокуса: окно, получившее ввод до переезда в свою
    // геометрию, читается как «открылось только сейчас», когда через секунду
    // прыгает на место.
    expect(h.calls).toEqual(['find:skill-do', 'wait:4000', 'place:77:skill-do', 'focus:77']);
  });

  it('ждёт окно опросом, пока заголовок ставит запускающийся claude', async () => {
    const h = harness({ appearsAfterMs: 500 });
    expect(await focusSpawnedWindow('skill-do', h.deps)).toBe(true);
    expect(h.calls).toEqual([
      'find:skill-do', 'wait:250',
      'find:skill-do', 'wait:250',
      'find:skill-do', 'wait:4000',
      'place:77:skill-do', 'focus:77',
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

/**
 * Экран для нового окна называет пикер — точкой курсора в теле просьбы.
 * Проверяется правило, а не постановка: `setBounds` на машине без Windows не
 * зовётся, а ошибка «окно уехало не на тот экран» видна только глазами.
 */
describe('cursorRule', () => {
  const mon = (area, scaleFactor = 1) => ({
    bounds: area,
    getWorkArea: () => area,
    getScaleFactor: () => scaleFactor,
  });
  const MON = mon({ x: 1920, y: 0, width: 2560, height: 1440 });
  const win = (bounds) => ({ id: 77, getBounds: () => bounds });

  it('без памяти о месте берёт размер у самого окна', () => {
    expect(cursorRule({
      win: win({ x: 0, y: 0, width: 1000, height: 800 }),
      cursor: { x: 2000, y: 100 },
      slot: null,
      monitorAt: () => MON,
    }).rule).toEqual({ window: 77, x: 1920 + 780, y: 320, width: 1000, height: 800 });
  });

  it('слот отдаёт размер, но не место: экран называет курсор', () => {
    // Слот — где окно стояло когда-то, курсор — куда человек попросил сейчас.
    // Победи слот, галка работала бы только у сессий, которых эта машина ещё не
    // видела: через раз и необъяснимо.
    const rule = cursorRule({
      win: win({ x: 0, y: 0, width: 300, height: 200 }),
      cursor: { x: 2000, y: 100 },
      slot: { bounds: { x: -1920, y: 0, width: 1200, height: 900 } },
      monitorAt: () => MON,
    });
    expect(rule.rule).toEqual({ window: 77, x: 1920 + 680, y: 270, width: 1200, height: 900 });
  });

  it('размер назван всегда — иначе переезд между экранами потерял бы масштаб', () => {
    // `adjustBoundsForScale` смотрит именно на то, назван ли размер в правиле.
    const rule = cursorRule({
      win: win({ x: 0, y: 0, width: 1000, height: 800 }),
      cursor: { x: 2000, y: 100 },
      slot: null,
      monitorAt: () => MON,
    });
    expect(rule.rule.width).toBe(1000);
    expect(rule.rule.height).toBe(800);
  });

  it('рабочая область переводится в пространство окна, а не берётся как есть', () => {
    // Два пространства координат: Monitor.getWorkArea() отдаёт числа как есть,
    // а Window.setBounds() умножает их на масштаб монитора. Без перевода окно
    // на мониторе с масштабом уезжает к соседу — та же поломка, что уже была у
    // плитки (AGENTS.md, «FancyZones coordinate system & DPI gotchas»).
    const rule = cursorRule({
      win: win({ x: 0, y: 0, width: 1000, height: 800 }),
      cursor: { x: 100, y: 100 },
      slot: null,
      monitorAt: () => mon({ x: 0, y: 0, width: 2893, height: 1728 }, 1.25),
    });
    // 2893/1.25 = 2314, 1728/1.25 = 1382 — и центр считается уже в них.
    expect(rule.rule).toEqual({ window: 77, x: 657, y: 291, width: 1000, height: 800 });
  });

  it('центр считается по рабочей области, а не по полным границам', () => {
    // Панель задач съедает низ экрана, и по полным границам окно уехало бы
    // вниз на половину её высоты.
    const rule = cursorRule({
      win: win({ x: 0, y: 0, width: 1000, height: 800 }),
      cursor: { x: 100, y: 100 },
      slot: null,
      monitorAt: () => ({
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        getWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1000 }),
        getScaleFactor: () => 1,
      }),
    });
    expect(rule.rule.y).toBe(100);
  });

  it('главный экран отличается от прочих — на нём пометки не будет', () => {
    // Пометка выключает окну автоматику, и на главном экране это выглядело бы
    // поломкой конфига: правила из `config.windows` там делают ровно то, чего
    // от них ждут. Отсутствие `isPrimary` читается как «главный» — сторона
    // осторожная.
    const at = (isPrimary) => cursorRule({
      win: win({ x: 0, y: 0, width: 1000, height: 800 }),
      cursor: { x: 2000, y: 100 },
      slot: null,
      monitorAt: () => ({ ...MON, isPrimary: () => isPrimary }),
    }).primary;
    expect(at(true)).toBe(true);
    expect(at(false)).toBe(false);
    expect(cursorRule({
      win: win({ x: 0, y: 0, width: 1000, height: 800 }),
      cursor: { x: 2000, y: 100 },
      slot: null,
      monitorAt: () => MON,
    }).primary).toBe(true);
  });

  it('точка вне известных мониторов не ставит окно наугад', () => {
    // Значит конфиг мониторов разошёлся с тем, что видит пикер. Главный экран
    // тут был бы худшим ответом: окно уехало бы с того, где смотрит человек.
    expect(cursorRule({
      win: win({ x: 0, y: 0, width: 1000, height: 800 }),
      cursor: { x: 99999, y: 99999 },
      slot: null,
      monitorAt: () => undefined,
    })).toBe(null);
  });

  it('окно без размеров не ставится: делить нечего', () => {
    expect(cursorRule({
      win: win({ x: 0, y: 0, width: 0, height: 0 }),
      cursor: { x: 2000, y: 100 },
      slot: null,
      monitorAt: () => MON,
    })).toBe(null);
  });
});

describe('focusNewTerminalWindow и курсор', () => {
  function deps(extra = {}) {
    return {
      waitForWindow: async () => ({ id: 33 }),
      focus: async () => true,
      wait: async () => {},
      ...extra,
    };
  }

  it('ставит окно на экран под курсором до фокуса', async () => {
    const calls = [];
    await focusNewTerminalWindow([], deps({
      placeAt: async (win, cursor) => { calls.push(`place:${win.id}:${cursor.x}`); return true; },
      focus: async (id) => { calls.push(`focus:${id}`); return true; },
      cursor: { x: 2000, y: 100 },
    }));
    // Порядок тот же и по той же причине, что у `focusSpawnedWindow`: окно,
    // получившее ввод раньше переезда, читается как «открылось только сейчас».
    expect(calls).toEqual(['place:33:2000', 'focus:33']);
  });

  it('без курсора не ставит ничего — прежнее поведение', async () => {
    const calls = [];
    await focusNewTerminalWindow([], deps({
      placeAt: async () => { calls.push('place'); return true; },
      focus: async (id) => { calls.push(`focus:${id}`); return true; },
    }));
    expect(calls).toEqual(['focus:33']);
  });
});
