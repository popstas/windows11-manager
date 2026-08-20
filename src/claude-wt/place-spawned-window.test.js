// Что делает с запомненным столом названный курсор.
//
// Слот помнит у сессии не только границы, но и рабочий стол, и до этой правки
// он навязывался всегда: окно вставало на экран, который назвал человек, и тут
// же уезжало на вчерашний стол, утащив туда и самого человека. То есть галка
// «на активном экране» отменяла сама себя, и видно это только глазами и только
// на машине, где столов больше одного.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const placeWindowByConfig = vi.fn();
const getMonitorByPoint = vi.fn();

vi.mock('../windows.js', () => ({ getWindowById: vi.fn(), getWindows: () => [] }));
vi.mock('../placement.js', () => ({ placeWindowByConfig: (...a) => placeWindowByConfig(...a) }));
vi.mock('../virtual-desktop.js', () => ({ virtualDesktop: { GoToDesktopNumber: vi.fn() } }));
vi.mock('../monitors.js', () => ({
  getMonitorByPoint: (...a) => getMonitorByPoint(...a),
  getWindowsMonitors: () => [],
}));
vi.mock('../no-autoplace.js', () => ({ markNoAutoplace: vi.fn() }));
vi.mock('./index.js', () => ({
  getClaudeWtConfig: () => ({ statePath: 's', sessionsFile: 'f', progressDir: 'p' }),
  isTerminalWindow: () => true,
}));
vi.mock('./state.js', () => ({
  readState: () => ({ slots: { s1: { bounds: { x: 10, y: 20, width: 800, height: 600 }, desktop: 3 } } }),
}));
vi.mock('./sessions.js', () => ({ loadSessionIndex: () => ({}) }));
vi.mock('./tracker-helpers.js', () => ({ resolveSession: () => ({ id: 's1' }) }));
vi.mock('./view.js', () => ({ claudeWtSessions: vi.fn() }));
vi.mock('./focus-terminal.js', () => ({ focusTerminalWindow: vi.fn() }));
vi.mock('./snapshotter.js', () => ({ listSnapshots: vi.fn() }));

const { placeSpawnedWindow } = await import('./project.js');
const { markNoAutoplace } = await import('../no-autoplace.js');

const win = { id: 42, getBounds: () => ({ x: 0, y: 0, width: 400, height: 300 }) };

beforeEach(() => {
  placeWindowByConfig.mockReset().mockResolvedValue(undefined);
  getMonitorByPoint.mockReset().mockReturnValue({
    isPrimary: () => false,
    getWorkArea: () => ({ x: 2560, y: 0, width: 1920, height: 1040 }),
    getScaleFactor: () => 1,
  });
  markNoAutoplace.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('placeSpawnedWindow', () => {
  it('без курсора уносит окно на запомненный стол, как уносил', async () => {
    expect(await placeSpawnedWindow(win, 'ccfzf')).toBe(3);
    expect(placeWindowByConfig).toHaveBeenCalledWith({
      window: 42, x: 10, y: 20, width: 800, height: 600, desktop: 3,
    });
  });

  it('курсор отменяет и стол — правило то же, что у восстановления', async () => {
    // Одно правило на обе дороги: разойдись они, один и тот же курсор давал бы
    // разный стол в зависимости от того, помнит ли трекер эту сессию.
    expect(await placeSpawnedWindow(win, 'ccfzf', undefined, { x: 3000, y: 500 })).toBe(null);
    expect(placeWindowByConfig.mock.calls[0][0]).not.toHaveProperty('desktop');
  });

  it('размер курсор не отменяет — он про экран, а не про память о размере', async () => {
    await placeSpawnedWindow(win, 'ccfzf', undefined, { x: 3000, y: 500 });
    expect(placeWindowByConfig).toHaveBeenCalledWith({
      window: 42, x: 3120, y: 220, width: 800, height: 600,
    });
  });
});

describe('перебитый слот', () => {
  it('помечается и тогда, когда курсор указал на главный экран', async () => {
    // Иначе галка «на активном экране» работала бы через раз: окно встало бы
    // куда просили и через пару тиков демона уехало в слот.
    getMonitorByPoint.mockReturnValue({
      isPrimary: () => true,
      getWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1040 }),
      getScaleFactor: () => 1,
    });
    await placeSpawnedWindow(win, 'ccfzf', undefined, { x: 100, y: 100 });
    expect(markNoAutoplace).toHaveBeenCalledWith(42);
  });
});
