import os from 'node:os';
import { spawn } from 'node:child_process';
import { getWindows } from '../windows.js';
import { placeWindowByConfig } from '../placement.js';
import { getWindowsMonitors } from '../monitors.js';
import { clampBoundsToMonitors } from '../geometry.js';
import { readState } from './state.js';
import { getClaudeWtConfig, isTerminalWindow } from './index.js';
import { bootTimeSec, detectCrash, planRestore } from './restore-helpers.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function terminalWindows() {
  return getWindows().filter(isTerminalWindow);
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
async function restoreClaudeSessions() {
  const cfg = getClaudeWtConfig();
  const state = readState(cfg.statePath);
  const plan = planRestore({ state, launch: cfg.launch });
  const restored = [];
  const skipped = [];
  if (!plan.length) {
    console.log('[claude-wt] nothing to restore');
    return { restored, skipped };
  }
  if (!cfg.launch.command) {
    console.error('[claude-wt] claudeWt.launch.command is not set in config, nothing to run');
    return { restored, skipped: plan.map(item => item.sessionId) };
  }
  const monitors = getWindowsMonitors();
  for (const item of plan) {
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

export { waitForNewWindow, restoreClaudeSessions, maybeRestoreOnStart };
