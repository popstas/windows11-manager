import { describe, it, expect, vi } from 'vitest';

// project.js тянет за собой нативный модуль окон — здесь он не нужен.
vi.mock('./project.js', () => ({ focusSpawnedWindow: vi.fn() }));
vi.mock('./index.js', () => ({ getClaudeWtConfig: vi.fn() }));

const { openInboxSession } = await import('./inbox.js');
const { mergeClaudeWtConfig } = await import('./daemon-helpers.js');

// Шаблон из config.example.yaml: тот же приём, что у launchNew, — cd внутри
// интерактивного шелла, всё остальное позиционными аргументами.
const REMOTE = `exec $SHELL -ic 'cd -- "$1" && exec "$2" "$3" "$4"' claude-wt '{cwd}' '{script}' '{file}' '{name}'`;

const cfg = mergeClaudeWtConfig({
  launchInbox: { args: ['ssh', '-A', 'popstas@pc-virt.popstas.pro', '-t', REMOTE] },
  projects: [{ name: 'ExpertizeMe', cwd: '/vault', profiles: { wt: 'Expertize' } }],
});

const REQ = {
  file: 'files/incoming-telegram/2026-11-05-msg.md',
  name: 'tg-2026-11-05-msg',
  cwd: '/vault',
  script: '.scripts/telegram-incoming',
};

function run(req = REQ, over = {}) {
  const spawned = [];
  const spawnProcess = vi.fn((command, args) => {
    spawned.push({ command, args });
    return { unref() {} };
  });
  const focusByTitle = vi.fn().mockResolvedValue(true);
  return openInboxSession(req, { cfg, spawnProcess, focusByTitle, mark: () => {}, ...over })
    .then(res => ({ res, spawned, focusByTitle }));
}

describe('openInboxSession', () => {
  it('builds wt -> ssh argv with the project profile and positional args', async () => {
    const { res, spawned, focusByTitle } = await run();
    expect(res).toEqual({ ok: true, action: 'spawn', sessionName: 'tg-2026-11-05-msg', focused: true });
    expect(spawned).toEqual([{
      command: 'wt.exe',
      args: [
        '-w', '-1', '-p', 'Expertize',
        'ssh', '-A', 'popstas@pc-virt.popstas.pro', '-t',
        `exec $SHELL -ic 'cd -- "$1" && exec "$2" "$3" "$4"' claude-wt '/vault' '.scripts/telegram-incoming' 'files/incoming-telegram/2026-11-05-msg.md' 'tg-2026-11-05-msg'`,
      ],
    }]);
    expect(focusByTitle).toHaveBeenCalledWith('tg-2026-11-05-msg', expect.any(Object));
  });

  it('keeps every value inside its own single-quoted word', async () => {
    const { spawned } = await run({ ...REQ, file: "files/x/it's.md", name: "tg-it's" });
    const remote = spawned[0].args.at(-1);
    expect(remote).toContain(`'files/x/it'\\''s.md' 'tg-it'\\''s'`);
  });

  it('refuses an empty launchInbox instead of spawning a bare terminal', async () => {
    const { res, spawned } = await run(REQ, { cfg: mergeClaudeWtConfig({}) });
    expect(res).toEqual({ ok: false, reason: 'claudeWt.launchInbox.args is empty' });
    expect(spawned).toEqual([]);
  });

  it('requires all four values', async () => {
    const { res, spawned } = await run({ ...REQ, script: '' });
    expect(res.ok).toBe(false);
    expect(spawned).toEqual([]);
  });

  it('background: true — окно без фокуса', async () => {
    const { focusByTitle } = await run({ ...REQ, background: true });
    expect(focusByTitle).toHaveBeenCalledWith('tg-2026-11-05-msg', expect.objectContaining({ raise: false }));
  });

  it('без background — фокус как раньше', async () => {
    const { focusByTitle } = await run();
    expect(focusByTitle).toHaveBeenCalledWith('tg-2026-11-05-msg', expect.objectContaining({ raise: true }));
  });

  it('a window that never showed up is ok but not focused', async () => {
    const { res } = await run(REQ, { focusByTitle: vi.fn().mockResolvedValue(false) });
    expect(res).toMatchObject({ ok: true, focused: false });
  });
});
