import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sessionIconCommands } from './session-icon-commands.js';
import { createSessionIconStore } from '../claude-wt/session-icons.js';

const S1 = 'aaaaaaaa-0000-4000-8000-000000000001';

describe('sessionIconCommands', () => {
  let dir;
  let store;
  let service;
  let logs;
  let cfg;
  let cmds;

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'w11m-sic-'));
    dir = path.join(root, 'ico');
    fs.mkdirSync(dir);
    for (const f of ['telegram.ico', 'Planfix.ico', 'home assistant.png']) fs.writeFileSync(path.join(dir, f), '');
    store = createSessionIconStore({ file: path.join(root, 'data', 'session-icons.json') });
    service = { tick: vi.fn(), statusOf: vi.fn(() => ({ applied: true })) };
    logs = [];
    cfg = { windowIcons: { dir } };
    cmds = sessionIconCommands({
      store, icons: () => service, getCfg: () => cfg, log: (m, level = 'info') => logs.push(`${level}: ${m}`),
    });
  });

  it('ставит по имени, путь из папки, statusOf в ответе', async () => {
    const res = await cmds['claude-window-icon']({ id: S1, icon: 'TELEGRAM' });
    expect(res).toEqual({ ok: true, id: S1, icon: path.join(dir, 'telegram.ico'), applied: true });
    expect(store.get(S1)).toEqual({ icon: path.join(dir, 'telegram.ico') });
    expect(service.tick).toHaveBeenCalledTimes(1);
    expect(service.statusOf).toHaveBeenCalledWith(S1, 'icon');
    expect(logs).toContain(`info: claude-wt window icon ${S1}: ${path.join(dir, 'telegram.ico')} (applied)`);
  });

  it('значок — поле badge, тело строкой JSON', async () => {
    service.statusOf.mockReturnValue({ applied: false, reason: 'no window' });
    const res = await cmds['claude-window-badge'](JSON.stringify({ id: S1, badge: 'planfix' }));
    expect(res).toEqual({ ok: true, id: S1, badge: path.join(dir, 'Planfix.ico'), applied: false, reason: 'no window' });
    expect(service.statusOf).toHaveBeenCalledWith(S1, 'badge');
    expect(logs).toContain(`info: claude-wt window badge ${S1}: ${path.join(dir, 'Planfix.ico')} (no window)`);
  });

  it('снятие — null, поле убрано из хранилища', async () => {
    await cmds['claude-window-badge']({ id: S1, badge: 'planfix' });
    const res = await cmds['claude-window-badge']({ id: S1, badge: null });
    expect(res).toEqual({ ok: true, id: S1, badge: null, applied: true });
    expect(store.get(S1)).toBeUndefined();
    expect(logs).toContain(`info: claude-wt window badge ${S1}: снят (applied)`);
  });

  it('неизвестное имя — отказ, хранилище не тронуто', async () => {
    const v = store.version;
    for (const name of ['nope', '../telegram', 'home assistant']) {
      const res = await cmds['claude-window-icon']({ id: S1, icon: name });
      expect(res).toEqual({ ok: false, reason: `unknown icon ${name}; see claude-wt window icons` });
    }
    expect(store.version).toBe(v);
    expect(service.tick).not.toHaveBeenCalled();
  });

  it('нет id или нет поля — отказ', async () => {
    expect(await cmds['claude-window-icon']({ icon: 'telegram' })).toEqual({ ok: false, reason: 'no id' });
    expect(await cmds['claude-window-icon']({ id: S1 })).toEqual({ ok: false, reason: 'need icon name or null' });
    expect(await cmds['claude-window-badge']({ id: S1, badge: '' })).toEqual({ ok: false, reason: 'need badge name or null' });
  });

  it('нет windowIcons.dir — отказ на имя, снятие работает', async () => {
    store.set(S1, 'icon', 'C:\\old.ico');
    cfg = { windowIcons: { dir: '' } };
    expect(await cmds['claude-window-icon']({ id: S1, icon: 'telegram' }))
      .toEqual({ ok: false, reason: 'icons dir not configured (claudeWt.windowIcons.dir)' });
    expect(await cmds['claude-window-icon']({ id: S1, icon: null })).toEqual({ ok: true, id: S1, icon: null, applied: true });
    expect(store.get(S1)).toBeUndefined();
  });

  it('папки нет на диске — отказ с её путём', async () => {
    cfg = { windowIcons: { dir: path.join(dir, 'missing') } };
    expect(await cmds['claude-window-icon']({ id: S1, icon: 'telegram' }))
      .toEqual({ ok: false, reason: `icons dir unreadable: ${path.join(dir, 'missing')}` });
  });

  it('службы нет — сохранено, applied: false, no icon service', async () => {
    const bare = sessionIconCommands({ store, icons: () => null, getCfg: () => cfg, log: () => {} });
    const res = await bare['claude-window-icon']({ id: S1, icon: 'telegram' });
    expect(res).toEqual({
      ok: true, id: S1, icon: path.join(dir, 'telegram.ico'), applied: false, reason: 'no icon service',
    });
    expect(store.get(S1)).toEqual({ icon: path.join(dir, 'telegram.ico') });
  });

  it('window-icons — список имён и dir; нет dir — отказ', async () => {
    expect(await cmds['claude-window-icons']({})).toEqual({ ok: true, dir, names: ['Planfix', 'telegram'] });
    cfg = {};
    expect(await cmds['claude-window-icons']('')).toEqual({
      ok: false, reason: 'icons dir not configured (claudeWt.windowIcons.dir)',
    });
  });

  it('id не UUID (и __proto__) — отказ, прототип не тронут', async () => {
    for (const id of ['__proto__', 'constructor', 's1', 'x'.repeat(5000)]) {
      expect(await cmds['claude-window-icon']({ id, icon: 'telegram' })).toEqual({ ok: false, reason: 'bad id' });
    }
    expect(({}).icon).toBeUndefined();
    expect(service.tick).not.toHaveBeenCalled();
  });
});
