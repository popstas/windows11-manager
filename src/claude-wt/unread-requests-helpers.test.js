import { describe, it, expect } from 'vitest';
import { unreadSidecarPath, appendUnreadRequest, freshUnreadRequests, MAX_REQUESTS } from './unread-requests-helpers.js';

describe('unreadSidecarPath', () => {
  it('рядом с файлом состояния, оба вида разделителей', () => {
    expect(unreadSidecarPath('C:\\Users\\p\\AppData\\Local\\windows11-manager\\claude-wt.json'))
      .toBe('C:\\Users\\p\\AppData\\Local\\windows11-manager/unread-requests.json');
    expect(unreadSidecarPath('/tmp/x/claude-wt.json')).toBe('/tmp/x/unread-requests.json');
    expect(unreadSidecarPath('')).toBe('');
    expect(unreadSidecarPath(undefined)).toBe('');
  });
});

describe('appendUnreadRequest', () => {
  it('дописывает к пустому, битому и прежнему', () => {
    const r = { at: 5, ids: ['a'], unreadAt: 9 };
    expect(appendUnreadRequest(null, r)).toEqual({ requests: [r] });
    expect(appendUnreadRequest({ requests: 'мусор' }, r)).toEqual({ requests: [r] });
    expect(appendUnreadRequest({ requests: [{ at: 1, ids: ['b'], unreadAt: 2 }, { bad: 1 }] }, r))
      .toEqual({ requests: [{ at: 1, ids: ['b'], unreadAt: 2 }, r] });
  });
  it('держит только хвост', () => {
    let raw = null;
    for (let i = 1; i <= MAX_REQUESTS + 5; i += 1) raw = appendUnreadRequest(raw, { at: i, ids: ['a'], unreadAt: i });
    expect(raw.requests).toHaveLength(MAX_REQUESTS);
    expect(raw.requests[0].at).toBe(6);
  });
});

describe('freshUnreadRequests', () => {
  const raw = { requests: [
    { at: 10, ids: ['a', 'b'], unreadAt: 100 },
    { at: 30, ids: ['a'], unreadAt: 300 },
    { at: 20, ids: ['c'], unreadAt: 200 },
  ] };
  it('только новее отметки, по сессии — последняя просьба', () => {
    expect(freshUnreadRequests(raw, 10)).toEqual({ marks: { c: 200, a: 300 }, ids: ['c', 'a'], lastAt: 30 });
    expect(freshUnreadRequests(raw, 0).marks).toEqual({ a: 300, b: 100, c: 200 });
  });
  it('нечего применять — отметка не двигается', () => {
    expect(freshUnreadRequests(raw, 30)).toEqual({ marks: {}, ids: [], lastAt: 30 });
    expect(freshUnreadRequests(null, 7)).toEqual({ marks: {}, ids: [], lastAt: 7 });
  });
});
