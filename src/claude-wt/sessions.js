import fs from 'node:fs';
import { indexSessions } from './sessions-helpers.js';

let cache = { path: '', mtimeMs: 0, index: {} };
let lastWarnedAt = 0;
const WARN_INTERVAL_MS = 5 * 60 * 1000;

/** The daemon ticks once a second; an unthrottled warning would be its own problem. */
function warnThrottled(message) {
  const now = Date.now();
  if (now - lastWarnedAt < WARN_INTERVAL_MS) return;
  lastWarnedAt = now;
  console.error(`[claude-wt] ${message}`);
}

/**
 * Read the ccfzf dump and index it. The file is re-read only when its mtime
 * changes: the daemon asks for the index once a second, the dump changes a few
 * times a day. Any failure (V: not mounted, truncated write) yields an empty
 * index — the tracker falls back to its own title history.
 */
function loadSessionIndex(filePath) {
  if (!filePath) return {};
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    warnThrottled(`session dump unreachable (${filePath}): ${e.message}`);
    return cache.path === filePath ? cache.index : {};
  }
  if (cache.path === filePath && cache.mtimeMs === stat.mtimeMs) return cache.index;
  try {
    const index = indexSessions(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    cache = { path: filePath, mtimeMs: stat.mtimeMs, index };
  } catch (e) {
    warnThrottled(`session dump unreadable (${filePath}): ${e.message}`);
    cache = { path: filePath, mtimeMs: stat.mtimeMs, index: {} };
  }
  return cache.index;
}

export { indexSessions, compareSessions } from './sessions-helpers.js';
export { loadSessionIndex };
