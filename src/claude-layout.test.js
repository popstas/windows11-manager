import { describe, it, expect, vi } from 'vitest';

const arrangeGroup = vi.fn(async () => ({ ok: true, placed: 2 }));
vi.mock('./claude-wt/group-layout.js', () => ({ arrangeGroup: (...a) => arrangeGroup(...a) }));
vi.mock('./windows.js', () => ({ focusWindowById: vi.fn(), getActiveWindowId: vi.fn(), getWindowById: vi.fn() }));
vi.mock('./placement.js', () => ({ placeWindow: vi.fn() }));
vi.mock('./claude-wt/view.js', () => ({ claudeWtSessions: vi.fn() }));
vi.mock('./virtual-desktop.js', () => ({ virtualDesktop: {} }));
vi.mock('./monitors.js', () => ({ getMonitorByPoint: vi.fn(), getPrimaryMonitor: vi.fn() }));
vi.mock('./fancyzones.js', () => ({ fancyZonesToPos: vi.fn() }));
vi.mock('./config.js', () => ({ getConfig: () => ({}) }));

const { arrangeClaudeWindows } = await import('./claude-layout.js');

describe('arrangeClaudeWindows', () => {
  // Группа идёт своей дорогой, мимо tileZones и рабочей области.
  it('mode group отдаёт группы и selected в arrangeGroup', async () => {
    const log = vi.fn();
    const res = await arrangeClaudeWindows({ mode: 'group', groups: [['h', 'c']], selected: 'c', log });
    expect(res).toEqual({ ok: true, placed: 2 });
    expect(arrangeGroup).toHaveBeenCalledWith({ groups: [['h', 'c']], selected: 'c', log });
  });
});
