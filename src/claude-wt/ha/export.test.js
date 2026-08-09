import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHaExport, REFRESH_DELAY_MS } from './export.js';

const SESSIONS = [
  { id: 'a', title: 'alpha', open: true, agentState: 'review' },
  { id: 'b', title: 'beta', open: false, agentState: 'idle' },
];

function make(overrides = {}) {
  const publish = vi.fn();
  const exporter = createHaExport({
    winMan: {
      claudeWtSessions: vi.fn().mockReturnValue({ ok: true, sessions: SESSIONS }),
      ...overrides.winMan,
    },
    publish,
    log: vi.fn(),
    config: { base: 'home/room/pc/windows', homeassistant: { slots: 2, interval: 15 }, ...overrides.config },
  });
  return { exporter, publish };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createHaExport', () => {
  it('в слоты идут только открытые сессии', () => {
    const { exporter } = make();
    exporter.start();
    expect(exporter.slots().find((s) => s.slot === 1).id).toBe('a');
    expect(exporter.slots().some((s) => s.id === 'b')).toBe(false);
  });

  it('конфиги переиздаются только при смене имён', () => {
    const { exporter, publish } = make();
    exporter.start();
    const configTopics = () => publish.mock.calls.filter(([t]) => t.startsWith('homeassistant/')).length;
    const afterFirst = configTopics();
    expect(afterFirst).toBeGreaterThan(0);
    vi.advanceTimersByTime(15000);
    expect(configTopics()).toBe(afterFirst);
  });

  it('повторный start переиздаёт конфиги: это переподключение к брокеру', () => {
    // Брокер, переживший перезапуск без сохранения retained, теряет конфиги
    // Discovery вместе с устройством claude_wt. Слепок имён переживал разрыв, а
    // start() выходил по уже заведённому таймеру, и устройство не возвращалось
    // в Home Assistant до ближайшей смены состава сессий.
    const { exporter, publish } = make();
    exporter.start();
    publish.mockClear();
    exporter.start();
    expect(publish.mock.calls.filter(([t]) => t.startsWith('homeassistant/')).length)
      .toBeGreaterThan(0);
  });

  it('повторный start не заводит второго таймера', () => {
    const { exporter, publish } = make();
    exporter.start();
    exporter.start();
    publish.mockClear();
    vi.advanceTimersByTime(15000);
    const states = publish.mock.calls.filter(([t]) => t.endsWith('/claude/slot/1')).length;
    expect(states).toBe(1);
  });

  it('состояния публикуются на каждом тике', () => {
    const { exporter, publish } = make();
    exporter.start();
    const stateTopics = () => publish.mock.calls.filter(([t]) => t.includes('/claude/slot/')).length;
    const afterFirst = stateTopics();
    vi.advanceTimersByTime(15000);
    expect(stateTopics()).toBeGreaterThan(afterFirst);
  });

  it('stop помечает устройство недоступным', () => {
    const { exporter, publish } = make();
    exporter.start();
    publish.mockClear();
    exporter.stop();
    expect(publish).toHaveBeenCalledWith(
      'home/room/pc/windows/claude/availability', 'offline', { retain: true, qos: 0 },
    );
  });

  it('enabled: false не публикует ничего', () => {
    const { exporter, publish } = make({ config: { homeassistant: { enabled: false } } });
    exporter.start();
    expect(publish).not.toHaveBeenCalled();
  });

  it('сбой чтения сессий не роняет таймер', () => {
    const { exporter } = make({
      winMan: { claudeWtSessions: vi.fn(() => { throw new Error('SMB timeout'); }) },
    });
    exporter.start();
    expect(() => vi.advanceTimersByTime(15000)).not.toThrow();
  });

  it('homeassistant.sessionsSort доезжает до buildSlots и реально меняет порядок слотов', () => {
    // p дороже (agentCostUsd 5), q дешевле (agentCostUsd 1), но по имени q раньше
    // p — 'alpha' < 'bravo'. Сортировки cost и name дают противоположный порядок,
    // так что тест падает, если sessionsSort по дороге теряется.
    const sessions = [
      { id: 'p', title: 'bravo', open: true, agentState: 'idle', agentCostUsd: 5 },
      { id: 'q', title: 'alpha', open: true, agentState: 'idle', agentCostUsd: 1 },
    ];
    const claudeWtSessions = vi.fn().mockReturnValue({ ok: true, sessions });

    const { exporter: byCost } = make({
      winMan: { claudeWtSessions },
      config: { homeassistant: { slots: 2, interval: 15, sessionsSort: 'cost' } },
    });
    byCost.start();
    expect(byCost.slots().filter((s) => s.id).map((s) => s.id)).toEqual(['p', 'q']);

    const { exporter: byName } = make({
      winMan: { claudeWtSessions },
      config: { homeassistant: { slots: 2, interval: 15, sessionsSort: 'name' } },
    });
    byName.start();
    expect(byName.slots().filter((s) => s.id).map((s) => s.id)).toEqual(['q', 'p']);
  });

  it('без sessionsSort слоты идут по свежести активности, а не по цене', () => {
    // Умолчание HA — `recent`, своё, не унаследованное от пикера ('cost'):
    // дорогая, но давно брошенная сессия не должна вытеснять работающую.
    const sessions = [
      { id: 'rich', title: 'bravo', open: true, agentState: 'idle', agentCostUsd: 40, lastActivity: 100 },
      { id: 'fresh', title: 'charlie', open: true, agentState: 'idle', agentCostUsd: 1, lastActivity: 900 },
    ];
    const { exporter } = make({
      winMan: { claudeWtSessions: vi.fn().mockReturnValue({ ok: true, sessions }) },
    });
    exporter.start();
    expect(exporter.slots().filter((s) => s.id).map((s) => s.id)).toEqual(['fresh', 'rich']);
  });

  it('refresh() публикует ровно один внеочередной экспорт, а второй refresh() до него не добавляет ещё один', () => {
    const claudeWtSessions = vi.fn().mockReturnValue({ ok: true, sessions: SESSIONS });
    const { exporter } = make({ winMan: { claudeWtSessions } });
    exporter.start();
    expect(claudeWtSessions).toHaveBeenCalledTimes(1);

    exporter.refresh();
    exporter.refresh(); // пока первый не отработал — второй таймер не заводится
    vi.advanceTimersByTime(REFRESH_DELAY_MS);
    expect(claudeWtSessions).toHaveBeenCalledTimes(2);
  });

  it('stop() гасит отложенный refresh() — после остановки тик не срабатывает', () => {
    const claudeWtSessions = vi.fn().mockReturnValue({ ok: true, sessions: SESSIONS });
    const { exporter } = make({ winMan: { claudeWtSessions } });
    exporter.start();
    expect(claudeWtSessions).toHaveBeenCalledTimes(1);

    exporter.refresh();
    exporter.stop();
    vi.advanceTimersByTime(REFRESH_DELAY_MS);
    expect(claudeWtSessions).toHaveBeenCalledTimes(1);
  });

  it('slotOff публикует слот целиком с state: off, а не голый state', () => {
    const { exporter, publish } = make();
    exporter.start();
    publish.mockClear();

    exporter.slotOff(1);

    expect(publish).toHaveBeenCalledTimes(1);
    const [topic, payload, opts] = publish.mock.calls[0];
    expect(topic).toBe('home/room/pc/windows/claude/slot/1');
    expect(opts).toEqual({ retain: true, qos: 0 });
    const body = JSON.parse(payload);
    expect(body.state).toBe('off');
    // Голая нагрузка state стёрла бы текст, сводку и цифры, которые сидят в том
    // же топике — проверяем, что они приехали вместе с флагом.
    expect(body.text).toBeTruthy();
    expect(Object.keys(body).length).toBeGreaterThan(1);
  });

  it('slotOff по неизвестному номеру слота ничего не публикует', () => {
    const { exporter, publish } = make();
    exporter.start();
    publish.mockClear();

    exporter.slotOff(99);

    expect(publish).not.toHaveBeenCalled();
  });
});
