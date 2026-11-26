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
      // Итог нетихого хода (loudAt 45) не смотрели: фокус был в 30.
      l1: { focusedAt: 30 },
      // Смотрели после него.
      l2: { focusedAt: 45 },
    },
  }),
}));
vi.mock('./sessions.js', () => ({
  loadSessionIndexFor: () => ({}),
  loadSessionIndexAndOwnersFor: () => ({
    index: {
      'quiet-head': { id: 'q1' }, 'unread-head': { id: 'u1' }, 'seen-head': { id: 'f1' },
      'loud-head': { id: 'l1' }, 'loud-seen': { id: 'l2' },
    },
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
    l1: { state: 'review', updated: 50, quiet: true, loudAt: 45 },
    l2: { state: 'review', updated: 50, quiet: true, loudAt: 45 },
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

  it('agentLoudUnseen — loudAt хука новее фокуса окна; без loudAt — false', () => {
    const got = claudeWtWindowAgents([
      { id: 1, title: 'loud-head' }, { id: 2, title: 'loud-seen' }, { id: 3, title: 'quiet-head' },
    ]);
    expect(got.map(a => [a.sessionId, a.agentLoudUnseen])).toEqual([['l1', true], ['l2', false], ['q1', false]]);
  });
});
