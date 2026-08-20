import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Проверяется то, чего у восстановления не было вовсе: фокус.
 *
 * Сессию, открытую из истории пикера, `launchPlan()` ставила на место и на
 * этом заканчивала — окно появлялось, а ввод оставался у того, кто держал
 * передний план; человек видел терминал и печатал мимо него. Подъёма
 * `placeWindow()` (`bringToTop`) для этого мало, а переход на чужой стол вслед
 * за окном оставляет передним и вовсе что придётся.
 *
 * Модули подменяются целиком: `windows.js` тянет нативный аддон, `placement.js`
 * двигает настоящие окна, а `virtual-desktop.js` запускает exe — ничего этого
 * на машине с тестами нет.
 */
const getWindows = vi.fn();
const focusWindowById = vi.fn();
const focusTerminalWindow = vi.fn();
const placeWindowByConfig = vi.fn();
const GoToDesktopNumber = vi.fn();
const spawn = vi.fn();

vi.mock('../windows.js', () => ({
  getWindows: (...a) => getWindows(...a),
  focusWindowById: (...a) => focusWindowById(...a),
}));
vi.mock('./focus-terminal.js', () => ({
  focusTerminalWindow: (...a) => focusTerminalWindow(...a),
}));
vi.mock('../placement.js', () => ({ placeWindowByConfig: (...a) => placeWindowByConfig(...a) }));
vi.mock('../virtual-desktop.js', () => ({
  virtualDesktop: { GoToDesktopNumber: (...a) => GoToDesktopNumber(...a), GetWindowDesktopNumber: vi.fn() },
}));
vi.mock('../monitors.js', () => ({ getWindowsMonitors: () => [] }));
vi.mock('node:child_process', () => ({ spawn: (...a) => spawn(...a) }));
vi.mock('./index.js', () => ({ getClaudeWtConfig: vi.fn(), isTerminalWindow: () => true }));
vi.mock('./state.js', () => ({ readState: vi.fn() }));
vi.mock('./sessions.js', () => ({ loadSessionIndex: vi.fn() }));
vi.mock('./snapshotter.js', () => ({ listSnapshots: vi.fn() }));

const { launchPlan } = await import('./restore.js');

const bounds = { x: 10, y: 20, width: 800, height: 600 };
const cfg = { desktop: true, restore: { windowTimeoutMs: 1000, launchDelayMs: 0, settleMs: 0 } };
const item = (over = {}) => ({
  sessionId: 'a1', title: 'ccfzf', command: 'wt.exe', args: [], bounds, desktop: 2, ...over,
});
// Окно списком: до запуска терминалов нет, после — одно новое.
const windowsAfterSpawn = (id = 42) => {
  let opened = false;
  getWindows.mockImplementation(() => (opened ? [{ id, getTitle: () => 'ccfzf' }] : []));
  spawn.mockImplementation(() => { opened = true; return { unref() {} }; });
};

beforeEach(() => {
  getWindows.mockReset();
  focusWindowById.mockReset().mockReturnValue(true);
  focusTerminalWindow.mockReset().mockResolvedValue(true);
  placeWindowByConfig.mockReset().mockResolvedValue(undefined);
  GoToDesktopNumber.mockReset().mockResolvedValue(undefined);
  spawn.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('launchPlan', () => {
  it('поднятой сессии отдаёт фокус — со столом, который сам же ей и назначил', async () => {
    windowsAfterSpawn(42);
    const restored = [];
    await launchPlan({ plan: [item()], cfg, restored, skipped: [] });
    expect(restored).toEqual(['a1']);
    // Стол известен: его только что навязало правило, переспрашивать
    // VirtualDesktop11.exe незачем.
    expect(focusTerminalWindow).toHaveBeenCalledWith(42, expect.any(Function), 2);
    // Фокус — последним: до него окно переносят на место и уходят на его стол,
    // а после перехода передним остаётся что придётся.
    expect(GoToDesktopNumber.mock.invocationCallOrder[0])
      .toBeLessThan(focusTerminalWindow.mock.invocationCallOrder[0]);
  });

  it('окно показывает сразу, не дожидаясь ни доводки, ни переноса', async () => {
    windowsAfterSpawn(42);
    await launchPlan({ plan: [item()], cfg, restored: [], skipped: [] });
    expect(focusWindowById).toHaveBeenCalledWith(42);
    expect(focusWindowById.mock.invocationCallOrder[0])
      .toBeLessThan(placeWindowByConfig.mock.invocationCallOrder[0]);
  });

  it('фокусирует и без стола — окно встало там же, где человек', async () => {
    windowsAfterSpawn(42);
    await launchPlan({ plan: [item({ desktop: null })], cfg, restored: [], skipped: [] });
    expect(GoToDesktopNumber).not.toHaveBeenCalled();
    expect(focusTerminalWindow).toHaveBeenCalledWith(42, expect.any(Function), null);
  });

  it('не встало — не фокусирует: окна нет, а прежний передний план не наш', async () => {
    windowsAfterSpawn(42);
    placeWindowByConfig.mockRejectedValue(new Error('setBounds failed'));
    const skipped = [];
    await launchPlan({ plan: [item()], cfg, restored: [], skipped });
    expect(skipped).toEqual(['a1']);
    expect(focusTerminalWindow).not.toHaveBeenCalled();
  });

  it('пачкой не фокусирует ничего — выбор окна за человеком', async () => {
    // Снимок раскладки и восстановление после падения поднимают окна разных
    // сессий; отдать ввод одной из них — то же решение за человека, что и
    // переход на её стол.
    let n = 0;
    const list = [];
    getWindows.mockImplementation(() => list.slice());
    spawn.mockImplementation(() => { list.push({ id: 40 + (++n), getTitle: () => 'ccfzf' }); return { unref() {} }; });
    await launchPlan({ plan: [item(), item({ sessionId: 'b2' })], cfg, restored: [], skipped: [] });
    expect(focusTerminalWindow).not.toHaveBeenCalled();
    expect(focusWindowById).not.toHaveBeenCalled();
  });
});
