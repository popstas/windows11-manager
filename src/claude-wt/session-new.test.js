import { describe, it, expect, vi } from 'vitest';

// project.js тянет за собой нативный модуль окон — здесь он не нужен.
vi.mock('./project.js', () => ({ focusSpawnedWindow: vi.fn(), focusNewTerminalWindow: vi.fn() }));
vi.mock('./index.js', () => ({ getClaudeWtConfig: vi.fn() }));
vi.mock('../windows.js', () => ({ getWindows: vi.fn(() => []) }));

const { openNewSession } = await import('./session-new.js');
const { mergeClaudeWtConfig } = await import('./daemon-helpers.js');

// Шаблон из config.example.yaml: обёртка ~/bin/claude-wt-new сама делает
// `$SHELL -ic 'cd …'` (иначе не сработает chpwd и телеметрия уйдёт без
// project=), здесь — только позиционные аргументы ей.
const REMOTE = `exec ~/bin/claude-wt-new '{cwd}' '{name}' '{sessionId}' '{promptFile}' '{permissionMode}' '{head}' '{headId}'`;

const cfg = mergeClaudeWtConfig({
  launchSession: { args: ['ssh', '-A', 'popstas@pc-virt.popstas.pro', '-t', REMOTE] },
  projects: [{ name: 'ExpertizeMe', cwd: '/vault', profiles: { wt: 'Expertize' } }],
});

const ID = '11111111-2222-4333-8444-555555555555';
const BODY = { cwd: '/vault', name: 'task-a', promptFile: '/tmp/head/task-a.md', head: 'boss' };

function run(body = BODY, over = {}) {
  const spawned = [];
  const spawnProcess = vi.fn((command, args) => {
    spawned.push({ command, args });
    return { unref() {} };
  });
  // Окно не находится никогда: ответ не должен его ждать.
  const focusByTitle = vi.fn(() => new Promise(() => {}));
  const focusNew = vi.fn(() => new Promise(() => {}));
  return openNewSession(body, {
    cfg, spawnProcess, focusByTitle, focusNew, listWindows: () => [], newId: () => ID, mark: () => {}, ...over,
  }).then(res => ({ res, spawned, focusByTitle, focusNew }));
}

describe('openNewSession', () => {
  it('spawns wt -> ssh -> claude-wt-new with the project profile and answers at once', async () => {
    const { res, spawned, focusByTitle } = await run();
    expect(res).toEqual({ ok: true, action: 'spawn', sessionId: ID, name: 'task-a' });
    expect(spawned).toEqual([{
      command: 'wt.exe',
      args: [
        '-w', '-1', '-p', 'Expertize',
        'ssh', '-A', 'popstas@pc-virt.popstas.pro', '-t',
        `exec ~/bin/claude-wt-new '/vault' 'task-a' '${ID}' '/tmp/head/task-a.md' '-' 'boss' '-'`,
      ],
    }]);
    expect(focusByTitle).toHaveBeenCalledWith('task-a', expect.any(Object));
  });

  it('with a cursor the window is caught by hwnd, not by title', async () => {
    const { focusByTitle, focusNew } = await run({ ...BODY, cursor: { x: 10, y: 20 } });
    expect(focusNew).toHaveBeenCalled();
    expect(focusByTitle).not.toHaveBeenCalled();
  });

  it('403 outside the whitelist spawns nothing', async () => {
    const { res, spawned } = await run({ ...BODY, cwd: '/etc' });
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(spawned).toEqual([]);
  });

  it('500 for an empty launchSession instead of a bare terminal', async () => {
    const { res, spawned } = await run(BODY, { cfg: mergeClaudeWtConfig({ projects: [{ name: 'v', cwd: '/vault' }] }) });
    expect(res).toEqual({ ok: false, status: 500, reason: 'claudeWt.launchSession.args is empty' });
    expect(spawned).toEqual([]);
  });

  it('500 when spawn throws', async () => {
    const spawnProcess = vi.fn(() => { throw new Error('ENOENT wt.exe'); });
    const { res } = await run(BODY, { spawnProcess });
    expect(res).toEqual({ ok: false, status: 500, action: 'spawn', reason: 'ENOENT wt.exe' });
  });
});
