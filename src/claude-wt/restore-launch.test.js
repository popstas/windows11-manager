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
const getMonitorByPoint = vi.fn();
const markNoAutoplace = vi.fn();

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
vi.mock('../monitors.js', () => ({
  getWindowsMonitors: () => [],
  getMonitorByPoint: (...a) => getMonitorByPoint(...a),
}));
vi.mock('../no-autoplace.js', () => ({ markNoAutoplace: (...a) => markNoAutoplace(...a) }));
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
  getMonitorByPoint.mockReset();
  markNoAutoplace.mockReset();
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

/**
 * Второй монитор, справа от главного. Рабочая область, а не полные границы:
 * панель задач съедает низ, и центр по полным границам увёл бы окно вниз.
 */
const secondScreen = () => getMonitorByPoint.mockReturnValue({
  isPrimary: () => false,
  getWorkArea: () => ({ x: 2560, y: 0, width: 1920, height: 1040 }),
  getScaleFactor: () => 1,
});
const cursor = { x: 3000, y: 500 };

describe('launchPlan по курсору', () => {
  it('ставит окно на экран под курсором, а не в запомненные границы', async () => {
    // Ради этого всё и затевалось: знакомую трекеру сессию менеджер поднимает
    // восстановлением, и до этой правки галка «на активном экране» у неё не
    // делала ничего — окно возвращалось туда, где сессия жила вчера.
    //
    // Размер при этом остаётся от слота: переезд на соседний экран — про
    // экран, а не про то, чтобы забыть, каким окно было.
    secondScreen();
    windowsAfterSpawn(42);
    await launchPlan({ plan: [item()], cfg, restored: [], skipped: [], cursor });
    expect(placeWindowByConfig).toHaveBeenCalledWith({
      window: 42, x: 3120, y: 220, width: 800, height: 600,
    });
  });

  it('курсор отменяет и стол — и человека никуда не уводит', async () => {
    // «Открывай там, где я смотрю» читается буквально: стол из слота значил бы,
    // что окно встало на нужный экран и тут же уехало на чужой рабочий стол,
    // утащив туда и человека (`restoreFollowDesktop`).
    secondScreen();
    windowsAfterSpawn(42);
    await launchPlan({ plan: [item()], cfg, restored: [], skipped: [], cursor });
    expect(placeWindowByConfig.mock.calls[0][0]).not.toHaveProperty('desktop');
    expect(GoToDesktopNumber).not.toHaveBeenCalled();
    expect(focusTerminalWindow).toHaveBeenCalledWith(42, expect.any(Function), null);
  });

  it('на неглавном экране закрывает окно от автоматики', async () => {
    // Иначе демон при первой же привязке окна к знакомой сессии утащил бы его
    // обратно в запомненные границы — то самое, от чего человек и уходил.
    secondScreen();
    windowsAfterSpawn(42);
    await launchPlan({ plan: [item()], cfg, restored: [], skipped: [], cursor });
    expect(markNoAutoplace).toHaveBeenCalledWith(42);
  });

  it('главный экран от пометки не спасает — слот у сессии есть всегда', async () => {
    // Восстановление берётся только за сессию, которую трекер помнит, то есть
    // слот тут есть по построению. Без пометки демон при первой привязке
    // вернул бы окно в запомненные границы и на запомненный стол — и галка
    // отменяла бы сама себя на главном экране, то есть чаще всего.
    getMonitorByPoint.mockReturnValue({
      isPrimary: () => true,
      getWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1040 }),
      getScaleFactor: () => 1,
    });
    windowsAfterSpawn(42);
    await launchPlan({ plan: [item()], cfg, restored: [], skipped: [], cursor });
    expect(markNoAutoplace).toHaveBeenCalledWith(42);
  });

  it('пачкой курсор не действует — окна встают по своим местам', async () => {
    // Курсора у восстановления пачкой (старт машины, `^S`) не бывает вовсе,
    // но проверка на одиночный подъём стоит страховкой: свались туда курсор,
    // все окна сложились бы на один экран молча.
    secondScreen();
    let n = 0;
    const list = [];
    getWindows.mockImplementation(() => list.slice());
    spawn.mockImplementation(() => { list.push({ id: 40 + (++n), getTitle: () => 'ccfzf' }); return { unref() {} }; });
    await launchPlan({ plan: [item(), item({ sessionId: 'b2' })], cfg, restored: [], skipped: [], cursor });
    expect(placeWindowByConfig).toHaveBeenCalledWith({ window: 41, ...bounds, desktop: 2 });
  });

  it('нет монитора в точке — откат на запомненные границы', async () => {
    // Незнакомая точка значит, что конфиг мониторов разошёлся с тем, что видит
    // пикер. Ставить наугад тут хуже, чем сделать то, что делали всегда.
    getMonitorByPoint.mockReturnValue(null);
    windowsAfterSpawn(42);
    const restored = [];
    await launchPlan({ plan: [item()], cfg, restored, skipped: [], cursor });
    expect(placeWindowByConfig).toHaveBeenCalledWith({ window: 42, ...bounds, desktop: 2 });
    expect(restored).toEqual(['a1']);
  });

  it('без курсора ставит как ставил', async () => {
    windowsAfterSpawn(42);
    await launchPlan({ plan: [item()], cfg, restored: [], skipped: [] });
    expect(placeWindowByConfig).toHaveBeenCalledWith({ window: 42, ...bounds, desktop: 2 });
    expect(getMonitorByPoint).not.toHaveBeenCalled();
  });
});
