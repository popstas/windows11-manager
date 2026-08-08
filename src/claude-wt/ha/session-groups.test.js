import { describe, it, expect } from 'vitest';
import {
  labelSessions, chooseAction, resolveDesktopSwitch,
  normalizeSort, DEFAULT_SORT,
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
