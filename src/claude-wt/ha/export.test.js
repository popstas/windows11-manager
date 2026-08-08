import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHaExport } from './export.js';

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
});
