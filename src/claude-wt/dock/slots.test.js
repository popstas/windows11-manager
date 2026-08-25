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
    expect(dock.resolve(1)).toEqual({ id: 'aaa' });
    expect(logged).toContain('error');
  });

  it('закрытые сессии в слоты не идут, пока openOnly не снят', () => {
    const winMan = fakeWinMan([session({ id: 'dead', open: false }), session({ id: 'live' })]);
    const dock = createDock({ winMan, config: CONFIG, log: () => {} });
    expect(dock.resolve(1)).toEqual({ id: 'live' });
    expect(dock.resolve(2)).toEqual({ empty: true });
  });
});
