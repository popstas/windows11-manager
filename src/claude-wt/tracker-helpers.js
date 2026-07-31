/** Pure helper functions for the claude-wt tracker. No external I/O. */
import { upsertSlot } from './state-helpers.js';

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

const DEFAULTS = { stableTicks: 2, moveTimeoutMs: 5000, minimizedX: -10000 };

function boundsEqual(a, b) {
  if (!a || !b) return false;
  return ['x', 'y', 'width', 'height'].every(k => a[k] === b[k]);
}

/**
 * One tick of the tracker: pure, so the whole behaviour table is testable
 * without Windows. Returns the next state plus what the daemon must do:
 * `actions` are windows to move, `bindings` are windows whose virtual desktop
 * number should be read once (that call spawns VirtualDesktop11.exe, so it
 * must never happen on every tick).
 */
function step({ prevWindows = [], windows = [], sessionIndex = {}, state, now, options = {} }) {
  const { stableTicks, moveTimeoutMs, minimizedX } = { ...DEFAULTS, ...options };
  // `now` stays in ms because pendingMove.since/moveTimeoutMs need that resolution;
  // everything persisted to state (lastSeen, updated) is stamped in epoch seconds.
  const nowSec = Math.floor(now / 1000);
  const prev = new Map(prevWindows.map(w => [w.id, w]));
  const duplicates = duplicateTitles(windows);
  const slots = { ...state.slots };
  const nextWindows = [];
  const actions = [];
  const bindings = [];
  const lastLayout = [];

  for (const win of windows) {
    const before = prev.get(win.id);
    const tracked = trackTitle(before, win, stableTicks);
    const minimized = win.bounds.x < minimizedX;
    const titleChanged = tracked.stableTitle !== (before?.stableTitle ?? null);

    if (titleChanged) {
      const resolved = duplicates.has(tracked.stableTitle)
        ? null
        : resolveSession(tracked.stableTitle, sessionIndex, slots);
      tracked.sessionId = resolved && !resolved.ambiguous ? resolved.id : null;
      if (tracked.sessionId) {
        const known = slots[tracked.sessionId];
        const common = { title: tracked.stableTitle, cwd: resolved.cwd, now: nowSec };
        if (known?.bounds) {
          slots[tracked.sessionId] = upsertSlot(known, common);
          actions.push({ windowId: win.id, bounds: known.bounds, desktop: known.desktop });
          tracked.pendingMove = { bounds: known.bounds, since: now };
        } else if (!minimized) {
          // Слот заводится только вместе с позицией: слот без bounds бесполезен
          // и был бы всё равно выброшен normalizeState при следующем чтении.
          slots[tracked.sessionId] = upsertSlot(known, { ...common, bounds: win.bounds });
          bindings.push({ windowId: win.id, sessionId: tracked.sessionId });
        }
      }
    } else if (tracked.sessionId) {
      const settled = !tracked.pendingMove
        || boundsEqual(win.bounds, tracked.pendingMove.bounds)
        || now - tracked.pendingMove.since > moveTimeoutMs;
      if (settled) {
        tracked.pendingMove = null;
        if (!minimized) {
          // A session first seen while minimized reaches here with no slot yet
          // (the titleChanged branch above deliberately skipped creating one).
          // Carry the title along so the slot isn't created identity-less, and
          // bind exactly once — the same moment the titleChanged branch would
          // have bound it, had the window not been minimized at the time.
          const known = slots[tracked.sessionId];
          slots[tracked.sessionId] = upsertSlot(known, { title: tracked.stableTitle, bounds: win.bounds, now: nowSec });
          if (!known) bindings.push({ windowId: win.id, sessionId: tracked.sessionId });
        }
      }
    }

    if (tracked.sessionId) lastLayout.push(tracked.sessionId);
    nextWindows.push(tracked);
  }

  return {
    nextWindows,
    actions,
    bindings,
    nextState: { ...state, slots, lastLayout, updated: nowSec },
  };
}

export { trackTitle, duplicateTitles, resolveSession, step, boundsEqual };
