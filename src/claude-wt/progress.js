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

/**
 * Отметка каталога состояний — по ней решают, не пора ли пересобрать индекс
 * сессий.
 *
 * Хук пишет через временный файл и переименование, а это меняет mtime самого
 * каталога. Один stat в тик — столько же, сколько уже стоит проверка дампа.
 */
function progressStamp(dir) {
  if (!dir) return 0;
  try {
    return fs.statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Когда сессия последний раз подавала признаки жизни по данным хука, в
 * epoch-секундах. Ноль — про эту сессию хук ничего не писал.
 *
 * Берётся mtime файла, а не поле внутри: содержимое читать незачем, а stat на
 * сетевом диске в разы дешевле. Вызывается только для сессий, чей заголовок
 * делят несколько кандидатов, — то есть обычно ни разу за тик.
 */
function activityAt(dir, id) {
  if (!dir || !id) return 0;
  try {
    return Math.floor(fs.statSync(path.join(dir, `${id}.state.json`)).mtimeMs / 1000);
  } catch {
    return 0;
  }
}

export * from './progress-helpers.js';
export { loadProgress, progressStamp, activityAt };
