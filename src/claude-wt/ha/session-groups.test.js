import { describe, it, expect } from 'vitest';
import {
  labelSessions, groupSessions, buildSessionsPayload, chooseAction, resolveDesktopSwitch,
  cycleSort, normalizeSort, DEFAULT_SORT, SORT_MODES,
} from './session-groups.js';

const s = (over) => ({
  id: 'x', title: 't', cwd: '/p', bounds: { x: 0, y: 0, width: 10, height: 10 },
  desktop: 1, monitor: 1, monitorBounds: null, open: true, windowId: 1,
  agentCostUsd: 0, agentStarted: 0, lastActivity: null, ...over,
});

describe('session-groups', () => {
  it('labelSessions leaves a unique name alone', () => {
    const out = labelSessions([s({ id: 'aaaa1111', title: 'ccfzf' })]);
    expect(out[0].label).toBe('ccfzf');
  });

  // Двойников — переоткрытую сессию или пару «живая и протухшая» — раньше
  // различал хвост из четырёх знаков id прямо в имени. Теперь это делает колонка
  // короткого id со своим чекбоксом, а имя остаётся именем: тот же хвост тянулся
  // в заголовки диалогов и в текст слота на панели, где он не нужен вовсе.
  it('labelSessions leaves duplicates to the id column', () => {
    const out = labelSessions([
      s({ id: 'aaaa1111', title: 'agent', cwd: '/p/agent' }),
      s({ id: 'bbbb2222', title: 'agent', cwd: '/p/agent' }),
    ]);
    expect(out[0].label).toBe('agent');
    expect(out[1].label).toBe('agent');
  });

  it('labelSessions leaves same name in different projects alone', () => {
    const out = labelSessions([
      s({ id: 'a', title: 'agent', cwd: '/one' }),
      s({ id: 'b', title: 'agent', cwd: '/two' }),
    ]);
    expect(out[0].label).toBe('agent');
    expect(out[1].label).toBe('agent');
  });

  it('normalizeSort falls back to cost', () => {
    expect(normalizeSort('nope')).toBe(DEFAULT_SORT);
    expect(normalizeSort('recent')).toBe('recent');
  });

  it('cycleSort walks cost → oldest → newest → recent → name → cost', () => {
    expect(
      SORT_MODES.reduce((acc, _) => [...acc, cycleSort(acc[acc.length - 1])], ['cost']),
    ).toEqual(['cost', 'oldest', 'newest', 'recent', 'name', 'cost']);
  });

  it('groupSessions sorts by cost desc by default', () => {
    const [group] = groupSessions([
      s({ id: 'cheap', agentCostUsd: 1 }),
      s({ id: 'pricey', agentCostUsd: 40 }),
      s({ id: 'mid', agentCostUsd: 12 }),
    ]);
    expect(group.sessions.map(x => x.id)).toEqual(['pricey', 'mid', 'cheap']);
  });

  it('groupSessions oldest puts earliest started first', () => {
    const [group] = groupSessions([
      s({ id: 'new', agentStarted: 300 }),
      s({ id: 'old', agentStarted: 100 }),
      s({ id: 'mid', agentStarted: 200 }),
    ], 'oldest');
    expect(group.sessions.map(x => x.id)).toEqual(['old', 'mid', 'new']);
  });

  it('groupSessions newest puts latest started first', () => {
    const [group] = groupSessions([
      s({ id: 'old', agentStarted: 100 }),
      s({ id: 'new', agentStarted: 300 }),
    ], 'newest');
    expect(group.sessions.map(x => x.id)).toEqual(['new', 'old']);
  });

  it('groupSessions recent sorts by lastActivity desc', () => {
    const [group] = groupSessions([
      s({ id: 'stale', lastActivity: 10 }),
      s({ id: 'fresh', lastActivity: 90 }),
    ], 'recent');
    expect(group.sessions.map(x => x.id)).toEqual(['fresh', 'stale']);
  });

  it('groupSessions name sorts by label ascending', () => {
    const [group] = groupSessions([
      s({ id: 'b', title: 'zeta' }),
      s({ id: 'a', title: 'alpha' }),
    ], 'name');
    expect(group.sessions.map(x => x.id)).toEqual(['a', 'b']);
  });

  it('groupSessions sinks sessions with no sort key to the end', () => {
    const [group] = groupSessions([
      s({ id: 'known', agentCostUsd: 5 }),
      s({ id: 'blank', agentCostUsd: 0 }),
    ], 'cost');
    expect(group.sessions.map(x => x.id)).toEqual(['known', 'blank']);
  });

  it('groupSessions puts every live session in one group above the closed ones', () => {
    const groups = groupSessions([
      s({ id: 'closed1', open: false, desktop: 2 }),
      s({ id: 'live2', open: true, desktop: 2, title: 'b' }),
      s({ id: 'closed2', open: false, desktop: 1 }),
      s({ id: 'live1', open: true, desktop: 1, title: 'a' }),
    ], 'name');
    expect(groups.map(g => g.label)).toEqual(['Active sessions - 2', 'Desktop 1', 'Desktop 2']);
    // Live sessions are not split by desktop: 'live1' and 'live2' sit on
    // different desktops and still share the top group.
    expect(groups[0].sessions.map(x => x.id)).toEqual(['live1', 'live2']);
    expect(groups[1].sessions.map(x => x.id)).toEqual(['closed2']);
    expect(groups[2].sessions.map(x => x.id)).toEqual(['closed1']);
  });

  it('groupSessions omits the active group entirely when nothing is open', () => {
    const groups = groupSessions([s({ id: 'a', open: false, desktop: 1 })]);
    expect(groups.map(g => g.label)).toEqual(['Desktop 1']);
  });

  it('groupSessions omits the desktop groups when everything is open', () => {
    const groups = groupSessions([s({ id: 'a', open: true, desktop: 1 })]);
    expect(groups.map(g => g.label)).toEqual(['Active sessions - 1']);
  });

  it('groupSessions ignores the monitor when splitting closed sessions', () => {
    // Monitors get switched far more often than slots live, so a monitor number
    // on a closed session says little — and splitting by it scattered the past
    // across twice as many groups.
    const groups = groupSessions([
      s({ id: 'a', open: false, desktop: 1, monitor: 1 }),
      s({ id: 'b', open: false, desktop: 1, monitor: 2 }),
    ]);
    expect(groups.map(g => g.label)).toEqual(['Desktop 1']);
    expect(groups[0].sessions.length).toBe(2);
  });

  it('groupSessions puts an unknown desktop before the real ones', () => {
    const groups = groupSessions([
      s({ id: 'a', open: false, desktop: 1 }),
      s({ id: 'c', open: false, desktop: null }),
    ]);
    expect(groups.map(g => g.label)).toEqual(['Desktop —', 'Desktop 1']);
  });

  it('groupSessions tolerates a session with no bounds', () => {
    const [group] = groupSessions([s({ id: 'a', bounds: null })]);
    expect(group.sessions.map(x => x.id)).toEqual(['a']);
  });

  it('groupSessions returns an empty list for an empty input', () => {
    const groups = groupSessions([]);
    expect(groups).toEqual([]);
  });

  it('buildSessionsPayload labels and groups sessions on the ok path', () => {
    const sessions = [
      s({ id: 'aaaa1111', title: 'agent', cwd: '/p/agent', desktop: 2, monitor: 1, open: false }),
      s({ id: 'bbbb2222', title: 'agent', cwd: '/p/agent', desktop: 1, monitor: 1, open: false }),
    ];
    const payload = buildSessionsPayload({ ok: true, sessions });

    expect(payload.ok).toBe(true);
    expect(payload.sort).toBe('cost');
    // groupSessions ran: two closed sessions on different desktops became two
    // groups, sorted ascending (2 before 1 in the input, 1 before 2 in output).
    expect(payload.groups.map(g => g.label)).toEqual(['Desktop 1', 'Desktop 2']);
    // labelSessions ran: у каждой строки есть label, а не только заголовок окна.
    expect(payload.groups[0].sessions[0].label).toBe('agent');
    expect(payload.groups[1].sessions[0].label).toBe('agent');
  });

  it('buildSessionsPayload carries the chosen sort mode', () => {
    const payload = buildSessionsPayload({ ok: true, sessions: [] }, 'name');
    expect(payload.sort).toBe('name');
  });

  it('buildSessionsPayload carries the reason through unchanged on the failure path', () => {
    const payload = buildSessionsPayload({ ok: false, reason: 'claudeWt.enabled is false in config' });
    expect(payload).toEqual({ ok: false, reason: 'claudeWt.enabled is false in config' });
  });

  it('chooseAction focuses a session that is open', () => {
    expect(chooseAction({ open: true, windowId: 5 }, () => true)).toBe('focus');
  });

  it('chooseAction restores a session that is closed', () => {
    expect(chooseAction({ open: false, windowId: null }, () => true)).toBe('restore');
  });

  it('chooseAction restores when the handle died since the list was drawn', () => {
    expect(chooseAction({ open: true, windowId: 5 }, () => false)).toBe('restore');
  });

  it('chooseAction restores a closed session even when isAlive would say no', () => {
    // Completes the 2x2 matrix: open=false, isAlive=false. Same outcome as the
    // open=false/isAlive=true case, but only a distinct isAlive call proves the
    // 'open' check, not the liveness check, is what drove the 'restore' result.
    expect(chooseAction({ open: false, windowId: null }, () => false)).toBe('restore');
  });

  it('chooseAction never calls isAlive for a closed session', () => {
    let called = false;
    chooseAction({ open: false, windowId: null }, () => { called = true; return true; });
    expect(called).toBe(false);
  });

  it('chooseAction restores an open session with no window id without checking liveness', () => {
    expect(chooseAction({ open: true, windowId: null }, () => true)).toBe('restore');
  });

  it('resolveDesktopSwitch targets the live desktop', () => {
    expect(resolveDesktopSwitch(5)).toBe(5);
  });

  it('resolveDesktopSwitch returns null when the live desktop is undefined', () => {
    expect(resolveDesktopSwitch(undefined)).toBe(null);
  });

  it('resolveDesktopSwitch returns null when the live desktop is null', () => {
    expect(resolveDesktopSwitch(null)).toBe(null);
  });

  it('resolveDesktopSwitch converts the live number as-is, no off-by-one', () => {
    // Pins the exact off-by-one bug: GoToDesktopNumber is 0-based. Desktop 0
    // (the very first desktop) must resolve to 0, not be treated as falsy/unknown.
    expect(resolveDesktopSwitch(0)).toBe(0);
  });

  // windows11-manager's GetWindowDesktopNumber (virtual-desktop.js) regex-matches
  // "desktop number (\d+)" out of CLI text output and returns the capture group
  // unconverted — a string, not a number. This is the real-world shape the
  // helper's Number() coercion exists to handle; nothing above pins it.
  it('resolveDesktopSwitch coerces a string desktop number to a number', () => {
    const result = resolveDesktopSwitch('3');
    expect(result).toBe(3);
    expect(typeof result).toBe('number');
  });

  it('resolveDesktopSwitch coerces the string "0" to numeric 0, not "unknown"', () => {
    // '0' is truthy as a string but must resolve to the number 0, and must NOT
    // be confused with the null/undefined "unknown" sentinels.
    const result = resolveDesktopSwitch('0');
    expect(result).toBe(0);
    expect(typeof result).toBe('number');
    expect(result).not.toBe(null);
  });
});
