/** Pure helper functions for claude-wt crash restore. No external I/O. */

import { planWtLaunch } from './project-helpers.js';

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

function planRestore({ state, launch, sessionIds, resolveProfile, terminal }) {
  const resolve = typeof resolveProfile === 'function' ? resolveProfile : () => '';
  return (resolveRestoreIds({ state, sessionIds }).ids)
    .map(sessionId => ({ sessionId, slot: state.slots?.[sessionId] }))
    .filter(({ slot }) => Boolean(slot))
    .map(({ sessionId, slot }) => {
      const planned = planWtLaunch({
        launch,
        vars: { id: sessionId },
        profile: resolve(slot.cwd ?? ''),
        terminal,
      });
      return {
        sessionId,
        title: slot.titles[0],
        command: planned.command,
        args: planned.args,
        bounds: slot.bounds,
        desktop: slot.desktop,
      };
    });
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

/**
 * Стол, на который нужно уйти вслед за поднятым окном.
 *
 * Окно сессии всплывает там, где человек сейчас, а слот помнит свой стол — и
 * восстановление честно уносит окно туда. Со стороны это выглядит как
 * исчезновение: сессию открыли, окно мигнуло и пропало. Демон за такими
 * переносами следом уже ходит (`desktopFollowTarget`), но здесь переносит не
 * он: открытие сессии из пикера идёт через MQTT-процесс и `launchPlan()`, и до
 * тика демона окно успевает уехать. Замерено 2026-08-12 на
 * `obsidian-agent-workspace`.
 *
 * Только у одиночного подъёма — открытия конкретной сессии, самого осознанного
 * случая из всех. Восстановление пачкой (снимок, падение) поднимает окна на
 * разные столы, и выбрать из них один, чтобы выбросить туда человека, значит
 * решить за него.
 */
function restoreFollowDesktop({ planned = 0, placed = [] } = {}) {
  if (planned !== 1 || placed.length !== 1) return null;
  const desktop = placed[0]?.desktop;
  return Number.isFinite(desktop) && desktop > 0 ? desktop : null;
}

/**
 * Окно, которому после подъёма отдать ввод.
 *
 * Правило то же и по той же причине, что у `restoreFollowDesktop`: фокус
 * заслуживает только одиночный подъём — открытие названной сессии. Пачкой
 * (снимок, падение) поднимаются окна разных сессий, и выбрать из них одно
 * значит решить за человека, в котором из них он сейчас будет печатать.
 *
 * Заведено потому, что фокуса в восстановлении не было вовсе: сессия,
 * открытая из истории пикера, вставала на своё место, а ввод оставался у того,
 * кто держал передний план. Подъём `placeWindow()` (`bringToTop`) окно
 * показывает, но переднего плана не даёт, а переход на чужой стол вслед за
 * окном оставляет передним что придётся — поэтому фокус берётся последним, уже
 * после переноса и перехода.
 */
function restoreFocusTarget({ planned = 0, placed = [] } = {}) {
  if (planned !== 1 || placed.length !== 1) return null;
  const windowId = placed[0]?.windowId;
  return Number.isFinite(windowId) ? windowId : null;
}

export { bootTimeSec, detectCrash, planRestore, partitionPlan, resolveRestoreIds, restoreFocusTarget, restoreFollowDesktop };
