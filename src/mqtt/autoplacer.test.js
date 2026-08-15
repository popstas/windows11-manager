import { describe, it, expect, vi } from 'vitest';
import { startAutoplacer } from './autoplacer.js';

function deps(overrides = {}) {
  const logs = [];
  return {
    logs,
    winMan: {
      placeWindowOnOpen: vi.fn().mockResolvedValue(undefined),
      stopPlaceNewWindows: vi.fn(),
      ...overrides.winMan,
    },
    config: overrides.config ?? { placeWindowOnOpen: true },
    log: (message, level = 'info') => logs.push(`${level}: ${message}`),
  };
}

describe('startAutoplacer', () => {
  it('при placeWindowOnOpen: true расстановка включается', async () => {
    const d = deps();
    startAutoplacer(d);
    await vi.waitFor(() => expect(d.winMan.placeWindowOnOpen).toHaveBeenCalled());
  });

  it('без ключа в конфиге ничего не заводится', () => {
    const d = deps({ config: {} });
    const a = startAutoplacer(d);
    a.stop();
    expect(d.winMan.placeWindowOnOpen).not.toHaveBeenCalled();
    expect(d.winMan.stopPlaceNewWindows).not.toHaveBeenCalled();
  });

  it('stop() гасит таймер расстановщика', async () => {
    const d = deps();
    const a = startAutoplacer(d);
    await vi.waitFor(() => expect(d.winMan.placeWindowOnOpen).toHaveBeenCalled());
    a.stop();
    expect(d.winMan.stopPlaceNewWindows).toHaveBeenCalled();
  });

  it('отказ виден в логе, а не роняет процесс необработанным отклонением', async () => {
    const d = deps({ winMan: { placeWindowOnOpen: vi.fn().mockRejectedValue(new Error('нет окон')) } });
    startAutoplacer(d);
    await vi.waitFor(() => expect(d.logs.some((l) => l.startsWith('error:'))).toBe(true));
    expect(d.logs.join(' ')).toContain('нет окон');
  });

  it('библиотека без placeWindowOnOpen — громкая строка, а не тишина', () => {
    const d = deps({ winMan: { placeWindowOnOpen: undefined } });
    startAutoplacer(d);
    expect(d.logs.some((l) => l.startsWith('error:'))).toBe(true);
  });
});
