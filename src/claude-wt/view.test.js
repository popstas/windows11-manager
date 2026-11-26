import { describe, it, expect, vi } from 'vitest';

// Тяжёлые соседи view.js (аддон окон, мониторы) здесь не нужны — только
// сопоставление заголовка с сессией.
vi.mock('../windows.js', () => ({ getWindows: () => [] }));
vi.mock('../monitors.js', () => ({ getMons: () => [] }));
vi.mock('./index.js', () => ({
  getClaudeWtConfig: () => ({ enabled: true, statePath: 's' }),
  isTerminalWindow: () => true,
}));
vi.mock('./state.js', () => ({
  readState: () => ({ slots: { a1: { focusedAt: 5, cwd: '/p/exp' }, w1: { titles: ['wt-slot'], cwd: '/p/exp.feat', lastSeen: 1 } } }),
}));
vi.mock('./sessions.js', () => ({
  loadSessionIndexFor: () => ({}),
  loadSessionIndexAndOwnersFor: () => ({
    index: {
      'planfix_bot-tg-1': { id: 'a1', cwd: '/p/exp' },
      'wt-child': { id: 'w2', cwd: '/p/exp.feat' },
    },
    owners: { w1: '/p/exp', w2: '/p/exp' },
  }),
  loadBackgroundAgentsFor: () => [],
  loadShellSessionsFor: () => [],
}));

const { claudeWtWindowSessions } = await import('./view.js');

describe('claudeWtWindowSessions — заголовок для значков проекта', () => {
  // По этому полю iconFor выбирает значок badges: сырой заголовок с глифом
  // или приставкой zellij сломал бы каждое правило с `^`, и planfix_bot-tg-…
  // молча получал бы значок telegram.
  it('отдаёт заголовок без глифа и приставки zellij — тот, по которому найдена сессия', () => {
    const got = claudeWtWindowSessions([{ id: 7, title: 'popstas | ✳ planfix_bot-tg-1' }]);
    expect(got).toEqual([{ id: 7, sessionId: 'a1', cwd: '/p/exp', projectCwd: '', focusedAt: 5, unreadAt: 0, title: 'planfix_bot-tg-1' }]);
  });
});

describe('claudeWtWindowSessions — владелец сессии', () => {
  // По projectCwd iconFor берёт иконку и значки основного проекта у сессии
  // из worktree. Владелец ищется по id, а не по заголовку.
  it('сессия из дампа несёт projectCwd владельца', () => {
    expect(claudeWtWindowSessions([{ id: 8, title: 'wt-child' }])[0])
      .toMatchObject({ sessionId: 'w2', cwd: '/p/exp.feat', projectCwd: '/p/exp' });
  });

  it('и сессия, найденная по слоту, — тоже по id', () => {
    expect(claudeWtWindowSessions([{ id: 9, title: 'wt-slot' }])[0])
      .toMatchObject({ sessionId: 'w1', cwd: '/p/exp.feat', projectCwd: '/p/exp' });
  });
});
