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

function planRestore({ state, launch }) {
  return (state.lastLayout ?? [])
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

export { bootTimeSec, detectCrash, planRestore };
