import { claudeWtStatus } from './index.js';
import { focusTerminalWindow, findOpenTerminalByTitle } from './project.js';
import { planFocus } from './focus-helpers.js';

/**
 * Bring the terminal window of a tracked session to the foreground.
 *
 * Serves POST /claude-wt/focus, which ccfzf-picker calls instead of opening a
 * second `claude --resume` on a transcript that already has a window.
 *
 * The window is found by title, not by handle: slots remember titles, never
 * hwnds. `findOpenTerminalByTitle` strips the decoration the same way the
 * tracker does when it binds a slot, so the two agree on what "same window"
 * means.
 *
 * **Windows only hands the foreground to the process that already owns it.**
 * `bringToTop()` from this daemon does nothing on its own — it flashes the
 * taskbar button instead of switching. The caller is expected to have called
 * AllowSetForegroundWindow(pid of this process) first; the pid it needs is in
 * the /claude-wt/status answer. Without that grant this function still reports
 * `ok`, because from here the switch did happen — the refusal is invisible on
 * this side.
 */
async function focusSession(id) {
  const plan = planFocus(claudeWtStatus().slots, id);
  if (!plan.ok) return plan;

  const window = findOpenTerminalByTitle(plan.title);
  if (!window) return { ok: false, reason: `no open terminal titled ${plan.title}` };
  if (!(await focusTerminalWindow(window.id))) {
    return { ok: false, reason: 'window is not on screen' };
  }
  return { ok: true, windowId: window.id };
}

export { focusSession };
