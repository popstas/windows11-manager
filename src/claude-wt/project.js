import { spawn } from 'node:child_process';
import { focusWindowById, getWindowById, getWindows } from '../windows.js';
import { virtualDesktop } from '../virtual-desktop.js';
import { getClaudeWtConfig, isTerminalWindow } from './index.js';
import { claudeWtSessions } from './view.js';
import { stripTitleDecoration } from './title-helpers.js';
import { basenameOfCwd, pickOpenProjectSession, planLaunchNew, profileForCwd } from './project-helpers.js';

async function focusTerminalWindow(windowId) {
  try {
    const current = await virtualDesktop.GetWindowDesktopNumber(windowId);
    if (current !== undefined && current !== null && current !== '') {
      const target = Number(current);
      if (!Number.isNaN(target)) await virtualDesktop.GoToDesktopNumber(target);
    }
  } catch {
    // Focus still worth trying if the desktop query fails.
  }
  return focusWindowById(windowId);
}

/**
 * Open WT window whose decoration-stripped title equals `title`.
 * Covers the gap before the ccfzf dump catches up and the daemon binds a slot.
 */
function findOpenTerminalByTitle(title) {
  const want = stripTitleDecoration(title);
  if (!want) return null;
  for (const w of getWindows().filter(isTerminalWindow)) {
    if (stripTitleDecoration(w.getTitle()) === want) return w;
  }
  return null;
}

/**
 * Focus the last open Claude session for a project cwd, or spawn a fresh
 * `claude -n <basename(cwd)>` there when none is on screen.
 *
 * @param {{ cwd: string, name: string, profile?: string }} opts
 * @returns {Promise<{ ok: boolean, action?: string, reason?: string, sessionId?: string, sessionName?: string }>}
 */
async function openClaudeProject({ cwd, name, profile } = {}) {
  if (typeof cwd !== 'string' || !cwd || typeof name !== 'string' || !name) {
    return { ok: false, reason: 'cwd and name are required' };
  }
  // Display name matches ccfzf "[+] new session" (`claude -n basename`).
  const sessionName = basenameOfCwd(cwd) || name;

  let res;
  try {
    res = claudeWtSessions();
  } catch (e) {
    return { ok: false, reason: e.message };
  }
  if (!res.ok) return { ok: false, reason: res.reason };

  const session = pickOpenProjectSession(res.sessions, cwd);
  if (session?.windowId && getWindowById(session.windowId)) {
    if (!(await focusTerminalWindow(session.windowId))) {
      return { ok: false, action: 'focus', reason: 'window is not on screen', sessionId: session.id };
    }
    return { ok: true, action: 'focus', sessionId: session.id };
  }

  const byTitle = findOpenTerminalByTitle(sessionName);
  if (byTitle) {
    if (!(await focusTerminalWindow(byTitle.id))) {
      return { ok: false, action: 'focus-title', reason: 'window is not on screen' };
    }
    return { ok: true, action: 'focus-title', sessionName };
  }

  const cfg = getClaudeWtConfig();
  if (!cfg.launchNew?.command) {
    return { ok: false, reason: 'claudeWt.launchNew.command is not set in config' };
  }
  const effectiveProfile = profile ?? profileForCwd(cwd, cfg);
  const { command, args } = planLaunchNew({
    launchNew: cfg.launchNew,
    cwd,
    name: sessionName,
    profile: effectiveProfile,
  });
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    return { ok: false, action: 'spawn', reason: e.message };
  }
  return { ok: true, action: 'spawn', cwd, name: sessionName, sessionName };
}

// focusTerminalWindow / findOpenTerminalByTitle наружу — их же зовёт focus.js,
// обслуживающий POST /claude-wt/focus. Второй экземпляр «переключить стол и
// поднять окно» разошёлся бы с этим на первой же правке.
export { openClaudeProject, focusTerminalWindow, findOpenTerminalByTitle };
