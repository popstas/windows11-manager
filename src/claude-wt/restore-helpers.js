/** Pure helper functions for claude-wt crash restore. No external I/O. */

function bootTimeSec(uptimeSec, nowMs) {
  return Math.floor(nowMs / 1000) - Math.floor(uptimeSec);
}

/**
 * A crash is a state file last written before the current boot while sessions
 * were still on screen. Closing the terminals by hand empties lastLayout on the
 * very next tick, so a surviving non-empty layout means the machine went down
 * without asking.
 */
function detectCrash({ state, bootTimeSec: boot, windowCount }) {
  if (!state?.updated) return false;
  if (!state.lastLayout?.length) return false;
  if (windowCount > 0) return false;
  return state.updated < boot;
}

/**
 * Which sessions a restore should cover.
 *
 * `lastLayout` is the right default — it is the set that was on screen when
 * the machine went down. It is not always usable, though: a daemon that is
 * still alive rewrites it on every tick, so sessions that died one at a time
 * drop out of it while their slots remain. Explicit ids are the way back to
 * those, and unknown ids are reported rather than silently dropped.
 */
function resolveRestoreIds({ state, sessionIds }) {
  if (!sessionIds?.length) return { ids: state.lastLayout ?? [], unknown: [] };
  const known = state.slots ?? {};
  return {
    ids: sessionIds.filter(id => known[id]),
    unknown: sessionIds.filter(id => !known[id]),
  };
}

function planRestore({ state, launch, sessionIds }) {
  return (resolveRestoreIds({ state, sessionIds }).ids)
    .map(sessionId => ({ sessionId, slot: state.slots?.[sessionId] }))
    .filter(({ slot }) => Boolean(slot))
    .map(({ sessionId, slot }) => ({
      sessionId,
      title: slot.titles[0],
      command: launch.command,
      args: launch.args.map(arg => arg.replaceAll('{id}', sessionId)),
      bounds: slot.bounds,
      desktop: slot.desktop,
    }));
}

/**
 * Split a restore plan by what is already on screen.
 *
 * Restoring is only meaningful when the sessions really are gone: relaunching
 * a session that is sitting right there would give the user a second window
 * onto the same transcript.
 */
function partitionPlan(plan, openSessionIds) {
  const open = openSessionIds ?? new Set();
  return {
    alreadyOpen: plan.filter(item => open.has(item.sessionId)),
    missing: plan.filter(item => !open.has(item.sessionId)),
  };
}

export { bootTimeSec, detectCrash, planRestore, partitionPlan, resolveRestoreIds };
