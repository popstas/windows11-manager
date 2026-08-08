import { describe, it, expect } from 'vitest';
import {
  createClaudeWtWatchdog,
  CHECK_INTERVAL_MS,
  REMEDY_COOLDOWN_MS,
  DEFAULT_SILENCE_MS,
  DEFAULT_GRACE_MS,
} from './watchdog.js';

function harness({ healthy, reason = 'stale', ageMs = 70000, ...over }) {
  const logs = [];
  let remedies = 0;
  let now = 1000000;
  const check = createClaudeWtWatchdog({
    status: () => ({
      running: true, startedAt: 0, lastTickAt: 1, tickFailures: 7, lastTickError: 'EBUSY',
    }),
    health: () => ({ healthy, reason, ageMs }),
    remedy: () => { remedies += 1; },
    log: (msg) => { logs.push(msg); },
    now: () => now,
    ...over,
  });
  return {
    check,
    logs,
    remedies: () => remedies,
    advance: (ms) => { now += ms; },
  };
}

describe('createClaudeWtWatchdog', () => {
  it('здоровый демон не даёт ни строки, ни лечения', () => {
    const h = harness({ healthy: true, reason: 'ok', ageMs: 500 });
    expect(h.check()).toBe(false);
    expect(h.logs).toEqual([]);
    expect(h.remedies()).toBe(0);
  });

  it('больной демон логируется и лечится', () => {
    const h = harness({ healthy: false });
    expect(h.check()).toBe(true);
    expect(h.remedies()).toBe(1);
    expect(h.logs.some(m => m.includes('stale'))).toBe(true);
    expect(h.logs.some(m => m.includes('EBUSY'))).toBe(true);
    // Именно счётчик падений, а не любая семёрка: «70s назад» в той же строке
    // делал прежнюю проверку на '7' истинной сам по себе.
    expect(h.logs.some(m => m.includes('падений подряд 7'))).toBe(true);
    expect(h.logs.some(m => m.includes('последний тик 70s назад'))).toBe(true);
  });

  it('внутри кулдауна лечение не повторяется, но диагноз пишется каждый раз', () => {
    const h = harness({ healthy: false });
    h.check();
    const afterFirst = h.logs.length;
    h.advance(CHECK_INTERVAL_MS);
    expect(h.check()).toBe(false);
    expect(h.remedies()).toBe(1);
    expect(h.logs.length).toBeGreaterThan(afterFirst);
  });

  it('после кулдауна лечение повторяется', () => {
    const h = harness({ healthy: false });
    h.check();
    h.advance(REMEDY_COOLDOWN_MS + 1);
    expect(h.check()).toBe(true);
    expect(h.remedies()).toBe(2);
  });

  it('без возраста тика строка не врёт про «0s назад»', () => {
    // Остановленный демон: startedAt обнулён, возраста у последнего тика нет.
    const h = harness({ healthy: false, reason: 'not running', ageMs: 0 });
    h.check();
    const line = h.logs[0];
    expect(line).toContain('not running');
    expect(line).not.toContain('назад');
    expect(line).toContain('падений подряд 7');
  });

  it('без счётчиков падений строка о них молчит', () => {
    // Статус, собранный из опубликованного файла окон: счётчиков тиков там нет,
    // и «падений подряд 0, последняя ошибка: —» выглядел бы диагнозом, которого
    // никто не ставил.
    const h = harness({
      healthy: false,
      status: () => ({ running: true, startedAt: 0, lastTickAt: 1, tickFailures: 0, lastTickError: '' }),
    });
    h.check();
    expect(h.logs[0]).not.toContain('падений подряд');
    expect(h.logs[0]).toContain('последний тик 70s назад');
  });

  it('лечение получает тот самый статус, по которому поставлен диагноз', () => {
    // Снять процесс можно только по pid, а pid приезжает в статусе: лечение,
    // вызванное без него, шло бы за ним второй раз и могло бы прочитать уже
    // другой файл.
    const seen = [];
    const h = harness({ healthy: false, remedy: (s) => seen.push(s) });
    h.check();
    expect(seen[0]).toMatchObject({ running: true, tickFailures: 7 });
  });

  it('диагноз получает те самые поля статуса и пороги', () => {
    // Опечатка в имени поля (lastTick вместо lastTickAt) или потерянный порог
    // проходили мимо всех прежних проверок: health() их просто игнорировал.
    const seen = [];
    const check = createClaudeWtWatchdog({
      status: () => ({
        running: true, startedAt: 111, lastTickAt: 222, tickFailures: 0, lastTickError: '',
      }),
      health: (args) => { seen.push(args); return { healthy: true, reason: 'ok', ageMs: 1 }; },
      remedy: () => {},
      log: () => {},
      now: () => 999,
      silenceMs: 1234,
      graceMs: 5678,
    });
    check();
    expect(seen).toEqual([{
      running: true,
      lastTickAt: 222,
      startedAt: 111,
      nowMs: 999,
      silenceMs: 1234,
      graceMs: 5678,
    }]);
  });

  it('пороги от библиотеки без них подменяются запасными', () => {
    // Так выглядит библиотека постарше: TICK_SILENCE_MS/TICK_GRACE_MS
    // отсутствуют, и без запасных значений сравнения с undefined всегда ложны —
    // сторож считал бы демона здоровым вечно.
    const seen = [];
    const check = createClaudeWtWatchdog({
      status: () => ({ running: true, startedAt: 0, lastTickAt: 0, tickFailures: 0, lastTickError: '' }),
      health: (args) => { seen.push(args); return { healthy: true, reason: 'ok', ageMs: 0 }; },
      remedy: () => {},
      log: () => {},
      silenceMs: undefined,
      graceMs: undefined,
    });
    check();
    expect(seen[0].silenceMs).toBe(DEFAULT_SILENCE_MS);
    expect(seen[0].graceMs).toBe(DEFAULT_GRACE_MS);
    expect(DEFAULT_SILENCE_MS > 0 && DEFAULT_GRACE_MS > 0).toBe(true);
  });

  it('упавший status() не роняет сторожа и попадает в лог', () => {
    const logs = [];
    const check = createClaudeWtWatchdog({
      status: () => { throw new Error('config gone'); },
      health: () => ({ healthy: false, reason: 'stale', ageMs: 1 }),
      remedy: () => { throw new Error('лечение звать нельзя'); },
      log: (msg, level) => { logs.push([msg, level]); },
    });
    expect(check()).toBe(false);
    expect(logs.some(([m]) => m.includes('config gone'))).toBe(true);
    expect(logs[0][1]).toBe('error');
  });

  it('упавший health() тоже перехватывается', () => {
    const logs = [];
    const check = createClaudeWtWatchdog({
      status: () => ({ running: true, startedAt: 0, lastTickAt: 0, tickFailures: 0, lastTickError: '' }),
      health: () => { throw new TypeError('winMan.claudeWtHealth is not a function'); },
      remedy: () => { throw new Error('лечение звать нельзя'); },
      log: (msg) => { logs.push(msg); },
    });
    expect(check()).toBe(false);
    expect(logs.some(m => m.includes('claudeWtHealth'))).toBe(true);
  });
});
