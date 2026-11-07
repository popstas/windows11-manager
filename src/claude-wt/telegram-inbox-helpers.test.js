import { describe, it, expect } from 'vitest';
import {
  inboxSkipReason,
  isSyncthingTemp,
  inboxSessionName,
  parseInboxFileName,
  uniqueSessionName,
  keepSessionsOf,
  inboxRemoteFile,
  normalizeInboxConfig,
  inboxStatePathNextTo,
  planInboxTick,
  pruneProcessed,
  parseInboxState,
  serializeInboxState,
} from './telegram-inbox-helpers.js';

describe('inboxSkipReason', () => {
  it.each([
    ['2026-11-05-msg.md'],
    ['Пересылка от Васи.md'],
    ['note.MD'],
  ])('opens %s', (name) => {
    expect(inboxSkipReason(name)).toBeNull();
  });

  it.each([
    ['.hidden.md', 'hidden'],
    ['.syncthing.msg.md.tmp', 'syncthing temp'],
    ['~syncthing~msg.md.tmp', 'syncthing temp'],
    ['msg.sync-conflict-20261105-120000-ABCDEFG.md', 'conflict'],
    ['msg.txt', 'not a .md'],
    ['msg.md.tmp', 'not a .md'],
    ['a;b.md', 'characters'],
    ["it's.md", 'characters'],
    ['a"b.md', 'characters'],
    ['$HOME.md', 'characters'],
    ['', 'empty'],
  ])('skips %s', (name, reason) => {
    expect(inboxSkipReason(name)).toContain(reason);
  });
});

describe('names and paths', () => {
  it('session name is tg-<basename> without a template', () => {
    expect(inboxSessionName('2026-11-05-msg.md')).toEqual({ name: 'tg-2026-11-05-msg', warning: null });
    expect(inboxSessionName('2026-11-05-msg.md', '')).toEqual({ name: 'tg-2026-11-05-msg', warning: null });
  });

  it('parses <date>_<time>_<user>_<id>.md', () => {
    expect(parseInboxFileName('2026-11-06_06-04-22_Olgazdez_424254.md')).toEqual({
      base: '2026-11-06_06-04-22_Olgazdez_424254',
      date: '2026-11-06',
      time: '06-04-22',
      user: 'Olgazdez',
      id: '424254',
    });
    // `_` в имени пользователя Telegram разрешён: id — последний числовой кусок.
    expect(parseInboxFileName('2026-11-06_06-04-22_Olga_zdez_1.md').user).toBe('Olga_zdez');
    expect(parseInboxFileName('2026-11-05-msg.md')).toBeNull();
    expect(parseInboxFileName('2026-11-06_06-04-22__424254.md')).toBeNull();
  });

  it('renders the template from the file name', () => {
    const file = '2026-11-06_06-04-22_Olgazdez_424254.md';
    expect(inboxSessionName(file, '{user}-tg-{date}')).toEqual({ name: 'Olgazdez-tg-2026-11-06', warning: null });
    expect(inboxSessionName(file, '{user}-{date}-{time}-{id}').name).toBe('Olgazdez-2026-11-06-06-04-22-424254');
    expect(inboxSessionName(file, 'x-{base}').name).toBe('x-2026-11-06_06-04-22_Olgazdez_424254');
  });

  it('leaves an unknown placeholder as is', () => {
    expect(inboxSessionName('2026-11-06_06-04-22_Olgazdez_424254.md', '{user}-{chat}').name)
      .toBe('Olgazdez-{chat}');
  });

  it('falls back to tg-<basename> when the file name does not fit the template', () => {
    const res = inboxSessionName('2026-11-05-msg.md', '{user}-tg-{date}');
    expect(res.name).toBe('tg-2026-11-05-msg');
    expect(res.warning).toContain('does not match');
    // {base} есть у любого файла: разбор не нужен, и откатываться не на что.
    expect(inboxSessionName('2026-11-05-msg.md', 'x-{base}')).toEqual({ name: 'x-2026-11-05-msg', warning: null });
  });

  it('falls back when the rendered name cannot reach the remote shell', () => {
    const file = '2026-11-06_06-04-22_Olgazdez_424254.md';
    for (const tpl of ['{user};x', "{user}'x", '$HOME-{user}', '   ']) {
      const res = inboxSessionName(file, tpl);
      expect(res.name).toBe('tg-2026-11-06_06-04-22_Olgazdez_424254');
      expect(res.warning).toBeTruthy();
    }
  });

  it('numbers a repeated session name', () => {
    expect(uniqueSessionName('a', new Set())).toBe('a');
    expect(uniqueSessionName('a', new Set(['a']))).toBe('a-2');
    expect(uniqueSessionName('a', new Set(['a', 'a-2']))).toBe('a-3');
    expect(uniqueSessionName('a', new Set(['a-2']))).toBe('a');
  });

  it('remote file is vault-relative', () => {
    expect(inboxRemoteFile('files/incoming-telegram', 'a.md')).toBe('files/incoming-telegram/a.md');
    expect(inboxRemoteFile('/files/incoming-telegram/', 'a.md')).toBe('files/incoming-telegram/a.md');
    expect(inboxRemoteFile('', 'a.md')).toBe('a.md');
  });

  it('state file sits next to claudeWt.statePath', () => {
    expect(inboxStatePathNextTo('C:\\Users\\p\\AppData\\Local\\windows11-manager\\claude-wt.json'))
      .toBe('C:\\Users\\p\\AppData\\Local\\windows11-manager\\telegram-inbox.json');
    expect(inboxStatePathNextTo('/tmp/x/claude-wt.json')).toBe('/tmp/x/telegram-inbox.json');
    expect(inboxStatePathNextTo('')).toBe('');
  });
});

describe('normalizeInboxConfig', () => {
  const full = { enabled: true, dir: 'C:/in', cwd: '/vault', script: '.scripts/telegram-incoming', fileDir: 'files/incoming-telegram' };

  it('is disabled unless enabled is exactly true', () => {
    expect(normalizeInboxConfig({ ...full, enabled: 'yes' }).cfg.enabled).toBe(false);
  });

  it('names the missing key', () => {
    expect(normalizeInboxConfig({ ...full, dir: '' }).problem).toContain('dir');
    expect(normalizeInboxConfig({ ...full, cwd: ' ' }).problem).toContain('cwd');
    expect(normalizeInboxConfig(full).problem).toContain('statePath');
    expect(normalizeInboxConfig(full, { statePath: '/s/claude-wt.json' }).problem).toBeNull();
  });

  it('explicit statePath wins over the derived one', () => {
    const { cfg } = normalizeInboxConfig({ ...full, statePath: '/own.json' }, { statePath: '/s/claude-wt.json' });
    expect(cfg.statePath).toBe('/own.json');
  });

  it('session name template defaults to tg-{base}', () => {
    expect(normalizeInboxConfig({}).cfg.sessionName).toBe('tg-{base}');
    expect(normalizeInboxConfig({ sessionName: ' {user}-tg-{date} ' }).cfg.sessionName).toBe('{user}-tg-{date}');
  });

  it('falls back on bad numbers', () => {
    const { cfg } = normalizeInboxConfig({ ...full, pollMs: -1, settleMs: 'x', gapMs: 0 });
    expect(cfg.pollMs).toBe(3000);
    expect(cfg.settleMs).toBe(2000);
    expect(cfg.gapMs).toBe(0);
  });
});

describe('planInboxTick', () => {
  const file = (name, size = 10, mtimeMs = 1) => ({ name, isFile: true, size, mtimeMs });

  it('opens a file only after it stopped changing for settleMs', () => {
    let r = planInboxTick({ entries: [file('a.md', 5)], now: 0, settleMs: 2000 });
    expect(r.ready).toEqual([]);
    r = planInboxTick({ entries: [file('a.md', 10, 2)], now: 1000, seen: r.seen, settleMs: 2000 });
    expect(r.ready).toEqual([]);
    r = planInboxTick({ entries: [file('a.md', 10, 2)], now: 2000, seen: r.seen, settleMs: 2000 });
    expect(r.ready).toEqual([]);
    r = planInboxTick({ entries: [file('a.md', 10, 2)], now: 3000, seen: r.seen, settleMs: 2000 });
    expect(r.ready).toEqual(['a.md']);
  });

  it('never opens a file on its first sighting, even with settleMs 0', () => {
    const r = planInboxTick({ entries: [file('a.md')], now: 0, settleMs: 0 });
    expect(r.ready).toEqual([]);
  });

  it('ignores directories such as processed/', () => {
    const r = planInboxTick({ entries: [{ name: 'processed', isFile: false }], now: 0 });
    expect(r).toMatchObject({ ready: [], skipped: [] });
  });

  it('skips syncthing temp files silently', () => {
    expect(isSyncthingTemp('.syncthing.x.md.tmp')).toBe(true);
    expect(isSyncthingTemp('~syncthing~x.md.tmp')).toBe(true);
    expect(isSyncthingTemp('.hidden.md')).toBe(false);
    const r = planInboxTick({ entries: [file('.syncthing.x.md.tmp'), file('~syncthing~y.md.tmp')], now: 0 });
    expect(r).toMatchObject({ ready: [], skipped: [] });
  });

  it('skips opened, queued and filtered names; says why once', () => {
    const entries = [file('done.md'), file('queued.md'), file('.hidden.md'), file('new.md')];
    const processed = { 'done.md': 1 };
    const busy = new Set(['queued.md']);
    let r = planInboxTick({ entries, now: 0, processed, busy, settleMs: 0 });
    expect(r.skipped).toEqual([
      { name: 'done.md', reason: 'already opened' },
      { name: '.hidden.md', reason: 'hidden or syncthing temp file' },
    ]);
    r = planInboxTick({ entries, now: 1, seen: r.seen, reported: r.reported, processed, busy, settleMs: 0 });
    expect(r.skipped).toEqual([]);
    expect(r.ready).toEqual(['new.md']);
  });

  it('forgets a vanished file, so it is reported again if it returns', () => {
    let r = planInboxTick({ entries: [file('x.txt')], now: 0 });
    r = planInboxTick({ entries: [], now: 1, reported: r.reported });
    r = planInboxTick({ entries: [file('x.txt')], now: 2, reported: r.reported });
    expect(r.skipped).toEqual([{ name: 'x.txt', reason: 'not a .md file' }]);
  });
});

describe('pruneProcessed', () => {
  it('keeps present files and recent absences, drops old absences', () => {
    const day = 24 * 60 * 60 * 1000;
    const processed = { here: 0, gone_recent: 5 * day, gone_old: 0 };
    expect(pruneProcessed(processed, new Set(['here']), 5.5 * day))
      .toEqual({ here: 0, gone_recent: 5 * day });
  });
});

describe('keepSessionsOf', () => {
  it('keeps session names only of files still remembered', () => {
    expect(keepSessionsOf({ 'a.md': 'x', 'b.md': 'y' }, { 'a.md': 1 })).toEqual({ 'a.md': 'x' });
    expect(keepSessionsOf(undefined, { 'a.md': 1 })).toEqual({});
  });
});

describe('state file', () => {
  it('round-trips', () => {
    const text = serializeInboxState({ processed: { 'a.md': 5 }, sessions: { 'a.md': 'tg-a' } });
    expect(parseInboxState(text)).toEqual({ processed: { 'a.md': 5 }, sessions: { 'a.md': 'tg-a' } });
  });

  it('reads a state file written before session names were kept', () => {
    expect(parseInboxState('{"version":1,"processed":{"a.md":5}}'))
      .toEqual({ processed: { 'a.md': 5 }, sessions: {} });
  });

  it('broken file is an empty memory', () => {
    expect(parseInboxState('{oops')).toEqual({ processed: {}, sessions: {} });
    expect(parseInboxState('{"processed":{"a.md":"x"}}')).toEqual({ processed: {}, sessions: {} });
    expect(parseInboxState('{"processed":{"a.md":5},"sessions":{"a.md":7,"b.md":"x"}}'))
      .toEqual({ processed: { 'a.md': 5 }, sessions: {} });
  });
});
