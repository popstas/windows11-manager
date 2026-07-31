/** Pure helper functions for the claude-wt tracker. No external I/O. */

/**
 * Follow one window's title across ticks. A title becomes "stable" only after
 * it has held for stableTicks: entering a session flips the title two or three
 * times in a row (shell -> claude -> session name), and reacting to the
 * intermediate values would bind the window to the wrong thing.
 */
function trackTitle(before, win, stableTicks) {
  const sameTitle = before?.title === win.title;
  const titleTicks = sameTitle ? before.titleTicks + 1 : 1;
  const settled = titleTicks >= stableTicks;
  return {
    id: win.id,
    title: win.title,
    titleTicks,
    stableTitle: settled ? win.title : (before?.stableTitle ?? null),
    sessionId: before?.sessionId ?? null,
    bounds: win.bounds,
    pendingMove: before?.pendingMove ?? null,
  };
}

/** Titles shown by more than one window right now — those windows stay put. */
function duplicateTitles(windows) {
  const seen = new Map();
  for (const w of windows) {
    if (!w.title) continue;
    seen.set(w.title, (seen.get(w.title) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([title]) => title));
}

/**
 * Title -> session, first from the ccfzf dump, then from our own title history.
 * The fallback keeps the module working while V: is unmounted or the dump is
 * stale, at the cost of only knowing sessions we have already seen.
 */
function resolveSession(title, sessionIndex, slots) {
  if (!title) return null;
  const fromDump = sessionIndex?.[title];
  if (fromDump) return { id: fromDump.id, cwd: fromDump.cwd, ambiguous: fromDump.ambiguous };
  const matches = Object.entries(slots ?? {}).filter(([, slot]) => slot.titles?.includes(title));
  if (!matches.length) return null;
  const [id, slot] = matches[0];
  return { id, cwd: slot.cwd ?? '', ambiguous: matches.length > 1 };
}

export { trackTitle, duplicateTitles, resolveSession };
