/** Pure helper functions for the claude-wt daemon. No external I/O. */

const CLAUDE_WT_DEFAULTS = {
  enabled: true,
  interval: 1000,
  stableTicks: 2,
  sessionsFile: '',
  statePath: '',
  desktop: true,
  debug: false,
  launch: { command: 'wt.exe', args: [] },
  restore: { auto: false, windowTimeoutMs: 30000 },
};

/** Deep-ish merge: launch and restore are merged key by key, everything else replaced. */
function mergeClaudeWtConfig(raw) {
  const cfg = raw ?? {};
  return {
    ...CLAUDE_WT_DEFAULTS,
    ...cfg,
    launch: { ...CLAUDE_WT_DEFAULTS.launch, args: [...CLAUDE_WT_DEFAULTS.launch.args], ...(cfg.launch ?? {}) },
    restore: { ...CLAUDE_WT_DEFAULTS.restore, ...(cfg.restore ?? {}) },
  };
}

function isTerminalPath(path) {
  return /(^|[\\/])WindowsTerminal\.exe$/i.test(path ?? '');
}

/**
 * Virtual desktop moves that step() cannot express.
 *
 * `desktop` rides along on a move action, and step() suppresses the action when
 * the window already sits at its remembered position — so a window that is in
 * the right place but on the wrong desktop would never come back. This fills
 * that hole for windows that were bound to a session on *this* tick and got no
 * action of their own.
 *
 * Windows the tracker had not seen on the previous tick are skipped on purpose:
 * that is the daemon-restart case, where every open window reports its binding
 * at once, and hauling them all across virtual desktops is not what restarting
 * a position tracker should do.
 */
function desktopOnlyActions({ prevWindows = [], nextWindows = [], slots = {}, actions = [] }) {
  const prev = new Map(prevWindows.map(w => [w.id, w]));
  const moving = new Set(actions.map(a => a.windowId));
  const out = [];
  for (const w of nextWindows) {
    if (!w.sessionId || moving.has(w.id)) continue;
    const was = prev.get(w.id);
    if (!was || was.sessionId === w.sessionId) continue;
    const desktop = slots[w.sessionId]?.desktop;
    if (desktop == null) continue;
    out.push({ windowId: w.id, desktop });
  }
  return out;
}

/**
 * What the state file is actually for, minus the clock. `updated` ticks every
 * second, so comparing whole states would defeat the write deduplication it was
 * written for and put a file write on every tick.
 */
function layoutFingerprint(state) {
  return JSON.stringify({ slots: state?.slots ?? {}, lastLayout: state?.lastLayout ?? [] });
}

/** Settled titles of terminal windows that could not be attributed to a session. */
function unresolvedTitles(nextWindows) {
  return [...new Set(nextWindows.filter(w => w.stableTitle && !w.sessionId).map(w => w.stableTitle))];
}

export {
  CLAUDE_WT_DEFAULTS,
  mergeClaudeWtConfig,
  isTerminalPath,
  desktopOnlyActions,
  layoutFingerprint,
  unresolvedTitles,
};
