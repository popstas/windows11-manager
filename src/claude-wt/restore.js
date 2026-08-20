import os from 'node:os';
import { spawn } from 'node:child_process';
import { focusWindowById, getWindows } from '../windows.js';
import { placeWindowByConfig } from '../placement.js';
import { virtualDesktop } from '../virtual-desktop.js';
import { getWindowsMonitors } from '../monitors.js';
import { clampBoundsToMonitors } from '../geometry.js';
import { readState } from './state.js';
import { loadSessionIndex } from './sessions.js';
import { resolveSession } from './tracker-helpers.js';
import { stripTitleDecoration } from './title-helpers.js';
import { getClaudeWtConfig, isTerminalWindow } from './index.js';
import { bootTimeSec, detectCrash, planRestore, partitionPlan, resolveRestoreIds, restoreFocusTarget, restoreFollowDesktop } from './restore-helpers.js';
import { planSnapshotRestore, findSnapshot } from './snapshot-helpers.js';
import { listSnapshots } from './snapshotter.js';
import { profileForTerminal } from './project-helpers.js';
import { chooseTerminal } from './terminal-helpers.js';
import { focusTerminalWindow } from './focus-terminal.js';
import { cursorRule, placeByCursor } from './cursor-place.js';
import { noTiming } from './timing.js';

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
  const sessionIndex = loadSessionIndex(cfg.sessionsFile, cfg.progressDir);
  const ids = new Set();
  for (const w of terminalWindows()) {
    const resolved = resolveSession(stripTitleDecoration(w.getTitle()), sessionIndex, state.slots);
    if (resolved) ids.add(resolved.id);
  }
  return ids;
}

/**
 * The window we just launched is the one whose id was not there before.
 *
 * Опрос идёт до сна, а не после: всё, что делается с окном — место, стол,
 * фокус, — ждёт этой находки, и полтакта, проспанные впустую, человек видит
 * как задержку. По той же причине такт вчетверо короче таймаута соседей и
 * равен такту `focusSpawnedWindow` (250 мс): бюджет опроса это не трогает —
 * цикл живёт только пока запущенный терминал не показал окно, а не постоянно.
 */
async function waitForNewWindow(knownIds, timeoutMs, pollMs = 250) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = terminalWindows().find(w => !knownIds.has(w.id));
    if (found) return found;
    if (Date.now() >= deadline) return null;
    await sleep(pollMs);
  }
}

/**
 * Bring the last layout back, one window at a time. Sequential on purpose: two
 * windows popping up at once cannot be told apart, and identifying them by
 * title is not an option either — the title has not settled yet at that point.
 *
 * `terminal` — имя из живой просьбы (Enter в пикере на мёртвой сессии); без
 * него, как при восстановлении на старте, `resolveTerminal` берёт дефолт
 * машины — то же самое, что явно передать пустую строку.
 *
 * `cursor` — оттуда же и только оттуда: точка, которой пикер называет экран,
 * когда у человека включена галка «на активном экране». Восстановление на
 * старте и снимок курсора не знают и не должны — там окон много, и один экран
 * на всех был бы решением за человека.
 */
async function restoreClaudeSessions({ force = false, sessionIds, terminal, cursor = null } = {}) {
  const cfg = getClaudeWtConfig();
  const state = readState(cfg.statePath);
  const { unknown } = resolveRestoreIds({ state, sessionIds });
  for (const id of unknown) console.error(`[claude-wt] no remembered slot for session ${id}`);
  const { chosen, message } = chooseTerminal(terminal, cfg, 'launch');
  if (message) console.error(message);
  const command = chosen.entry?.command ?? cfg.launch.command;
  if (!command) {
    console.error('[claude-wt] nothing to launch with: neither claudeWt.terminals nor claudeWt.launch.command is set');
    return { restored: [], skipped: [] };
  }
  const resolveProfile = cwd => profileForTerminal(cwd, chosen.name, cfg);
  const fullPlan = planRestore({ state, launch: cfg.launch, sessionIds, resolveProfile, terminal: chosen.entry });
  const restored = [];
  const skipped = [];
  if (!fullPlan.length) {
    console.log('[claude-wt] nothing to restore');
    return { restored, skipped };
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
  await launchPlan({ plan, cfg, restored, skipped, cursor });
  console.log(`[claude-wt] restored ${restored.length}, skipped ${skipped.length}`);
  return { restored, skipped };
}

/**
 * Запустить и расставить окна по плану.
 *
 * Последовательно, и это не про аккуратность: два окна, всплывшие одновременно,
 * не отличить друг от друга, а по заголовку тем более — он в этот момент ещё не
 * устоялся. `restored` и `skipped` заполняются на месте, потому что вызывающий
 * печатает по ним итог.
 */
async function launchPlan({ plan, cfg, restored, skipped, cursor = null }) {
  const monitors = getWindowsMonitors();
  const placed = [];
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
    // Показать окно сразу, не дожидаясь ни доводки размера, ни переноса: это
    // самое раннее, что можно сделать с ним после появления, и стоит оно
    // одного `bringToTop()`. Ввод так не отдаётся (передний план даётся не
    // всякому, и после перехода на другой стол он всё равно достаётся кому
    // придётся) — фокус берётся ниже, последним действием.
    //
    // Только у одиночного подъёма, по тому же правилу, что фокус и переход:
    // пачкой всплывают окна разных сессий, и поднимать из них одно — решать
    // за человека.
    if (plan.length === 1) focusWindowById(win.id);
    // Окно уже есть, но Windows Terminal ещё доводит его до нужного размера;
    // позиция, выставленная в этот момент, тут же затирается.
    await sleep(cfg.restore.settleMs);
    // Курсор главнее памяти о месте, и главнее её целиком — не только экран,
    // но и стол. Слот помнит, где окно этой сессии стояло вчера; курсор —
    // куда человек попросил прямо сейчас, включив галку и поставив мышь, и
    // явная сегодняшняя просьба обязана перебивать вчерашнюю неявную. Правило
    // общее с дорогой resume (`cursorRule`): разойдись они, галка работала бы
    // по-разному в зависимости от того, помнит ли трекер эту сессию, — то
    // есть через раз и необъяснимо.
    //
    // Размер при этом остаётся от слота: переезд на соседний экран — про
    // экран, а не про то, чтобы забыть, каким окно было.
    //
    // Только у одиночного подъёма, по тому же правилу, что фокус и переход
    // ниже: курсора у восстановления пачкой не бывает вовсе, а свались он
    // туда — все окна сложились бы на один экран молча.
    //
    // Незнакомая точка — `null` от `cursorRule` и откат на прежнюю дорогу:
    // она означает, что конфиг мониторов разошёлся с тем, что видит пикер, и
    // ставить наугад тут хуже, чем сделать то, что делали всегда.
    const target = cursor && plan.length === 1
      ? cursorRule({ win, cursor, slot: { bounds: item.bounds } })
      : null;
    if (target) {
      // Стол не назначается вовсе, и `desktop: null` в `placed` гасит переход
      // следом (`restoreFollowDesktop`): «открывай там, где я смотрю» читается
      // буквально, а окно, уехавшее на запомненный стол, утащило бы туда и
      // человека — то есть галка отменяла бы сама себя.
      if (await placeByCursor(target, placeWindowByConfig, item.title)) {
        restored.push(item.sessionId);
        placed.push({ desktop: null, windowId: win.id });
      } else {
        skipped.push(item.sessionId);
      }
      continue;
    }
    const bounds = clampBoundsToMonitors(item.bounds, monitors);
    const rule = { window: win.id, ...bounds };
    if (cfg.desktop && item.desktop) rule.desktop = item.desktop;
    try {
      await placeWindowByConfig(rule);
      restored.push(item.sessionId);
      placed.push({ desktop: rule.desktop ?? null, windowId: win.id });
    } catch (e) {
      console.error(`[claude-wt] failed to place ${item.sessionId}: ${e.message}`);
      skipped.push(item.sessionId);
    }
  }

  // Окно уехало на свой стол — уходим следом, иначе открытая сессия выглядит
  // исчезнувшей. Переключение на стол, где человек и так стоит, — холостой ход.
  const follow = restoreFollowDesktop({ planned: plan.length, placed });
  if (follow) {
    try {
      // Слоты хранят 1-based номер, GoToDesktopNumber ждёт 0-based.
      await virtualDesktop.GoToDesktopNumber(follow - 1);
    } catch (e) {
      console.error(`[claude-wt] failed to follow restored window to desktop ${follow}: ${e.message}`);
    }
  }

  // Фокус — последним. Раньше его не было вовсе: сессия, открытая из истории
  // пикера, вставала на своё место, а ввод оставался у того, кто держал
  // передний план, — человек смотрел на терминал и печатал мимо него. Место в
  // конце не случайно: переход на чужой стол оставляет передним что придётся,
  // и фокус, взятый до него, пропал бы.
  //
  // Стол передаётся известным: его только что навязало правило, и
  // переспрашивать `VirtualDesktop11.exe` незачем — после `follow` окно и так
  // на текущем столе, так что дешёвая ветка `focusTerminalWindow` отработает
  // с первой попытки и ни одного процесса не запустит.
  const target = restoreFocusTarget({ planned: plan.length, placed });
  if (target !== null) await focusTerminalWindow(target, noTiming, follow);
}

/**
 * Поднять сессии из снимка.
 *
 * Отличается от restoreClaudeSessions() двумя вещами, и обе — то, ради чего
 * снимки заводились:
 *
 * - координаты берутся из снимка, а не из слотов. Слот переписывается: после
 *   закрытия и переоткрытия сессии там оказывается дефолтная геометрия
 *   Windows Terminal, и восстановление возвращало окно не на место;
 * - дедупликация по уже открытым — всегда, без флагов. Прежний отказ «сначала
 *   закройте их» срабатывал в самом частом случае (закрыл одну из трёх) и
 *   делал команду бесполезной.
 */
async function restoreSnapshot({ id, sessionIds } = {}) {
  const cfg = getClaudeWtConfig();
  const snapshot = findSnapshot(listSnapshots(cfg), id);
  const restored = [];
  const skipped = [];
  if (!snapshot) {
    console.error(id && id !== 'last' ? `[claude-wt] no snapshot ${id}` : '[claude-wt] no snapshots yet');
    return { restored, skipped };
  }
  const { chosen, message } = chooseTerminal('', cfg, 'launch');
  if (message) console.error(message);
  const command = chosen.entry?.command ?? cfg.launch.command;
  if (!command) {
    console.error('[claude-wt] nothing to launch with: neither claudeWt.terminals nor claudeWt.launch.command is set');
    return { restored, skipped: snapshot.sessions.map(s => s.id) };
  }
  const state = readState(cfg.statePath);
  const resolveProfile = cwd => profileForTerminal(cwd, chosen.name, cfg);
  const plan = planSnapshotRestore({
    snapshot,
    openSessionIds: openSessionIds(cfg, state),
    sessionIds,
    launch: cfg.launch,
    resolveProfile,
    terminal: chosen.entry,
  });
  if (!plan.length) {
    console.log(`[claude-wt] snapshot ${snapshot.id}: every session is already open, nothing to restore`);
    return { restored, skipped };
  }
  console.log(`[claude-wt] snapshot ${snapshot.id}: restoring ${plan.length} of ${snapshot.sessions.length} session(s)`);
  await launchPlan({ plan, cfg, restored, skipped });
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

export {
  waitForNewWindow,
  launchPlan,
  openSessionIds,
  restoreClaudeSessions,
  restoreSnapshot,
  maybeRestoreOnStart,
};
