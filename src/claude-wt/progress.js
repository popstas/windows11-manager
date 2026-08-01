import fs from 'node:fs';
import path from 'node:path';
import { normalizeProgress } from './progress-helpers.js';

// Кэш на файл: { mtimeMs, value }. Пикер опрашивает список раз в секунду, а
// каталог состояний лежит на сетевом диске — перечитывать неизменившийся файл
// на каждый тик значит платить сетевым вводом-выводом за одни и те же байты.
let cache = new Map();
let cachedDir = '';

/**
 * Состояния агента для перечисленных сессий.
 *
 * Читаются только файлы известных сессий, а не весь каталог: файлов там
 * накапливается по одному на каждую сессию за неделю, а интересны всегда те
 * несколько, что есть в слотах. Заодно это отсекает мусор и чужие имена.
 *
 * Вызывать **только** из view-слоя (когда открыт пикер) и никогда из тика
 * демона: тик ходит раз в секунду, каталог лежит на V:, и периодические
 * обращения к сети — ровно тот источник паразитной нагрузки, за который в
 * этом проекте уже заплачено (см. claude-wt polling budget в AGENTS.md).
 */
function loadProgress(dir, sessionIds) {
  if (!dir || !sessionIds?.length) return {};
  // Смена каталога в конфиге обесценивает всё, что накоплено по старому пути.
  if (cachedDir !== dir) {
    cache = new Map();
    cachedDir = dir;
  }
  const out = {};
  const alive = new Set();
  for (const id of sessionIds) {
    const file = path.join(dir, `${id}.state.json`);
    alive.add(id);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      // Файла нет — у сессии просто не установлен хук, это не ошибка.
      cache.delete(id);
      continue;
    }
    const hit = cache.get(id);
    if (hit && hit.mtimeMs === stat.mtimeMs) {
      if (hit.value) out[id] = hit.value;
      continue;
    }
    let value = null;
    try {
      value = normalizeProgress(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      // Хук пишет через временный файл и rename, так что рваного JSON быть не
      // должно; если он всё же случился — запомнить пустоту для этого mtime
      // дешевле, чем разбирать те же байты каждую секунду.
      value = null;
    }
    cache.set(id, { mtimeMs: stat.mtimeMs, value });
    if (value) out[id] = value;
  }
  // Сессии, о которых больше не спрашивают, из кэша уходят: иначе он растёт
  // на каждую когда-либо виденную сессию за всё время работы процесса.
  for (const id of [...cache.keys()]) if (!alive.has(id)) cache.delete(id);
  return out;
}

export * from './progress-helpers.js';
export { loadProgress };
