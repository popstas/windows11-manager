/** Pure helper functions for the claude-wt daemon. No external I/O. */

const CLAUDE_WT_DEFAULTS = {
  enabled: true,
  interval: 1000,
  stableTicks: 2,
  sessionsFile: '',
  statePath: '',
  // Каталог, куда хук wt-progress.sh на стороне агента пишет <id>.state.json.
  // Пусто — состояний нет и кружок в пикере остаётся двухцветным.
  progressDir: '',
  desktop: true,
  debug: false,
  launch: { command: 'wt.exe', args: [] },
  restore: { auto: false, windowTimeoutMs: 30000, launchDelayMs: 2000, settleMs: 500 },
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
 * A binding only counts as entering a session when the window had a settled
 * title before it. On a daemon restart every open window goes from "no settled
 * title yet" straight to its session on the second tick, and hauling them all
 * across virtual desktops is not what restarting a position tracker should do —
 * checking merely that the window existed last tick is not enough, because on
 * a restart it did.
 */
function desktopOnlyActions({ prevWindows = [], nextWindows = [], slots = {}, actions = [] }) {
  const prev = new Map(prevWindows.map(w => [w.id, w]));
  const moving = new Set(actions.map(a => a.windowId));
  const out = [];
  for (const w of nextWindows) {
    if (!w.sessionId || moving.has(w.id)) continue;
    const was = prev.get(w.id);
    if (!was || !was.stableTitle || was.sessionId === w.sessionId) continue;
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

/**
 * Сессия, чьё окно только что вышло на передний план.
 *
 * Считается только переход. Пока окно остаётся впереди, отметка не обновляется:
 * иначе состояние переписывалось бы на диск каждую секунду всё время, что окно
 * висит активным — а `layoutFingerprint()` включает слоты целиком, так что
 * каждая такая отметка означала бы запись файла.
 *
 * Фокус читается в демоне, а не в менеджере сессий, потому что переключиться на
 * окно можно и руками — Alt+Tab, клик по таскбару, — и такой просмотр ничем не
 * отличается от перехода через пикер.
 */
function focusedSessionId({ activeWindowId, prevActiveWindowId, windows = [] }) {
  if (!activeWindowId || activeWindowId === prevActiveWindowId) return null;
  return windows.find(w => w.id === activeWindowId)?.sessionId ?? null;
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
  focusedSessionId,
  unresolvedTitles,
};
