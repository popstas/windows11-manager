import { describe, it, expect, vi } from 'vitest';

// claudeWtWindowAgents: что из state.json и слота доезжает до кнопок панели
// задач и списка тихих звонка. Соседи view.js — заглушки.
vi.mock('../windows.js', () => ({ getWindows: () => [] }));
vi.mock('../monitors.js', () => ({ getMons: () => [] }));
vi.mock('./index.js', () => ({
  getClaudeWtConfig: () => ({ enabled: true, statePath: 's', progressDir: 'p' }),
  isTerminalWindow: () => true,
}));
vi.mock('./state.js', () => ({
  readState: () => ({
    slots: {
      q1: { focusedAt: 50 },
      // «Непросмотрено» от claude-session-unread: focusedAt откатан, unreadAt новее.
      u1: { focusedAt: 10, unreadAt: 60 },
      // Отметку перекрыл фокус окна после неё.
      f1: { focusedAt: 70, unreadAt: 60 },
    },
  }),
}));
vi.mock('./sessions.js', () => ({
  loadSessionIndexFor: () => ({}),
  loadSessionIndexAndOwnersFor: () => ({
    index: { 'quiet-head': { id: 'q1' }, 'unread-head': { id: 'u1' }, 'seen-head': { id: 'f1' } },
    owners: {},
  }),
  loadBackgroundAgentsFor: () => [],
  loadShellSessionsFor: () => new Set(),
}));
vi.mock('./progress.js', () => ({
  loadProgress: () => ({
    q1: { state: 'review', updated: 40, quiet: true },
    u1: { state: 'idle', updated: 40, quiet: true },
    f1: { state: 'idle', updated: 40, quiet: false },
  }),
}));

const { claudeWtWindowAgents } = await import('./view.js');

describe('claudeWtWindowAgents — тихий ход', () => {
  it('agentQuiet из state.json, agentUnread — unreadAt слота новее фокуса', () => {
    const got = claudeWtWindowAgents([
      { id: 1, title: '✳ quiet-head' }, { id: 2, title: 'unread-head' }, { id: 3, title: 'seen-head' },
    ]);
    expect(got.map(a => [a.sessionId, a.agentQuiet, a.agentUnread])).toEqual([
      ['q1', true, false],
      ['u1', true, true],
      ['f1', false, false],
    ]);
  });
});
