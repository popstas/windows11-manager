import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startTelegramInbox, defaultFs } from './telegram-inbox.js';

let root;
let dir;
let statePath;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-inbox-'));
  dir = path.join(root, 'incoming-telegram');
  fs.mkdirSync(path.join(dir, 'processed'), { recursive: true });
  statePath = path.join(root, 'state', 'claude-wt.json');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function setup({ inbox = {}, clock = { t: 0 } } = {}) {
  const logged = [];
  const opened = [];
  const winMan = {
    getClaudeWtConfig: () => ({
      statePath,
      telegramInbox: {
        enabled: true,
        dir,
        cwd: '/home/popstas/projects/text/obsidian/ExpertizeMe',
        script: '.scripts/telegram-incoming',
        fileDir: 'files/incoming-telegram',
        settleMs: 0,
        gapMs: 0,
        ...inbox,
      },
    }),
    openInboxSession: vi.fn(async (req) => {
      opened.push(req);
      return { ok: true, action: 'spawn', sessionName: req.name, focused: true };
    }),
  };
  const watcher = startTelegramInbox({
    winMan,
    log: (msg, level) => logged.push(level ? `${level}: ${msg}` : msg),
    deps: { autostart: false, now: () => clock.t, sleep: async () => {} },
  });
  // Проход и дождаться очереди: файл открывается на втором проходе (первый
  // только запоминает размер).
  const pass = async () => {
    watcher.tick();
    clock.t += 1000;
    await watcher.idle();
  };
  return { watcher, winMan, opened, logged, pass };
}

const put = (name, text = 'hello') => fs.writeFileSync(path.join(dir, name), text);

describe('startTelegramInbox', () => {
  it('opens each new file once, with vault-relative path and tg- name', async () => {
    const { opened, pass } = setup();
    put('2026-11-05-msg.md');
    await pass();
    expect(opened).toEqual([]);
    await pass();
    await pass();
    expect(opened).toEqual([{
      file: 'files/incoming-telegram/2026-11-05-msg.md',
      name: 'tg-2026-11-05-msg',
      cwd: '/home/popstas/projects/text/obsidian/ExpertizeMe',
      script: '.scripts/telegram-incoming',
      terminal: '',
    }]);
  });

  it('does not reopen after a restart: the state file remembers', async () => {
    put('a.md');
    const clock = { t: 0 };
    const first = setup({ clock });
    await first.pass();
    await first.pass();
    expect(first.opened.map(r => r.name)).toEqual(['tg-a']);
    first.watcher.stop();

    put('b.md');
    const second = setup({ clock });
    await second.pass();
    await second.pass();
    await second.pass();
    expect(second.opened.map(r => r.name)).toEqual(['tg-b']);
    expect(second.logged).toContain('[telegram-inbox] skip a.md: already opened');
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'state', 'telegram-inbox.json'), 'utf8'));
    expect(Object.keys(saved.processed).sort()).toEqual(['a.md', 'b.md']);
  });

  it('treats files already lying there at start as new, opening them one by one', async () => {
    put('1.md'); put('2.md'); put('3.md');
    const { winMan, opened, logged, pass } = setup();
    let inFlight = 0;
    let maxInFlight = 0;
    winMan.openInboxSession.mockImplementation(async (req) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight -= 1;
      opened.push(req);
      return { ok: true, focused: true };
    });
    await pass();
    await pass();
    expect(opened.map(r => r.name)).toEqual(['tg-1', 'tg-2', 'tg-3']);
    expect(maxInFlight).toBe(1);
    expect(logged).toContain('warn: [telegram-inbox] 3 files queued, opening one by one');
  });

  it('ignores syncthing temp, conflict copies, hidden files and processed/', async () => {
    put('.syncthing.x.md.tmp'); put('~syncthing~y.md.tmp'); put('z.sync-conflict-20261105-1-AAA.md');
    put('.hidden.md');
    fs.writeFileSync(path.join(dir, 'processed', 'old.md'), 'x');
    const { opened, logged, pass } = setup();
    await pass();
    await pass();
    await pass();
    expect(opened).toEqual([]);
    expect(logged.filter(l => l.includes('skip'))).toHaveLength(4);
  });

  it('waits while the file keeps growing', async () => {
    const { opened, pass } = setup({ inbox: { settleMs: 1500 } });
    put('grow.md', 'a');
    await pass();
    put('grow.md', 'ab');
    await pass();
    await pass();
    expect(opened).toEqual([]);
    await pass();
    expect(opened.map(r => r.name)).toEqual(['tg-grow']);
  });

  it('does nothing when disabled, and says what is missing when misconfigured', async () => {
    put('a.md');
    const off = setup({ inbox: { enabled: false } });
    await off.pass(); await off.pass();
    expect(off.opened).toEqual([]);
    expect(off.logged).toEqual([]);

    const bad = setup({ inbox: { cwd: '' } });
    await bad.pass(); await bad.pass();
    expect(bad.opened).toEqual([]);
    expect(bad.logged).toEqual(['warn: [telegram-inbox] not started: claudeWt.telegramInbox.cwd is not set']);
  });

  it('a failed launch is logged and not retried', async () => {
    put('a.md');
    const { winMan, logged, pass } = setup();
    winMan.openInboxSession.mockResolvedValue({ ok: false, reason: 'claudeWt.launchInbox.args is empty' });
    await pass(); await pass(); await pass(); await pass();
    expect(winMan.openInboxSession).toHaveBeenCalledTimes(1);
    expect(logged).toContain('error: [telegram-inbox] failed to open a.md: claudeWt.launchInbox.args is empty (marked as opened, not retried)');
  });

  it('a file that vanishes between readdir and stat does not break the pass', () => {
    put('keep.md');
    const realStat = fs.statSync;
    const spy = vi.spyOn(fs, 'statSync').mockImplementation((p, ...rest) => {
      if (String(p).endsWith('keep.md')) {
        const e = new Error('ENOENT: no such file'); e.code = 'ENOENT'; throw e;
      }
      return realStat(p, ...rest);
    });
    put('other.md');
    try {
      const names = defaultFs.listDir(dir).filter(e => e.isFile).map(e => e.name);
      expect(names).toEqual(['other.md']);
    } finally {
      spy.mockRestore();
    }
  });
});
