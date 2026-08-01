import fs from 'node:fs';
import path from 'node:path';
import { emptySnapshots, normalizeSnapshots } from './snapshot-helpers.js';

/**
 * Где живут снимки.
 *
 * Отдельный файл рядом с состоянием, а не поле внутри него: `claude-wt clear`
 * сносит рабочее состояние, и утащить с ним историю было бы обидно — она
 * заводилась ровно на такой случай. Плюс снимки не утяжеляют файл, который
 * демон переписывает на каждое изменение раскладки.
 */
function snapshotsPath(cfg) {
  if (cfg?.snapshots?.path) return cfg.snapshots.path;
  if (!cfg?.statePath) return '';
  const dir = path.dirname(cfg.statePath);
  const base = path.basename(cfg.statePath, path.extname(cfg.statePath));
  return path.join(dir, `${base}-snapshots.json`);
}

/** Битый файл отодвигается в .bak, а не удаляется — как и state.js. */
function readSnapshots(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return emptySnapshots();
  try {
    return normalizeSnapshots(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (e) {
    console.error(`[claude-wt] broken snapshots file, moving to .bak: ${e.message}`);
    try { fs.renameSync(filePath, `${filePath}.bak`); } catch { /* nothing else to do */ }
    return emptySnapshots();
  }
}

/** Атомарно: временный файл, fsync, переименование поверх цели. */
function writeSnapshots(filePath, data) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(data));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

export * from './snapshot-helpers.js';
export { snapshotsPath, readSnapshots, writeSnapshots };
