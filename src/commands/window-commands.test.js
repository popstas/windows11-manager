import { describe, it, expect, vi } from 'vitest';
import { windowCommands } from './window-commands.js';

function deps(overrides = {}) {
  return {
    winMan: {
      placeWindows: vi.fn().mockResolvedValue([]),
      placeWindowByConfig: vi.fn().mockResolvedValue(undefined),
      storeWindows: vi.fn(),
      restoreWindows: vi.fn().mockResolvedValue(undefined),
      clearWindows: vi.fn(),
      openStore: vi.fn(),
      focusWindow: vi.fn().mockResolvedValue(true),
      reloadConfigs: vi.fn().mockResolvedValue(undefined),
      virtualDesktop: { GoToDesktopNumber: vi.fn() },
      ...overrides.winMan,
    },
    config: overrides.config ?? { store: { custom: { windows: [] } } },
    log: overrides.log ?? vi.fn(),
    notify: overrides.notify ?? vi.fn(),
  };
}

describe('windowCommands', () => {
  it('place принимает объект правила', async () => {
    const d = deps();
    await windowCommands(d).place({ window: 'current' });
    expect(d.winMan.placeWindowByConfig).toHaveBeenCalledWith({ window: 'current' });
  });

  it('place принимает то же правило строкой JSON', async () => {
    const d = deps();
    await windowCommands(d).place('{"window":"current"}');
    expect(d.winMan.placeWindowByConfig).toHaveBeenCalledWith({ window: 'current' });
  });

  it('restore после восстановления открывает сохранённые приложения', async () => {
    const d = deps({ config: { store: { custom: { apps: ['C:/a.exe'] } } } });
    await windowCommands(d).restore();
    expect(d.winMan.restoreWindows).toHaveBeenCalled();
    expect(d.winMan.openStore).toHaveBeenCalledWith(
      expect.objectContaining({ windows: [{ path: 'C:/a.exe' }] }),
    );
  });

  it('restore без store.custom не падает', async () => {
    const d = deps({ config: {} });
    await expect(windowCommands(d).restore()).resolves.not.toThrow();
    expect(d.winMan.restoreWindows).toHaveBeenCalled();
    expect(d.winMan.openStore).not.toHaveBeenCalled();
  });

  it('focus пишет в журнал, когда ни одно окно не подошло', async () => {
    const d = deps({ winMan: { focusWindow: vi.fn().mockResolvedValue(false) } });
    await windowCommands(d).focus({ title: '^OBS' });
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('no window matched'), 'warn');
  });

  it('desktop переводит номер в индекс с нуля', async () => {
    const d = deps();
    await windowCommands(d).desktop({ number: 3 });
    expect(d.winMan.virtualDesktop.GoToDesktopNumber).toHaveBeenCalledWith(2);
  });

  it('autoplace отдаёт число расставленных окон', async () => {
    const placed = [{ w: { path: 'C:\\x\\code.exe' } }];
    const d = deps({ winMan: { placeWindows: vi.fn().mockResolvedValue(placed) } });
    expect(await windowCommands(d).autoplace()).toEqual({ placed: 1 });
  });

  it('autoplace рассказывает человеку о расстановке при notifyPlaced', async () => {
    const placed = [{ w: { path: 'C:\\x\\code.exe' } }, { w: { path: 'C:\\x\\chrome.exe' } }];
    const d = deps({
      config: { notifyPlaced: true },
      winMan: { placeWindows: vi.fn().mockResolvedValue(placed) },
    });
    await windowCommands(d).autoplace();
    expect(d.notify).toHaveBeenCalledWith('Placed windows: 2');
  });

  it('autoplace без переехавших окон молчит', async () => {
    // autoplace прилетает и по расписанию: «Placed windows: 0» в телефоне —
    // шум, из-за которого перестают читать и остальные уведомления.
    const d = deps({ config: { notifyPlaced: true } });
    await windowCommands(d).autoplace();
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('без notifyPlaced уведомление не уходит', async () => {
    const placed = [{ w: { path: 'C:\\x\\code.exe' } }];
    const d = deps({
      config: {},
      winMan: { placeWindows: vi.fn().mockResolvedValue(placed) },
    });
    await windowCommands(d).autoplace();
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('битое тело place видно в журнале, а не молча становится пустым', async () => {
    // Пустой объект неотличим от пустой посылки: place просто ничего не ставил.
    const d = deps();
    await windowCommands(d).place('{"window":');
    expect(d.log).toHaveBeenCalledWith(
      expect.stringContaining('place: тело не разобрано'), 'warn');
    expect(d.winMan.placeWindowByConfig).toHaveBeenCalledWith({});
  });

  it('тело, разобранное не в объект, тоже видно', async () => {
    const d = deps();
    await windowCommands(d).open('42');
    expect(d.log).toHaveBeenCalledWith(
      expect.stringContaining('open: тело не разобрано'), 'warn');
  });

  it('пустое тело жалобы не вызывает', async () => {
    const d = deps();
    await windowCommands(d).place('');
    expect(d.log).not.toHaveBeenCalled();
  });

  it('reload переписывает тот же объект конфига, а не заводит новый', async () => {
    // getConfig() отдаёт каждый раз новый объект, и результат reloadConfigs()
    // выбрасывался: в mqtt-процессе store.custom оставался прежним навсегда.
    const fresh = { store: { custom: { apps: ['C:/new.exe'] } } };
    const config = { base: 'home/room/pc/windows', store: { custom: { apps: ['C:/old.exe'] } }, ушло: 1 };
    const d = deps({ config, winMan: { reloadConfigs: vi.fn().mockReturnValue(fresh) } });
    const commands = windowCommands(d);
    await commands.reload();
    expect(config.store.custom.apps).toEqual(['C:/new.exe']);
    // Ключи, которых в свежем конфиге нет, должны пропасть, а base — остаться:
    // его дописал транспорт, на диске его нет.
    expect(config.ушло).toBeUndefined();
    expect(config.base).toBe('home/room/pc/windows');
    await commands.restore();
    expect(d.winMan.openStore).toHaveBeenCalledWith(
      expect.objectContaining({ windows: [{ path: 'C:/new.exe' }] }));
  });

  it('reload честно сообщает, что часть настроек ждёт перезапуска', async () => {
    const d = deps({ winMan: { reloadConfigs: vi.fn().mockReturnValue({}) } });
    expect(await windowCommands(d).reload()).toEqual({ reloaded: true });
    expect(d.log).toHaveBeenCalledWith(
      expect.stringContaining('перезапуска процесса'), 'warn');
  });
});
