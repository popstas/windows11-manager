import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Проверяется одно: сколько раз ради фокуса запускается VirtualDesktop11.exe.
 *
 * Запуск процесса стоил 208 мс на пару «спросить стол + перейти», и платились
 * они на каждый перевод фокуса — даже когда окно и так на текущем столе, то
 * есть почти всегда. Заменить это дешёвой проверкой можно только одним
 * способом, и он проверяется здесь: сперва фокус, потом бесплатный
 * `GetForegroundWindow()`, и лишь по его отказу — столы.
 *
 * Модули подменяются целиком: `windows.js` тянет нативный аддон, а
 * `virtual-desktop.js` — настоящий exe, и ни того, ни другого на машине с
 * тестами нет.
 */
const focusWindowById = vi.fn();
const getActiveWindowId = vi.fn();
const GetWindowDesktopNumber = vi.fn();
const GoToDesktopNumber = vi.fn();

vi.mock('../windows.js', () => ({
  focusWindowById: (...a) => focusWindowById(...a),
  getActiveWindowId: (...a) => getActiveWindowId(...a),
  getWindowById: vi.fn(),
  getWindows: () => [],
}));
vi.mock('../virtual-desktop.js', () => ({
  virtualDesktop: {
    GetWindowDesktopNumber: (...a) => GetWindowDesktopNumber(...a),
    GoToDesktopNumber: (...a) => GoToDesktopNumber(...a),
  },
}));
vi.mock('../placement.js', () => ({ placeWindowByConfig: vi.fn() }));

const { focusTerminalWindow } = await import('./project.js');

beforeEach(() => {
  focusWindowById.mockReset().mockReturnValue(true);
  getActiveWindowId.mockReset();
  GetWindowDesktopNumber.mockReset().mockResolvedValue('2');
  GoToDesktopNumber.mockReset().mockResolvedValue(undefined);
});

describe('focusTerminalWindow', () => {
  it('окно стало передним — столов не касается вовсе', async () => {
    getActiveWindowId.mockReturnValue(42);
    expect(await focusTerminalWindow(42)).toBe(true);
    expect(GetWindowDesktopNumber).not.toHaveBeenCalled();
    expect(GoToDesktopNumber).not.toHaveBeenCalled();
    expect(focusWindowById).toHaveBeenCalledTimes(1);
  });

  it('окно передним не стало — спрашивает стол, переходит и фокусирует снова', async () => {
    getActiveWindowId.mockReturnValue(7);
    expect(await focusTerminalWindow(42)).toBe(true);
    expect(GetWindowDesktopNumber).toHaveBeenCalledWith(42);
    expect(GoToDesktopNumber).toHaveBeenCalledWith(2);
    expect(focusWindowById).toHaveBeenCalledTimes(2);
  });

  it('известный стол не переспрашивается — слот 1-based, переход 0-based', async () => {
    getActiveWindowId.mockReturnValue(7);
    await focusTerminalWindow(42, () => 0, 3);
    expect(GetWindowDesktopNumber).not.toHaveBeenCalled();
    expect(GoToDesktopNumber).toHaveBeenCalledWith(2);
  });

  it('стол не узнан — переход не зовётся, но фокус всё равно пробуется', async () => {
    getActiveWindowId.mockReturnValue(7);
    GetWindowDesktopNumber.mockResolvedValue(undefined);
    expect(await focusTerminalWindow(42)).toBe(true);
    expect(GoToDesktopNumber).not.toHaveBeenCalled();
    expect(focusWindowById).toHaveBeenCalledTimes(2);
  });

  it('мёртвого окна не бывает передним — уходит в ветку столов и честно отказывает', async () => {
    focusWindowById.mockReturnValue(false);
    getActiveWindowId.mockReturnValue(0);
    expect(await focusTerminalWindow(42)).toBe(false);
  });
});
