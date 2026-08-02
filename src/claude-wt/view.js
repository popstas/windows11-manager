import { getWindows } from '../windows.js';
import { getMons } from '../monitors.js';
import { readState } from './state.js';
import { loadSessionIndex } from './sessions.js';
import { resolveSession } from './tracker-helpers.js';
import { stripTitleDecoration } from './title-helpers.js';
import { getClaudeWtConfig, isTerminalWindow } from './index.js';
import { buildSessionList } from './view-helpers.js';
import { loadProgress } from './progress.js';
import { loadMeta } from './meta.js';
import { listSnapshots } from './snapshotter.js';

/**
 * Session id -> hwnd for every claude terminal on screen right now.
 *
 * openSessionIds() answers the same question but throws the handle away, and
 * the picker cannot focus a window it has no handle for.
 */
function openSessionMap(cfg, state) {
  const sessionIndex = loadSessionIndex(cfg.sessionsFile, cfg.progressDir);
  const map = new Map();
  for (const w of getWindows().filter(isTerminalWindow)) {
    const resolved = resolveSession(stripTitleDecoration(w.getTitle()), sessionIndex, state.slots);
    if (resolved && !resolved.ambiguous) map.set(resolved.id, w.id);
  }
  return map;
}

/**
 * Everything the picker needs about claude sessions, open and closed.
 *
 * State comes from disk rather than the daemon's in-memory copy: the daemon
 * writes on every change of the layout fingerprint, so the file is current, and
 * reading it keeps this usable from a process that is not running the watcher.
 */
function claudeWtSessions() {
  const cfg = getClaudeWtConfig();
  if (!cfg.enabled) return { ok: false, reason: 'claudeWt.enabled is false in config' };
  if (!cfg.statePath) return { ok: false, reason: 'claudeWt.statePath is not set in config' };
  const state = readState(cfg.statePath);
  const openMap = openSessionMap(cfg, state);
  // Прогресс и мета читаются только здесь — то есть пока открыт пикер. Каталог
  // лежит на сетевом диске, и в тике демона им не место.
  const ids = Object.keys(state.slots);
  const progress = loadProgress(cfg.progressDir, ids);
  const meta = loadMeta(cfg.progressDir, ids);
  return {
    ok: true,
    sessions: buildSessionList({ slots: state.slots, openMap, mons: getMons(), progress, meta }),
  };
}

/**
 * Remembered layouts for the picker / MQTT menu.
 *
 * Reads the snapshots file directly so this works even when the daemon is not
 * the process answering the call (windows-mqtt loads the library separately).
 */
function claudeWtSnapshots() {
  const cfg = getClaudeWtConfig();
  if (!cfg.enabled) return { ok: false, reason: 'claudeWt.enabled is false in config' };
  try {
    return { ok: true, snapshots: listSnapshots(cfg) };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export { openSessionMap, claudeWtSessions, claudeWtSnapshots };
