/** Pure helper functions for the ccfzf session dump. No external I/O. */
import { stripTitleDecoration } from './title-helpers.js';

/**
 * Сравнение с учётом того, что говорят хуки самих агентов.
 *
 * Флаг `live` в дампе ccfzf бывает неверен: замерено 2026-08-01, когда две
 * сессии делили заголовок `shared` — работала та, у которой стояло
 * `live=false`, а `live=true` висело на старой. Хук же срабатывает на каждый
 * вызов инструмента реально работающего агента, поэтому свежая запись от него
 * — довод сильнее любого флага в дампе.
 *
 * Если хук не установлен, обе отметки нулевые и всё сводится к прежнему
 * правилу.
 */
function byActivityThen(activityAt) {
  return (a, b) => {
    const diff = (activityAt(b.id) ?? 0) - (activityAt(a.id) ?? 0);
    return diff !== 0 ? diff : compareSessions(a, b);
  };
}

/** Newest live session wins: live first, then larger mtime. */
function compareSessions(a, b) {
  const aLive = a.live ? 1 : 0;
  const bLive = b.live ? 1 : 0;
  if (aLive !== bLive) return bLive - aLive;
  return (b.mtime ?? 0) - (a.mtime ?? 0);
}

/**
 * Build a title -> session index out of a ccfzf dump.
 * A title shared by two equally good sessions is marked ambiguous:
 * the tracker refuses to move a window it cannot attribute.
 *
 * Keyed by the decoration-stripped title, because that is the form the window
 * title arrives in: the dump holds "Check branch commit count" while the window
 * shows "✳ Check branch commit count". Both sides are stripped by the same
 * function, so the two always line up. `title` keeps the dump's own spelling.
 */
function indexSessions(dump, activityAt) {
  const sessions = Array.isArray(dump?.sessions) ? dump.sessions : [];
  const byTitle = new Map();
  for (const s of sessions) {
    if (!s?.id || !s?.title) continue;
    const key = stripTitleDecoration(s.title);
    if (!key) continue;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(s);
  }
  const index = {};
  for (const [key, list] of byTitle) {
    // Спрашивать про активность есть смысл только когда кандидатов больше
    // одного: у единственного всё равно нет соперника, а каждый вопрос — это
    // stat по сетевому диску.
    const compare = list.length > 1 && activityAt
      ? byActivityThen(activityAt)
      : compareSessions;
    const sorted = [...list].sort(compare);
    const [best, second] = sorted;
    index[key] = {
      id: best.id,
      cwd: best.cwd ?? '',
      title: best.title,
      ambiguous: Boolean(second) && compare(best, second) === 0,
    };
  }
  return index;
}

export { compareSessions, byActivityThen, indexSessions };
