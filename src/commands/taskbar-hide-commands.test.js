import { describe, it, expect, vi, beforeEach } from 'vitest';
import { taskbarHideCommands } from './taskbar-hide-commands.js';

const S1 = 'aaaaaaaa-0000-4000-8000-000000000001';

describe('taskbarHideCommands', () => {
  let store;
  let service;
  let logs;
  let cmds;

  beforeEach(() => {
    store = { set: vi.fn() };
    service = {
      tick: vi.fn(),
      setSet: vi.fn(() => 3),
      statusOf: vi.fn(() => ({ applied: true })),
      showAll: vi.fn(() => 2),
      release: vi.fn(() => 5),
      startedAt: 1000,
      isReleased: vi.fn(() => false),
    };
    logs = [];
    cmds = taskbarHideCommands({ store, service, log: (m, level = 'info') => logs.push(`${level}: ${m}`) });
  });

  it('claude-taskbar-hide отдаёт набор службе и возвращает count', async () => {
    const body = { sessions: [S1] };
    expect(await cmds['claude-taskbar-hide'](body)).toEqual({ ok: true, count: 3 });
    expect(service.setSet).toHaveBeenCalledWith(body);
  });

  it('claude-taskbar-hide пишет в журнал только при смене count', async () => {
    await cmds['claude-taskbar-hide']({});
    await cmds['claude-taskbar-hide']({});
    expect(logs).toEqual(['info: claude-wt taskbar hide: 3 session(s)']);
    service.setSet.mockReturnValue(1);
    await cmds['claude-taskbar-hide']({});
    expect(logs).toHaveLength(2);
  });

  it('claude-window-taskbar: не UUID — bad id', async () => {
    expect(await cmds['claude-window-taskbar']({ id: 'x', taskbar: 'hide' })).toEqual({ ok: false, reason: 'bad id' });
    expect(store.set).not.toHaveBeenCalled();
  });

  it('claude-window-taskbar: чужое значение — отказ', async () => {
    expect(await cmds['claude-window-taskbar']({ id: S1, taskbar: 'maybe' }))
      .toEqual({ ok: false, reason: 'need hide, show or null' });
    expect(store.set).not.toHaveBeenCalled();
  });

  it('claude-window-taskbar: пишет хранилище, тикает, отдаёт statusOf', async () => {
    const res = await cmds['claude-window-taskbar']({ id: S1, taskbar: 'hide' });
    expect(res).toEqual({ ok: true, id: S1, taskbar: 'hide', applied: true });
    expect(store.set).toHaveBeenCalledWith(S1, 'hide');
    expect(service.tick).toHaveBeenCalledTimes(1);
    await cmds['claude-window-taskbar']({ id: S1, taskbar: null });
    expect(store.set).toHaveBeenLastCalledWith(S1, null);
  });

  it('claude-taskbar-show-all возвращает shown', async () => {
    expect(await cmds['claude-taskbar-show-all']({})).toEqual({ ok: true, shown: 2 });
  });

  it('claude-taskbar-release зовёт release, а не showAll: отметки целы', async () => {
    expect(await cmds['claude-taskbar-release']({ startedAt: 1000 })).toEqual({ ok: true, shown: 5 });
    expect(await cmds['claude-taskbar-release']('{"startedAt":2000}'), 'строкой тоже').toEqual({ ok: true, shown: 5 });
    expect(service.showAll).not.toHaveBeenCalled();
  });

  it('claude-taskbar-release без числового startedAt — отказ', async () => {
    for (const body of [{}, '', { startedAt: null }, { startedAt: '1000' }, { startedAt: Infinity }, '{"startedAt":"x"}']) {
      expect(await cmds['claude-taskbar-release'](body), JSON.stringify(body))
        .toEqual({ ok: false, reason: 'need startedAt' });
    }
    expect(service.release).not.toHaveBeenCalled();
  });

  it('claude-taskbar-release от CLI старше службы — отказ', async () => {
    // Трей не дождался release, человек поднял службу заново, и запоздалый
    // POST старого CLI выключил бы прятание у свежей службы.
    expect(await cmds['claude-taskbar-release']({ startedAt: 999 }))
      .toEqual({ ok: false, reason: 'stale release: service started after the request' });
    expect(service.release).not.toHaveBeenCalled();
  });
});
