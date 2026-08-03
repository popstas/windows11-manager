import fs from 'node:fs';
import { indexSessions, indexBackgroundAgents, isStaleRead } from './sessions-helpers.js';
import { progressStamp, activityAt } from './progress.js';

let cache = { path: '', mtimeMs: 0, stamp: 0, readAt: 0, index: {}, agents: {} };
let lastWarnedAt = 0;
const WARN_INTERVAL_MS = 5 * 60 * 1000;

// Тот же срок годности и по той же причине, что у записей в progress.js: оба
// ключа кэша — mtime файлов на сетевом диске, а долгоживущий процесс минутами
// получает от statSync() прежние отметки, пока свежий видит новые.
//
// Замерено 2026-08-02: сессии `home` и `obsidian-agent-workspace` перезапустились
// под новыми id, свежий процесс разбирал дамп правильно, а демон 15 минут
// продолжал отдавать индекс со старыми — окна привязывались к id, которых в
// дампе давно нет, и в списке эти сессии просто исчезли.
//
// Срок здесь длиннее, чем у состояний (3 с): там файлы по три сотни байт, а
// дамп — под двести килобайт, и перечитывать его каждые три секунды из тика
// демона значит держать на сетевом диске постоянный поток ради файла, который
// меняется несколько раз в день. Пятнадцать секунд задержки не видно: сам дамп
// узнаёт о перезапущенной сессии не быстрее, а заголовок окна ещё должен
// устояться два тика.
const MAX_AGE_MS = 15000;

/**
 * Прочитать дамп, не поверив кэшу SMB на слово.
 *
 * Когда содержимое отстаёт от mtime (см. `isStaleRead`), файл открывается с
 * правом записи и сразу закрывается. Ничего не пишется: смысл в самом открытии
 * — запрос на запись ломает read lease, редиректор выбрасывает свой кэш, и
 * второе чтение приходит уже с сервера. Проверено на живом дампе: до открытия
 * читалось поколение пятиминутной давности, после — текущее.
 *
 * Не получилось открыть (шара только на чтение, файл переписывают прямо
 * сейчас) — отдаём то, что прочиталось: устаревший индекс лучше пустого.
 */
function readDump(filePath, mtimeMs) {
  const parse = () => JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const dump = parse();
  if (!isStaleRead(mtimeMs, dump?.generated)) return dump;
  try {
    fs.closeSync(fs.openSync(filePath, 'r+'));
  } catch (e) {
    warnThrottled(`session dump read cache stuck (${filePath}): ${e.message}`);
    return dump;
  }
  return parse();
}

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
 * times a day.
 *
 * Failure handling differs by kind, on purpose:
 * - the path cannot be stat'ed (V: unmounted) — keep serving the last index
 *   read from that same path, and only fall back to `{}` when we have nothing
 *   cached for it. Losing every session because a network drive blinked would
 *   be worse than a slightly stale index.
 * - the file is there but unreadable (truncated or half-written JSON) — cache
 *   an empty index for that mtime, so we neither re-parse it every tick nor
 *   keep serving data the file no longer contains.
 * Either way the tracker degrades to its own title history rather than throwing.
 */
function loadDump(filePath, progressDir = '', nowMs = Date.now()) {
  if (!filePath) return { index: {}, agents: {} };
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    warnThrottled(`session dump unreachable (${filePath}): ${e.message}`);
    return cache.path === filePath ? cache : { index: {}, agents: {} };
  }
  // Индекс зависит не только от дампа: у спорных заголовков победителя выбирают
  // отметки хуков, а они меняются независимо. Каталог состояний меняет mtime
  // на каждую запись хука (временный файл + переименование), так что его
  // отметка — достаточный признак «пора пересобрать».
  const stamp = progressStamp(progressDir);
  if (cache.path === filePath && cache.mtimeMs === stat.mtimeMs && cache.stamp === stamp
      && nowMs - cache.readAt < MAX_AGE_MS) {
    return cache;
  }
  try {
    const dump = readDump(filePath, stat.mtimeMs);
    const index = indexSessions(
      dump,
      progressDir ? id => activityAt(progressDir, id) : undefined,
    );
    cache = {
      path: filePath, mtimeMs: stat.mtimeMs, stamp, readAt: nowMs,
      index, agents: indexBackgroundAgents(dump),
    };
  } catch (e) {
    warnThrottled(`session dump unreadable (${filePath}): ${e.message}`);
    cache = {
      path: filePath, mtimeMs: stat.mtimeMs, stamp, readAt: nowMs, index: {}, agents: {},
    };
  }
  return cache;
}

/** Title -> session, for binding a window to the session running in it. */
function loadSessionIndex(filePath, progressDir = '', nowMs = Date.now()) {
  return loadDump(filePath, progressDir, nowMs).index;
}

/**
 * Родитель -> его фоновые агенты. Из того же дампа и того же кэша: тик демона
 * этого не спрашивает, а view-слой всё равно читает индекс рядом.
 */
function loadBackgroundAgents(filePath, progressDir = '', nowMs = Date.now()) {
  return loadDump(filePath, progressDir, nowMs).agents;
}

/** Drop the cached dump so the next loadSessionIndex re-reads from disk. */
function invalidateSessionIndex() {
  cache = { path: '', mtimeMs: 0, stamp: 0, readAt: 0, index: {}, agents: {} };
}

export { indexSessions, indexBackgroundAgents, compareSessions, isStaleRead } from './sessions-helpers.js';
export { loadSessionIndex, loadBackgroundAgents, invalidateSessionIndex };
