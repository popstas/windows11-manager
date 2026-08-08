import fs from 'node:fs';
import path from 'node:path';
import { normalizeMeta } from './meta-helpers.js';

// Тот же бюджет и та же причина, что у progress.js: каталог на сетевом диске,
// пикер опрашивает раз в секунду, одного mtime мало (SMB отдаёт закэшированные
// атрибуты). Вызывать только из view-слоя, никогда из тика демона.
let cache = new Map();
let cachedDir = '';
const MAX_AGE_MS = 3000;

/**
 * Метаданные SessionStart для перечисленных сессий.
 *
 * Читаются только файлы известных id — как у progress. Нужен `started` для
 * сортировки oldest/newest в пикере.
 */
function loadMeta(dir, sessionIds, nowMs = Date.now()) {
  if (!dir || !sessionIds?.length) return {};
  if (cachedDir !== dir) {
    cache = new Map();
    cachedDir = dir;
  }
  const out = {};
  const alive = new Set();
  for (const id of sessionIds) {
    const file = path.join(dir, `${id}.meta.json`);
    alive.add(id);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      cache.delete(id);
      continue;
    }
    const hit = cache.get(id);
    if (hit && hit.mtimeMs === stat.mtimeMs && nowMs - hit.readAt < MAX_AGE_MS) {
      if (hit.value) out[id] = hit.value;
      continue;
    }
    let value = null;
    try {
      value = normalizeMeta(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      value = null;
    }
    cache.set(id, { mtimeMs: stat.mtimeMs, readAt: nowMs, value });
    if (value) out[id] = value;
  }
  for (const id of [...cache.keys()]) if (!alive.has(id)) cache.delete(id);
  return out;
}

export * from './meta-helpers.js';
export { loadMeta };
