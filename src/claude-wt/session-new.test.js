import { describe, it, expect, vi } from 'vitest';

// project.js тянет за собой нативный модуль окон — здесь он не нужен.
vi.mock('./project.js', () => ({ focusSpawnedWindow: vi.fn(), focusNewTerminalWindow: vi.fn(), placeSpawnedWindow: vi.fn() }));
vi.mock('./child-place.js', () => ({ placeChildWindow: vi.fn() }));
vi.mock('./view.js', () => ({ claudeWtSessions: vi.fn(() => ({ ok: false })) }));
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

  // Ребёнок head-сессии ставится по зоне: хвост идёт по имени сессии (там
  // есть хук place), а курсор остаётся только для отката.
  describe('ребёнок head', () => {
    const ZCFG = mergeClaudeWtConfig({
      launchSession: { args: ['ssh', '-A', 'popstas@pc-virt.popstas.pro', '-t', REMOTE] },
      projects: [{ name: 'ExpertizeMe', cwd: '/vault', profiles: { wt: 'Expertize' } }],
      headZones: { 1: [3, 4] },
    });
    const HEAD_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

    it('с headId хвост идёт по имени даже при cursor, и в нём есть place', async () => {
      const { focusByTitle, focusNew } = await run({ ...BODY, headId: HEAD_ID, cursor: { x: 10, y: 20 } }, { cfg: ZCFG });
      expect(focusNew).not.toHaveBeenCalled();
      expect(focusByTitle).toHaveBeenCalledWith('task-a', expect.objectContaining({ place: expect.any(Function) }));
    });

    it('верная zone доезжает до placeChild', async () => {
      const placeChild = vi.fn(async () => ({ desktop: 1, focus: true }));
      const { focusByTitle } = await run({ ...BODY, zone: { monitor: 1, position: 4 } }, { cfg: ZCFG, placeChild });
      const { place } = focusByTitle.mock.calls[0][1];
      const w = { id: 5 };
      expect(await place(w, 'task-a', () => 0, null)).toEqual({ desktop: 1, focus: true });
      expect(placeChild).toHaveBeenCalledWith(w, expect.objectContaining({
        sessionId: ID, headId: null, zone: { monitor: 1, position: 4 }, name: 'task-a',
      }));
    });

    it('чужая zone — 400, и spawn не звался', async () => {
      const { res, spawned } = await run({ ...BODY, zone: { monitor: 2, position: 1 } }, { cfg: ZCFG });
      expect(res).toMatchObject({ ok: false, status: 400 });
      expect(spawned).toEqual([]);
    });

    it('placeChild без плана — старая дорога placeSpawnedWindow', async () => {
      const placeChild = vi.fn(async () => null);
      const placeOld = vi.fn(async () => 2);
      const { focusByTitle } = await run({ ...BODY, headId: HEAD_ID }, { cfg: ZCFG, placeChild, placeOld });
      const { place } = focusByTitle.mock.calls[0][1];
      const w = { id: 5 };
      expect(await place(w, 'task-a', () => 0, null)).toBe(2);
      expect(placeOld).toHaveBeenCalledWith(w, 'task-a', expect.any(Function), null);
    });

    it('placeChild бросил — тоже старая дорога, а не падение хвоста', async () => {
      const placeChild = vi.fn(async () => { throw new Error('boom'); });
      const placeOld = vi.fn(async () => null);
      const { focusByTitle } = await run({ ...BODY, headId: HEAD_ID }, { cfg: ZCFG, placeChild, placeOld });
      const { place } = focusByTitle.mock.calls[0][1];
      await expect(place({ id: 5 }, 'task-a', () => 0, null)).resolves.toBeNull();
      expect(placeOld).toHaveBeenCalled();
    });

    it('без headId и zone — хвост как раньше, без place', async () => {
      const { focusByTitle } = await run(BODY, { cfg: ZCFG });
      expect(focusByTitle.mock.calls[0][1]).not.toHaveProperty('place');
    });
  });

  // Spawn по проекту head: каталог под childCwdRoot, профиль от проекта head.
  describe('ребёнок вне claudeWt.projects', () => {
    const ENV_REMOTE = `exec env CCFZF_CHILD_CWD_ROOT='{childCwdRoot}' ~/bin/claude-wt-new '{cwd}' '{name}' '{sessionId}' '{promptFile}' '{permissionMode}' '{head}' '{headId}'`;
    const RCFG = mergeClaudeWtConfig({
      launchSession: { args: ['ssh', '-A', 'popstas@pc-virt.popstas.pro', '-t', ENV_REMOTE] },
      projects: [{ name: 'ExpertizeMe', cwd: '/vault', profiles: { wt: 'Expertize' } }],
      childCwdRoot: '/home/popstas/projects',
    });
    const HEAD_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const CHILD = { ...BODY, cwd: '/home/popstas/projects/js/amnezia', headId: HEAD_ID, headCwd: '/vault', profileCwd: '/vault' };

    it('ребёнок под корнем — профиль от profileCwd и корень в команде', async () => {
      const { res, spawned } = await run(CHILD, { cfg: RCFG, liveHeadIds: () => new Set([HEAD_ID]) });
      expect(res.ok).toBe(true);
      expect(spawned[0].args).toEqual(expect.arrayContaining(['-p', 'Expertize']));
      expect(spawned[0].args.at(-1)).toContain("CCFZF_CHILD_CWD_ROOT='/home/popstas/projects'");
      expect(spawned[0].args.at(-1)).toContain("'/home/popstas/projects/js/amnezia'");
    });

    // Ревью 12.11: без {childCwdRoot} в шаблоне обёртка корень не перепроверит,
    // и симлинк под корнем, ведущий наружу, прошёл бы молча. Отказ, а не тишина.
    it('шаблон без {childCwdRoot} — 500 на втором проходе, spawn не звался', async () => {
      const old = mergeClaudeWtConfig({
        launchSession: { args: ['ssh', '-A', 'popstas@pc-virt.popstas.pro', '-t', REMOTE] },
        projects: [{ name: 'ExpertizeMe', cwd: '/vault', profiles: { wt: 'Expertize' } }],
        childCwdRoot: '/home/popstas/projects',
      });
      const { res, spawned } = await run(CHILD, { cfg: old, liveHeadIds: () => new Set([HEAD_ID]) });
      expect(res).toMatchObject({ ok: false, status: 500 });
      expect(res.reason).toContain('{childCwdRoot}');
      expect(spawned).toEqual([]);
    });

    it('старый шаблон не мешает каталогу из списка', async () => {
      const old = mergeClaudeWtConfig({
        launchSession: { args: ['ssh', '-A', 'popstas@pc-virt.popstas.pro', '-t', REMOTE] },
        projects: [{ name: 'ExpertizeMe', cwd: '/vault', profiles: { wt: 'Expertize' } }],
        childCwdRoot: '/home/popstas/projects',
      });
      const { res } = await run({ ...BODY, headId: HEAD_ID }, { cfg: old });
      expect(res.ok).toBe(true);
    });

    it('head без окна — 403 и spawn не звался', async () => {
      const { res, spawned } = await run(CHILD, { cfg: RCFG, liveHeadIds: () => new Set() });
      expect(res).toMatchObject({ ok: false, status: 403 });
      expect(spawned).toEqual([]);
    });

    it('liveHeadIds не зовётся для каталога из списка, корень обёртке не идёт', async () => {
      const liveHeadIds = vi.fn(() => new Set());
      const { res, spawned } = await run({ ...BODY, headId: HEAD_ID }, { cfg: RCFG, liveHeadIds });
      expect(res.ok).toBe(true);
      expect(liveHeadIds).not.toHaveBeenCalled();
      expect(spawned[0].args.at(-1)).toContain("CCFZF_CHILD_CWD_ROOT=''");
    });
  });
});
