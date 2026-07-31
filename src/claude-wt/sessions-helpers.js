/** Pure helper functions for the ccfzf session dump. No external I/O. */

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
 */
function indexSessions(dump) {
  const sessions = Array.isArray(dump?.sessions) ? dump.sessions : [];
  const byTitle = new Map();
  for (const s of sessions) {
    if (!s?.id || !s?.title) continue;
    if (!byTitle.has(s.title)) byTitle.set(s.title, []);
    byTitle.get(s.title).push(s);
  }
  const index = {};
  for (const [title, list] of byTitle) {
    const sorted = [...list].sort(compareSessions);
    const [best, second] = sorted;
    index[title] = {
      id: best.id,
      cwd: best.cwd ?? '',
      title,
      ambiguous: Boolean(second) && compareSessions(best, second) === 0,
    };
  }
  return index;
}

export { compareSessions, indexSessions };
