import os from 'node:os';
import { spawn } from 'node:child_process';
import { getWindows } from '../windows.js';
import { placeWindowByConfig } from '../placement.js';
import { getWindowsMonitors } from '../monitors.js';
import { clampBoundsToMonitors } from '../geometry.js';
import { readState } from './state.js';
import { loadSessionIndex } from './sessions.js';
import { resolveSession } from './tracker-helpers.js';
import { stripTitleDecoration } from './title-helpers.js';
import { getClaudeWtConfig, isTerminalWindow } from './index.js';
import { bootTimeSec, detectCrash, planRestore, partitionPlan } from './restore-helpers.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function terminalWindows() {
  return getWindows().filter(isTerminalWindow);
}

/**
 * Sessions visible on screen right now, resolved the same way the tracker
 * resolves them: dump first, then our own title history. Used to tell "every
 * terminal is gone, they all went down with the machine" from "they are right
 * there, this restore would duplicate them".
 */
function openSessionIds(cfg, state) {
  const sessionIndex = loadSessionIndex(cfg.sessionsFile);
  const ids = new Set();
  for (const w of terminalWindows()) {
    const resolved = resolveSession(stripTitleDecoration(w.getTitle()), sessionIndex, state.slots);
    if (resolved && !resolved.ambiguous) ids.add(resolved.id);
  }
  return ids;
}

/** The window we just launched is the one whose id was not there before. */
async function waitForNewWindow(knownIds, timeoutMs, pollMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const found = terminalWindows().find(w => !knownIds.has(w.id));
    if (found) return found;
  }
  return null;
}

/**
 * Bring the last layout back, one window at a time. Sequential on purpose: two
 * windows popping up at once cannot be told apart, and identifying them by
 * title is not an option either — the title has not settled yet at that point.
 */
async function restoreClaudeSessions({ force = false } = {}) {
  const cfg = getClaudeWtConfig();
  const state = readState(cfg.statePath);
  const fullPlan = planRestore({ state, launch: cfg.launch });
  const restored = [];
  const skipped = [];
  if (!fullPlan.length) {
    console.log('[claude-wt] nothing to restore');
    return { restored, skipped };
  }
  if (!cfg.launch.command) {
    console.error('[claude-wt] claudeWt.launch.command is not set in config, nothing to run');
    return { restored, skipped: fullPlan.map(item => item.sessionId) };
  }
  const { alreadyOpen, missing } = partitionPlan(fullPlan, openSessionIds(cfg, state));
  if (alreadyOpen.length && !force) {
    // Восстановление имеет смысл, только когда сессии действительно пропали.
    console.error(`[claude-wt] ${alreadyOpen.length} of ${fullPlan.length} session(s) are still open: ${alreadyOpen.map(i => i.title).join(', ')}`);
    console.error('[claude-wt] refusing to restore — close them first, or pass --force to bring back only the missing ones');
    return { restored, skipped: fullPlan.map(item => item.sessionId) };
  }
  const plan = force ? missing : fullPlan;
  if (!plan.length) {
    console.log('[claude-wt] every remembered session is already open, nothing to restore');
    return { restored, skipped };
  }
  console.log(`[claude-wt] restoring ${plan.length} session(s)`);
  const monitors = getWindowsMonitors();
  let first = true;
  for (const item of plan) {
    // Пауза между запусками. Windows Terminal открывает окно асинхронно, и
    // окна, запрошенные подряд, всплывают пачкой: «новое окно» перестаёт
    // однозначно означать «окно этой сессии», позиции разъезжаются по чужим
    // сессиям, а часть окон остаётся пустой.
    if (!first) await sleep(cfg.restore.launchDelayMs);
    first = false;
    const knownIds = new Set(terminalWindows().map(w => w.id));
    console.log(`[claude-wt] restoring ${item.title} (${item.sessionId})`);
    try {
      spawn(item.command, item.args, { detached: true, stdio: 'ignore' }).unref();
    } catch (e) {
      console.error(`[claude-wt] failed to launch ${item.sessionId}: ${e.message}`);
      skipped.push(item.sessionId);
      continue;
    }
    const win = await waitForNewWindow(knownIds, cfg.restore.windowTimeoutMs);
    if (!win) {
      console.error(`[claude-wt] window for ${item.sessionId} did not appear, skipping`);
      skipped.push(item.sessionId);
      continue;
    }
    // Окно уже есть, но Windows Terminal ещё доводит его до нужного размера;
    // позиция, выставленная в этот момент, тут же затирается.
    await sleep(cfg.restore.settleMs);
    const bounds = clampBoundsToMonitors(item.bounds, monitors);
    const rule = { window: win.id, ...bounds };
    if (cfg.desktop && item.desktop) rule.desktop = item.desktop;
    try {
      await placeWindowByConfig(rule);
      restored.push(item.sessionId);
    } catch (e) {
      console.error(`[claude-wt] failed to place ${item.sessionId}: ${e.message}`);
      skipped.push(item.sessionId);
    }
  }
  console.log(`[claude-wt] restored ${restored.length}, skipped ${skipped.length}`);
  return { restored, skipped };
}

/** Called on daemon start: report a crash, act on it only when configured to. */
async function maybeRestoreOnStart() {
  const cfg = getClaudeWtConfig();
  const state = readState(cfg.statePath);
  const windowCount = terminalWindows().length;
  const crashed = detectCrash({
    state,
    bootTimeSec: bootTimeSec(os.uptime(), Date.now()),
    windowCount,
  });
  if (!crashed) return false;
  console.log(`[claude-wt] ${state.lastLayout.length} session(s) were open before the reboot`);
  if (!cfg.restore.auto) {
    console.log('[claude-wt] run "node src claude-wt restore" to bring them back (restore.auto is off)');
    return false;
  }
  await restoreClaudeSessions();
  return true;
}

export { waitForNewWindow, openSessionIds, restoreClaudeSessions, maybeRestoreOnStart };
