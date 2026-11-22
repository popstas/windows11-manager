import { describe, it, expect, vi } from 'vitest';

vi.mock('./view.js', () => ({ claudeWtSessions: vi.fn() }));
vi.mock('../windows.js', () => ({ getWindowById: vi.fn() }));
vi.mock('../placement.js', () => ({ placeWindow: vi.fn() }));
vi.mock('../no-autoplace.js', () => ({ markNoAutoplace: vi.fn() }));
vi.mock('./head-zones.js', () => ({ resolveZone: vi.fn() }));

const { placeSessionInZone } = await import('./zone-place.js');

const RECT = { x: 2036, y: 0, width: 1096, height: 1168 };
const win = (id, bounds = { x: 10, y: 10, width: 800, height: 600 }) => ({ id, getBounds: () => bounds, bringToTop: vi.fn() });

function harness({ sessions, windows, zone = { rect: RECT }, place } = {}) {
  const ws = windows ?? new Map([[7, win(7)]]);
  const d = {
    sessions: vi.fn(() => ({ ok: true, sessions: sessions ?? [{ id: 's1', title: 'my-session', open: true, windowId: 7 }] })),
    getWindow: vi.fn(id => ws.get(id) ?? null),
    resolveZone: vi.fn(() => zone),
    place: vi.fn(place ?? (async () => ({ changes: [{ name: 'bounds' }], skipped: [] }))),
    markNoAutoplace: vi.fn(),
  };
  return { d, ws };
}

const Z = { monitor: 3, position: 1 };

describe('placeSessionInZone', () => {
  it('ставит окно в прямоугольник зоны, без подъёма и с пометкой для автоматики', async () => {
    const { d, ws } = harness();
    const log = vi.fn();
    const res = await placeSessionInZone({ id: 's1', zone: Z, log }, d);
    expect(res).toEqual({ ok: true, placed: 1, zone: '3:1' });
    expect(d.resolveZone).toHaveBeenCalledWith(Z);
    expect(d.place).toHaveBeenCalledWith({ w: ws.get(7), rule: { pos: RECT }, isBulk: true });
    expect(d.markNoAutoplace).toHaveBeenCalledWith(7);
    expect(ws.get(7).bringToTop).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('3:1'));
  });

  it('окно уже в зоне — placed 0, это успех', async () => {
    const { d } = harness({ place: async () => ({ changes: [], skipped: [] }) });
    expect(await placeSessionInZone({ id: 's1', zone: Z }, d)).toEqual({ ok: true, placed: 0, zone: '3:1' });
  });

  it('без id и без зоны — отказ с причиной до чтения сессий', async () => {
    const { d } = harness();
    expect((await placeSessionInZone({ id: null, zone: Z }, d)).reason).toMatch(/no id/);
    expect((await placeSessionInZone({ id: 's1', zone: null }, d)).reason).toMatch(/no zone/);
    expect(d.sessions).not.toHaveBeenCalled();
  });

  it('сессии нет, она закрыта или окно пропало — дословно no window', async () => {
    const none = harness({ sessions: [] });
    expect(await placeSessionInZone({ id: 's1', zone: Z }, none.d)).toEqual({ ok: false, reason: 'no window' });
    const closed = harness({ sessions: [{ id: 's1', open: false, windowId: 7 }] });
    expect(await placeSessionInZone({ id: 's1', zone: Z }, closed.d)).toEqual({ ok: false, reason: 'no window' });
    const gone = harness({ windows: new Map() });
    expect(await placeSessionInZone({ id: 's1', zone: Z }, gone.d)).toEqual({ ok: false, reason: 'no window' });
    const dead = harness({ windows: new Map([[7, { id: 7, getBounds: () => { throw new Error('dead'); } }]]) });
    expect(await placeSessionInZone({ id: 's1', zone: Z }, dead.d)).toEqual({ ok: false, reason: 'no window' });
    expect(dead.d.place).not.toHaveBeenCalled();
  });

  it('свёрнутое окно — отказ, а не placed 0', async () => {
    const { d } = harness({ windows: new Map([[7, win(7, { x: -32000, y: -32000, width: 160, height: 28 })]]) });
    expect(await placeSessionInZone({ id: 's1', zone: Z }, d)).toEqual({ ok: false, reason: 'window is minimized' });
    expect(d.place).not.toHaveBeenCalled();
  });

  it('зона не разрешилась — причина от resolveZone, окно не тронуто', async () => {
    const { d } = harness({ zone: { error: 'zone 3:9 is not in the FancyZones layout of monitor 3 (zones 1..4)' } });
    expect(await placeSessionInZone({ id: 's1', zone: { monitor: 3, position: 9 } }, d))
      .toEqual({ ok: false, reason: 'zone 3:9 is not in the FancyZones layout of monitor 3 (zones 1..4)' });
    expect(d.place).not.toHaveBeenCalled();
    expect(d.markNoAutoplace).not.toHaveBeenCalled();
  });

  it('placeWindow отказал (узкое окно), пропустил или бросил — отказ с причиной', async () => {
    const narrow = harness({ place: async () => false });
    expect((await placeSessionInZone({ id: 's1', zone: Z }, narrow.d)).reason).toMatch(/narrow/);
    const skipped = harness({ place: async () => ({ changes: [], skipped: [{ name: 'bounds' }] }) });
    expect((await placeSessionInZone({ id: 's1', zone: Z }, skipped.d)).reason).toBe('window is minimized');
    const threw = harness({ place: async () => { throw new Error('boom'); } });
    expect(await placeSessionInZone({ id: 's1', zone: Z }, threw.d)).toEqual({ ok: false, reason: 'window was not moved: boom' });
  });

  it('список сессий не прочитался — причина оттуда', async () => {
    const { d } = harness();
    d.sessions.mockReturnValue({ ok: false, reason: 'state not readable' });
    expect(await placeSessionInZone({ id: 's1', zone: Z }, d)).toEqual({ ok: false, reason: 'state not readable' });
  });
});
