import fs from 'node:fs';
import path from 'node:path';
import { emptyState, normalizeState } from './state-helpers.js';

/**
 * Read the state file. A file broken by a power loss is moved aside as .bak
 * rather than deleted: the daemon must start, but the bytes may still be
 * worth looking at.
 */
function readState(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return emptyState();
  try {
    return normalizeState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (e) {
    console.error(`[claude-wt] broken state file, moving to .bak: ${e.message}`);
    try { fs.renameSync(filePath, `${filePath}.bak`); } catch { /* nothing else to do */ }
    return emptyState();
  }
}

/**
 * Atomic: write a sibling temp file, fsync it, then rename over the target.
 * The fsync is the point of the exercise — the rename is journaled but the
 * data need not be, so without it a power loss can still leave a torn file,
 * and a torn file costs us lastLayout, which is exactly what crash restore
 * needs.
 */
function writeState(filePath, state) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(state));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

export * from './state-helpers.js';
export { readState, writeState };
