import { describe, it, expect } from 'vitest';
import {
  inboxSkipReason,
  inboxSessionName,
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
  it('session name is tg-<basename>', () => {
    expect(inboxSessionName('2026-11-05-msg.md')).toBe('tg-2026-11-05-msg');
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

  it('skips opened, queued and filtered names; says why once', () => {
    const entries = [file('done.md'), file('queued.md'), file('.syncthing.x.md.tmp'), file('new.md')];
    const processed = { 'done.md': 1 };
    const busy = new Set(['queued.md']);
    let r = planInboxTick({ entries, now: 0, processed, busy, settleMs: 0 });
    expect(r.skipped).toEqual([
      { name: 'done.md', reason: 'already opened' },
      { name: '.syncthing.x.md.tmp', reason: 'hidden or syncthing temp file' },
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

describe('state file', () => {
  it('round-trips', () => {
    const text = serializeInboxState({ processed: { 'a.md': 5 } });
    expect(parseInboxState(text)).toEqual({ processed: { 'a.md': 5 } });
  });

  it('broken file is an empty memory', () => {
    expect(parseInboxState('{oops')).toEqual({ processed: {} });
    expect(parseInboxState('{"processed":{"a.md":"x"}}')).toEqual({ processed: {} });
  });
});
