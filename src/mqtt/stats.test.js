import { describe, it, expect, vi } from 'vitest';
import { createStatsPublisher, zeroMissingApps, appCounts, statsMessages, STATS_INTERVAL_MS } from './stats.js';

function statsOf(byApp, { total = 0, active = null } = {}) {
  return { total, byApp, ...(active ? { active } : {}) };
}

function setup({ config = {}, stats = [] } = {}) {
  const published = [];
  const logs = [];
  let call = 0;
  const winMan = {
    getStats: vi.fn(() => {
      const value = stats[Math.min(call, stats.length - 1)];
      call += 1;
      if (value instanceof Error) throw value;
      return value;
    }),
  };
  const publisher = createStatsPublisher({
    winMan,
    publish: (topic, payload) => published.push({ topic, payload }),
    config: { base: 'home/room/pc/windows', publishStats: true, ...config },
    log: (message, level = 'info') => logs.push(`${level}: ${message}`),
  });
  return { publisher, published, logs, winMan };
}

describe('zeroMissingApps', () => {
  it('пропавшему приложению дописывается нуль', () => {
    // Иначе график в Home Assistant вечно держит последнее ненулевое значение.
    const next = zeroMissingApps(statsOf({ code: { count: 1, wins: [] } }), { code: 1, chrome: 3 });
    expect(next.byApp.chrome).toEqual({ count: 0, wins: [] });
  });

  it('нуль пишется один раз, а не до перезапуска службы', () => {
    const once = zeroMissingApps(statsOf({}), { chrome: 3 });
    const twice = zeroMissingApps(statsOf({}), appCounts(once));
    expect(twice.byApp.chrome).toBeUndefined();
  });

  it('живое приложение не обнуляется', () => {
    const next = zeroMissingApps(statsOf({ chrome: { count: 2, wins: [] } }), { chrome: 3 });
    expect(next.byApp.chrome.count).toBe(2);
  });
});

describe('appCounts', () => {
  it('окна в память не забираются: только имена и числа', () => {
    // В byApp[*].wins лежат объекты нативного модуля, и держать их лишнюю
    // минуту ради сравнения чисел незачем.
    const counts = appCounts(statsOf({ code: { count: 2, wins: [{ id: 1 }] } }));
    expect(counts).toEqual({ code: 2 });
  });
});

describe('statsMessages', () => {
  it('total, приложения и активное окно', () => {
    const messages = statsMessages(
      statsOf({ code: { count: 2, wins: [] } }, { total: 5, active: { app: 'code', title: 'src' } }),
      'state/pc/windows');
    expect(messages).toEqual([
      { topic: 'state/pc/windows/total', payload: '5' },
      { topic: 'state/pc/windows/apps/code', payload: '2' },
      { topic: 'state/pc/windows/active/app', payload: 'code' },
      { topic: 'state/pc/windows/active/title', payload: 'src' },
    ]);
  });

  it('без активного окна лишних топиков нет', () => {
    expect(statsMessages(statsOf({}, { total: 0 }), 'x').map((m) => m.topic)).toEqual(['x/total']);
  });
});

describe('createStatsPublisher', () => {
  it('publishStatsTopic не выводится из базы: на этой машине он совсем не под ней', () => {
    const { publisher } = setup({ config: { publishStatsTopic: 'state/pc/windows' } });
    expect(publisher.topicBase).toBe('state/pc/windows');
  });

  it('без publishStatsTopic топик лежит под базой', () => {
    const { publisher } = setup();
    expect(publisher.topicBase).toBe('home/room/pc/windows/stats');
  });

  it('при publishStats: false ничего не публикуется', () => {
    vi.useFakeTimers();
    try {
      const s = setup({ config: { publishStats: false }, stats: [statsOf({}, { total: 1 })] });
      s.publisher.start();
      vi.advanceTimersByTime(STATS_INTERVAL_MS * 3);
      expect(s.published).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('замер идёт сразу при старте и дальше раз в минуту', () => {
    vi.useFakeTimers();
    try {
      const s = setup({ stats: [statsOf({}, { total: 1 })] });
      s.publisher.start();
      expect(s.published).toHaveLength(1);
      vi.advanceTimersByTime(STATS_INTERVAL_MS);
      expect(s.winMan.getStats).toHaveBeenCalledTimes(2);
      s.publisher.stop();
      vi.advanceTimersByTime(STATS_INTERVAL_MS * 3);
      expect(s.winMan.getStats).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('повторный start() второго таймера не заводит', () => {
    // start() зовут на каждое подключение к брокеру, а их за жизнь службы много.
    vi.useFakeTimers();
    try {
      const s = setup({ stats: [statsOf({}, { total: 1 })] });
      s.publisher.start();
      s.publisher.start();
      vi.advanceTimersByTime(STATS_INTERVAL_MS);
      expect(s.winMan.getStats).toHaveBeenCalledTimes(2);
      s.publisher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('пропавшее приложение доезжает до брокера нулём', () => {
    vi.useFakeTimers();
    try {
      const s = setup({
        stats: [
          statsOf({ chrome: { count: 3, wins: [] } }, { total: 3 }),
          statsOf({}, { total: 0 }),
        ],
      });
      s.publisher.start();
      vi.advanceTimersByTime(STATS_INTERVAL_MS);
      expect(s.published).toContainEqual({ topic: 'home/room/pc/windows/stats/apps/chrome', payload: '0' });
      s.publisher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('упавший getStats() не роняет службу, а пишет строку в лог', () => {
    // Исключение из обработчика setInterval убило бы весь процесс MQTT.
    const s = setup({ stats: [new Error('native gone')] });
    s.publisher.publishOnce();
    expect(s.published).toEqual([]);
    expect(s.logs[0]).toContain('error: stats: не удалось собрать статистику окон: native gone');
  });
});
