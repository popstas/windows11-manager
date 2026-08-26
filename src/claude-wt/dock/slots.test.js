// src/claude-wt/dock/slots.test.js
import { describe, it, expect } from 'vitest';
import { createDock } from './slots.js';

const session = (over = {}) => ({
  id: 'aaa',
  title: 'alpha',
  cwd: '/home/popstas/projects/js/alpha',
  open: true,
  agentState: 'active',
  agentContextPct: 10,
  lastActivity: 100,
  ...over,
});

function fakeWinMan(sessions) {
  const calls = { count: 0 };
  return {
    calls,
    claudeWtSessions() {
      calls.count += 1;
      return { ok: true, sessions };
    },
  };
}

const CONFIG = { streamdock: { enabled: true, slots: 3, interval: 10 } };

describe('createDock', () => {
  it('блока streamdock нет — доски нет вовсе', () => {
    // Роуты заводятся по наличию доски: без блока в конфиге сервер о них не
    // должен знать, а не отвечать пустыми картинками.
    expect(createDock({ winMan: fakeWinMan([]), config: {}, log: () => {} })).toBe(null);
    expect(createDock({ winMan: fakeWinMan([]), config: { streamdock: { enabled: false } }, log: () => {} })).toBe(null);
  });

  it('снимок живёт свой интервал и не перечитывает дамп на каждую кнопку', () => {
    // Пять кнопок опрашивают картинку каждая по своему таймеру; чтение дампа
    // на каждый запрос означало бы пять чтений сетевого диска подряд.
    let now = 1000;
    const winMan = fakeWinMan([session()]);
    const dock = createDock({ winMan, config: CONFIG, log: () => {}, now: () => now });

    dock.slots();
    dock.slots();
    expect(winMan.calls.count).toBe(1);

    now += 9999;
    dock.slots();
    expect(winMan.calls.count).toBe(1);

    now += 2;
    dock.slots();
    expect(winMan.calls.count).toBe(2);
  });

  it('картинка и нажатие приходят из одного снимка', () => {
    // Главное свойство модуля: иначе кнопка поднимет не ту сессию, которая на
    // ней нарисована.
    let now = 1000;
    const sessions = [session({ id: 'first', title: 'first' })];
    const winMan = {
      claudeWtSessions: () => ({ ok: true, sessions }),
    };
    const dock = createDock({ winMan, config: CONFIG, log: () => {}, now: () => now });

    expect(dock.svg(1)).toContain('first');
    sessions[0] = session({ id: 'second', title: 'second' });
    expect(dock.resolve(1)).toEqual({ id: 'first' });
  });

  it('нажатие не перечитывает протухший снимок — кнопка значит то, что на ней нарисовано', () => {
    // Кнопку жмут не в момент отрисовки: к нажатию срок годности снимка обычно
    // уже истёк. Перечитай его resolve — и при `sort: recent` (умолчание)
    // порядок пересобрала бы любая активность между картинкой и пальцем:
    // поднялось бы соседнее окно, молча.
    let now = 1000;
    const sessions = [session({ id: 'first', title: 'first', lastActivity: 200 })];
    const winMan = fakeWinMan(sessions);
    const dock = createDock({ winMan, config: CONFIG, log: () => {}, now: () => now });

    expect(dock.svg(1)).toContain('first'); // доска нарисовала кнопку этим снимком
    sessions.unshift(session({ id: 'second', title: 'second', lastActivity: 300 }));

    now += 20000; // снимок протух, порядок сессий изменился
    expect(dock.resolve(1)).toEqual({ id: 'first' });
    expect(winMan.calls.count).toBe(1); // и дамп ради нажатия не читался

    // Новую сессию кнопка назовёт только после того, как её перерисуют.
    expect(dock.svg(1)).toContain('second');
    expect(dock.resolve(1)).toEqual({ id: 'second' });
  });

  it('снимка не было ни разу — нажатие строит его само, а не отвечает пустотой', () => {
    // Обратная сторона правила выше: до первой отданной картинки показывать
    // нечего, и отказ был бы мёртвой кнопкой на свежезапущенной службе.
    const winMan = fakeWinMan([session({ id: 'only' })]);
    const dock = createDock({ winMan, config: CONFIG, log: () => {} });
    expect(dock.resolve(1)).toEqual({ id: 'only' });
    expect(winMan.calls.count).toBe(1);
  });

  it('пустой слот — не ошибка, а пустая кнопка', () => {
    const dock = createDock({ winMan: fakeWinMan([]), config: CONFIG, log: () => {} });
    expect(dock.resolve(2)).toEqual({ empty: true });
    expect(dock.svg(2)).toContain('#141416');
  });

  it('номер вне диапазона — null у обеих дорог', () => {
    // Это опечатка в настройке кнопки, и молчать о ней нельзя: сервер отвечает
    // на null четырёхсотчетвёркой.
    const dock = createDock({ winMan: fakeWinMan([session()]), config: CONFIG, log: () => {} });
    expect(dock.svg(0)).toBe(null);
    expect(dock.svg(4)).toBe(null);
    expect(dock.resolve(4)).toBe(null);
    expect(dock.count).toBe(3);
  });

  it('дамп не прочитался — держим прежний снимок, а не гасим кнопки', () => {
    let ok = true;
    const winMan = { claudeWtSessions: () => (ok ? { ok: true, sessions: [session()] } : { ok: false, reason: 'нет файла' }) };
    let now = 1000;
    const logged = [];
    const dock = createDock({ winMan, config: CONFIG, log: (m, lvl) => logged.push(lvl), now: () => now });

    expect(dock.resolve(1)).toEqual({ id: 'aaa' });
    ok = false;
    now += 20000;
    // Перечитывает снимок тот, кто рисует: resolve сроку годности не подчиняется.
    dock.svg(1);
    expect(dock.resolve(1)).toEqual({ id: 'aaa' });
    expect(logged).toContain('error');
  });

  it('закрытые сессии в слоты не идут, пока openOnly не снят', () => {
    const winMan = fakeWinMan([session({ id: 'dead', open: false }), session({ id: 'live' })]);
    const dock = createDock({ winMan, config: CONFIG, log: () => {} });
    expect(dock.resolve(1)).toEqual({ id: 'live' });
    expect(dock.resolve(2)).toEqual({ empty: true });
  });

  it('без явных ключей в блоке — умолчания 5 слотов, 10 секунд и порядок recent', () => {
    let now = 1000;
    const sessions = [
      session({ id: 'old', title: 'old', lastActivity: 100 }),
      session({ id: 'new', title: 'new', lastActivity: 200 }),
    ];
    const winMan = fakeWinMan(sessions);
    const dock = createDock({ winMan, config: { streamdock: { enabled: true } }, log: () => {}, now: () => now });

    expect(dock.count).toBe(5);
    // recent ставит в первый слот самую свежую по lastActivity сессию.
    expect(dock.resolve(1)).toEqual({ id: 'new' });
    expect(winMan.calls.count).toBe(1);

    // Срок годности спрашивают у рисующей дороги: resolve() снимок не двигает.
    now += 9999;
    dock.slots();
    expect(winMan.calls.count).toBe(1); // снимок ещё не протух — умолчание 10 секунд, а не 0

    now += 2;
    dock.slots();
    expect(winMan.calls.count).toBe(2);
  });

  it('sessionsSort — алиас для sort, скопированный из блока homeassistant, должен работать так же', () => {
    // Порядок различает alpha/bravo не по алфавиту 'name', а по lastActivity
    // 'recent' (умолчание) — иначе алиас не отличить от того, что сработало бы
    // и без него.
    const sessions = [
      session({ id: 'alpha-session', title: 'alpha', lastActivity: 100 }),
      session({ id: 'bravo-session', title: 'bravo', lastActivity: 200 }),
    ];
    const winMan = fakeWinMan(sessions);
    const dock = createDock({
      winMan,
      config: { streamdock: { enabled: true, sessionsSort: 'name' } },
      log: () => {},
    });
    expect(dock.resolve(1)).toEqual({ id: 'alpha-session' });
  });

  it('sort и sessionsSort заданы одновременно — побеждает sort', () => {
    const sessions = [
      session({ id: 'alpha-session', title: 'alpha', lastActivity: 100 }),
      session({ id: 'bravo-session', title: 'bravo', lastActivity: 200 }),
    ];
    const winMan = fakeWinMan(sessions);
    const dock = createDock({
      winMan,
      config: { streamdock: { enabled: true, sort: 'recent', sessionsSort: 'name' } },
      log: () => {},
    });
    // sort='recent' обязан перебить sessionsSort='name': в первом слоте — самая
    // свежая сессия, а не первая по алфавиту.
    expect(dock.resolve(1)).toEqual({ id: 'bravo-session' });
  });

  it('interval: 0 — снимок перечитывается на каждом обращении, а не единожды', () => {
    // Явный ноль — это «каждый раз заново», а не «интервал не задан»: `||`
    // спутал бы его с умолчанием в 10 секунд.
    const winMan = fakeWinMan([session()]);
    const dock = createDock({ winMan, config: { streamdock: { enabled: true, slots: 3, interval: 0 } }, log: () => {} });
    dock.slots();
    dock.slots();
    expect(winMan.calls.count).toBe(2);
  });

  it('slots: 0 — честный ноль, доска фактически выключена, а не умолчание', () => {
    const dock = createDock({ winMan: fakeWinMan([session()]), config: { streamdock: { enabled: true, slots: 0 } }, log: () => {} });
    expect(dock.count).toBe(0);
    expect(dock.resolve(1)).toBe(null);
    expect(dock.svg(1)).toBe(null);
  });

  it('мусорное или отрицательное значение slots — откатывается к умолчанию 5', () => {
    expect(createDock({ winMan: fakeWinMan([]), config: { streamdock: { enabled: true, slots: 'abc' } }, log: () => {} }).count).toBe(5);
    expect(createDock({ winMan: fakeWinMan([]), config: { streamdock: { enabled: true, slots: -1 } }, log: () => {} }).count).toBe(5);
  });

  it('дробное значение slots усекается до целого, а не проходит наружу как есть', () => {
    expect(createDock({ winMan: fakeWinMan([]), config: { streamdock: { enabled: true, slots: 3.7 } }, log: () => {} }).count).toBe(3);
  });
});
