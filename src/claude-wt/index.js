import { getConfig } from '../config.js';
import { getVisibleWindowIds, getWindowById, getActiveWindowId } from '../windows.js';
import { placeWindowByConfig } from '../placement.js';
import { getWindowsMonitors } from '../monitors.js';
import { virtualDesktop } from '../virtual-desktop.js';
import { loadSessionIndex, loadBackgroundAgents } from './sessions.js';
import { readState, writeState, upsertSlot } from './state.js';
import { step } from './tracker-helpers.js';
import {
  mergeClaudeWtConfig,
  isTerminalPath,
  desktopOnlyActions,
  layoutFingerprint,
  focusedSessionIds,
  unresolvedTitles,
  emptyTickStats,
  recordTick,
  isStaleTick,
  sameTitleSessionIds,
  unreadFocusedAt,
  suppressFocus,
  applyFocusSuppression,
  applyPendingUnread,
} from './daemon-helpers.js';
import { loadProgress } from './progress.js';
import { activeAgent } from './view-helpers.js';
import { stripTitleDecoration } from './title-helpers.js';
import { snapshotTick, resetSnapshotter } from './snapshotter.js';

function getClaudeWtConfig() {
  return mergeClaudeWtConfig(getConfig().claudeWt);
}

function claudeWtProjects() {
  return getClaudeWtConfig().projects;
}

function isTerminalWindow(w) {
  return isTerminalPath(w?.path);
}

// Windows the tracker follows, and handles already ruled out. Keeping both
// means a hwnd costs one initWindow over its whole lifetime instead of one per
// tick — see the note on snapshot() below.
let terminals = new Map();
let notTerminals = new Set();

/**
 * The tick's view of the world, built the cheap way.
 *
 * getWindows() costs ~31 ms of CPU because it does OpenProcess plus an exe-path
 * query for *every* window in the system; at 1 Hz that alone is measurable in a
 * CPU graph (commit 96c2584). getVisibleWindowIds() is ~0.6 ms — EnumWindows
 * plus IsWindowVisible and nothing else. So: poll handles, resolve a handle to
 * a process exactly once, and read titles and bounds only for the handful of
 * windows that turned out to be Windows Terminal.
 */
function snapshot() {
  const ids = getVisibleWindowIds();
  const present = new Set(ids);
  // Windows recycles hwnds, so a handle that went away must lose its verdict.
  for (const id of terminals.keys()) if (!present.has(id)) terminals.delete(id);
  for (const id of notTerminals) if (!present.has(id)) notTerminals.delete(id);
  for (const id of ids) {
    if (terminals.has(id) || notTerminals.has(id)) continue;
    const w = getWindowById(id);
    if (w && isTerminalWindow(w)) terminals.set(id, w);
    else notTerminals.add(id);
  }
  const windows = [];
  for (const [id, w] of terminals) {
    // Заголовок нормализуется здесь и больше нигде: дальше по цепочке — история
    // заголовков в слотах, детект дублей, сравнение с индексом — всё работает с
    // одной формой. Заодно снимается мигание статус-глифа, иначе заголовок
    // считался бы новым каждый раз, когда Claude Code начинает или заканчивает
    // работу, и привязка к сессии переигрывалась бы без конца.
    const title = stripTitleDecoration(w.getTitle());
    const bounds = w.getBounds();
    if (!title || !bounds) continue;
    windows.push({ id, title, bounds });
  }
  return windows;
}

let intervalId = null;
let prevWindows = [];
let lastWritten = '';
let liveState = null;
let prevActiveWindowId = 0;
let reportedTitles = new Set();

// Сессии, чей следующий переход фокуса не считается просмотром. Живёт в памяти
// демона: пометка нужна ровно на те секунды, что человек закрывает пикер, а
// переживший перезапуск демон и так начинает с чистого экрана.
let focusMarks = {};

// Пометка, поставленная посреди тика, попала бы в карту слотов, которую тик
// уже отцепил: step() снимает копию до первого await, а `liveState = nextState`
// в конце уносит именно её. Поэтому пометки копятся отдельно и применяются к
// тому состоянию, которое тик уносит с собой.
let pendingUnread = {};

// Счётчики живости. Только в памяти: сторож в windows-mqtt спрашивает их через
// claudeWtStatus(), на диск они не едут и лишнего обращения к V: не стоят.
let tickStats = emptyTickStats();
let startedAt = 0;
// Номер поколения демона: растёт на каждом старте и остановке. Тик уносит его с
// собой и по возвращении сверяется — см. isStaleTick().
let generation = 0;

/** Diagnostics for the case the design cannot detect: a title we fail to match. */
function reportUnresolved(nextWindows) {
  for (const title of unresolvedTitles(nextWindows)) {
    if (reportedTitles.has(title)) continue;
    reportedTitles.add(title);
    console.log(`[claude-wt] terminal window not matched to a session: "${title}"`);
  }
  if (reportedTitles.size > 200) reportedTitles = new Set();
}

async function place(rule, what) {
  try {
    await placeWindowByConfig(rule);
  } catch (e) {
    console.error(`[claude-wt] failed to place ${what}: ${e.message}`);
  }
}

async function claudeWtTick(tickGen = null) {
  const cfg = getClaudeWtConfig();
  // Состояние живёт в памяти: с диска оно читается один раз при старте, дальше
  // файл — только снимок для восстановления, а не рабочая структура.
  if (!liveState) liveState = readState(cfg.statePath);
  const windows = snapshot();
  const sessionIndex = loadSessionIndex(cfg.sessionsFile, cfg.progressDir);
  // monitors нужны ДО actions: step() зажимает координаты сам, иначе запрошенная
  // и фактически применённая позиция расходятся и guard собственного хода
  // висит до таймаута, а потом записывает зажатую позицию поверх исходной.
  const monitors = windows.length ? getWindowsMonitors() : [];
  const seenWindows = prevWindows;
  const { nextWindows, actions, bindings, nextState } = step({
    prevWindows: seenWindows,
    windows,
    sessionIndex,
    state: liveState,
    monitors,
    now: Date.now(),
    options: { stableTicks: cfg.stableTicks },
  });
  prevWindows = nextWindows;
  if (cfg.debug) reportUnresolved(nextWindows);

  for (const action of actions) {
    // action.bounds уже зажаты внутри step() — повторно клампить не нужно
    const rule = { window: action.windowId, ...action.bounds };
    if (cfg.desktop && action.desktop) rule.desktop = action.desktop;
    await place(rule, `window ${action.windowId}`);
  }

  if (cfg.desktop) {
    const fixes = desktopOnlyActions({
      prevWindows: seenWindows, nextWindows, slots: nextState.slots, actions,
    });
    for (const fix of fixes) {
      await place({ window: fix.windowId, desktop: fix.desktop }, `window ${fix.windowId} on desktop ${fix.desktop}`);
    }
  }

  // Читаем номер виртуального стола только в момент привязки окна к сессии:
  // этот вызов спавнит VirtualDesktop11.exe, в горячем цикле ему не место.
  if (cfg.desktop) {
    for (const binding of bindings) {
      try {
        const num = await virtualDesktop.GetWindowDesktopNumber(binding.windowId);
        if (num !== undefined && nextState.slots[binding.sessionId]) {
          nextState.slots[binding.sessionId] = upsertSlot(nextState.slots[binding.sessionId], {
            desktop: Number(num) + 1,
          });
        }
      } catch (e) {
        console.error(`[claude-wt] failed to read desktop for ${binding.windowId}: ${e.message}`);
      }
    }
  }

  // Отметка «человек посмотрел на эту сессию». Читается голый hwnd переднего
  // окна — один GetForegroundWindow, без initWindow, — и записывается только в
  // момент перехода фокуса на окно, привязанное к сессии.
  const activeWindowId = getActiveWindowId();
  const caught = focusedSessionIds({
    activeWindowId, prevActiveWindowId, windows: nextWindows, slots: nextState.slots,
  });
  const { ids: focused, marks } = applyFocusSuppression({
    marks: focusMarks, ids: caught, nowMs: Date.now(),
  });
  focusMarks = marks;
  if (focused.length) {
    const seenAt = Math.floor(Date.now() / 1000);
    for (const id of focused) {
      if (nextState.slots[id]) nextState.slots[id] = upsertSlot(nextState.slots[id], { focusedAt: seenAt });
    }
  }
  prevActiveWindowId = activeWindowId;

  // Снимок расклада. Пока состав и координаты не менялись, тут только склейка
  // строки из id сессий; getMons() и запись файла случаются лишь по решению.
  try {
    snapshotTick({
      cfg,
      slots: nextState.slots,
      openSessionIds: nextWindows.filter(w => w.sessionId).map(w => w.sessionId),
      nowMs: Date.now(),
    });
  } catch (e) {
    console.error(`[claude-wt] snapshot failed: ${e.message}`);
  }

  // Тик, начатый до перезапуска, досчитывается уже в чужом доме: и liveState, и
  // файл принадлежат новому поколению, а он принёс картину мира до рестарта.
  if (isStaleTick(tickGen, generation)) return;
  // Пометки, пришедшие через markSessionUnread() пока этот тик был в полёте
  // (после того, как step() отцепил свою копию слотов от liveState), иначе
  // потерялись бы: nextState.slots их не видел, а строкой ниже он целиком
  // становится новым liveState. Наложить нужно до fingerprint — иначе на диск
  // снова уедет состояние без пометки.
  nextState.slots = applyPendingUnread(nextState.slots, pendingUnread);
  pendingUnread = {};
  liveState = nextState;
  const fingerprint = layoutFingerprint(nextState);
  if (fingerprint !== lastWritten) {
    writeState(cfg.statePath, nextState);
    lastWritten = fingerprint;
  }
}

/**
 * Запустить демона.
 *
 * `skipCrashCheck` — для подъёма сторожем: `maybeRestoreOnStart()` зовёт
 * `getWindows()` (тот самый полный перебор на ~31 мс, которого эта кодовая база
 * избегает) и при `restore.auto` открывает терминалы. А `detectCrash()` истинен
 * ровно в том случае, ради которого сторож и заведён — «демон так и не записал
 * состояние», — так что больной демон пытался бы восстанавливать сессии каждые
 * пять минут.
 */
function startClaudeWt({ skipCrashCheck = false } = {}) {
  const cfg = getClaudeWtConfig();
  if (!cfg.enabled) {
    console.error('[claude-wt] claudeWt.enabled is false in config, refusing to start');
    return;
  }
  if (!cfg.statePath) {
    console.error('[claude-wt] claudeWt.statePath is not set in config, refusing to start');
    return;
  }
  stopClaudeWt();
  liveState = null;
  prevWindows = [];
  lastWritten = '';
  prevActiveWindowId = 0;
  focusMarks = {};
  pendingUnread = {};
  tickStats = emptyTickStats();
  startedAt = Date.now();
  generation += 1;
  resetSnapshotter();
  terminals = new Map();
  notTerminals = new Set();
  reportedTitles = new Set();
  console.log(`[claude-wt] watching every ${cfg.interval}ms, state: ${cfg.statePath}`);
  if (!skipCrashCheck) {
    // Динамический импорт: restore.js импортирует этот модуль, статический импорт
    // в обратную сторону дал бы цикл.
    import('./restore.js')
      .then(mod => mod.maybeRestoreOnStart())
      .catch(e => console.error(`[claude-wt] crash check failed: ${e.message}`));
  }
  // Поколение снимается здесь, а не внутри тика: у всех тиков этого интервала
  // оно одно, и по нему видно, что вернувшийся тик принадлежит прошлой жизни.
  const gen = generation;
  intervalId = setInterval(() => {
    claudeWtTick(gen).then(
      () => {
        if (isStaleTick(gen, generation)) return;
        tickStats = recordTick(tickStats, { ok: true, nowMs: Date.now() });
      },
      e => {
        // Ошибка пишется в любом случае: даже опоздавший тик рассказывает, на
        // чём именно демон завис, — ради этого всё и затевалось.
        console.error(`[claude-wt] tick failed: ${e.message}`);
        if (isStaleTick(gen, generation)) return;
        tickStats = recordTick(tickStats, { ok: false, error: e.message, nowMs: Date.now() });
      },
    );
  }, cfg.interval);
}

function stopClaudeWt() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    // Иначе после перезапуска сторож увидит чужую статистику и решит, что
    // свежий демон болен ещё до первого своего тика.
    tickStats = emptyTickStats();
    startedAt = 0;
    // Тик, оставшийся в полёте на момент остановки, тоже отгораживаем: пусть
    // его результат никуда не едет, даже если демона больше не поднимут.
    generation += 1;
  }
}

function claudeWtStatus() {
  const cfg = getClaudeWtConfig();
  const state = liveState ?? readState(cfg.statePath);
  return {
    running: intervalId !== null,
    // Не диагностика, а рабочее поле: Windows отдаёт передний план только тому,
    // кто им уже владеет, поэтому ccfzf-picker перед POST /claude-wt/focus
    // зовёт AllowSetForegroundWindow на этот pid. Без него focusSession()
    // отчитается об успехе, а окно только мигнёт кнопкой на таскбаре.
    pid: process.pid,
    startedAt,
    lastTickAt: tickStats.lastTickAt,
    tickFailures: tickStats.tickFailures,
    lastTickError: tickStats.lastTickError,
    slots: Object.entries(state.slots).map(([id, slot]) => ({
      id, title: slot.titles[0], bounds: slot.bounds, desktop: slot.desktop, lastSeen: slot.lastSeen,
    })),
    lastLayout: state.lastLayout,
    statePath: cfg.statePath,
    sessionsFile: cfg.sessionsFile,
  };
}

/**
 * Вернуть сессию в непрочитанное.
 *
 * Живёт здесь, а не во view-слое, потому что состояние демона — это `liveState`
 * в памяти этого модуля: правка файла снаружи была бы затёрта следующим тиком.
 * Файл при этом пишется сразу — пикер читает состояние с диска, а ждать
 * следующего изменения расклада значило бы ждать неизвестно сколько.
 *
 * Запись агента берётся та же, по которой пикер рисует кружок: у сессии, чью
 * работу увёл фоновый агент, это запись форка, и отматывать надо относительно
 * неё.
 */
function markSessionUnread(id) {
  const cfg = getClaudeWtConfig();
  if (!cfg.enabled) return { ok: false, reason: 'claudeWt.enabled is false in config' };
  if (!cfg.statePath) return { ok: false, reason: 'claudeWt.statePath is not set in config' };
  if (!liveState) liveState = readState(cfg.statePath);
  if (!liveState.slots[id]) return { ok: false, reason: `unknown session ${id}` };

  const agents = loadBackgroundAgents(cfg.sessionsFile, cfg.progressDir);
  const childIds = (agents[id] ?? []).map(child => child.id);
  const progress = loadProgress(cfg.progressDir, [id, ...childIds]);
  const updated = activeAgent(id, progress, agents).agent?.updated ?? 0;
  // Без записи хука сессия и так не «прочитана»: гасить нечего.
  if (!updated) return { ok: false, reason: 'no agent record yet' };

  const ids = sameTitleSessionIds(liveState.slots, id);
  const unreadAt = unreadFocusedAt(updated);
  for (const sid of ids) {
    liveState.slots[sid] = upsertSlot(liveState.slots[sid], { focusedAt: unreadAt });
    // Тик, который окажется в полёте прямо сейчас, унесёт свою собственную копию
    // слотов мимо этой правки — см. комментарий у pendingUnread. Дублируем
    // пометку сюда, чтобы claudeWtTick() наложил её поверх nextState перед тем,
    // как тот станет новым liveState.
    pendingUnread[sid] = unreadAt;
  }
  focusMarks = suppressFocus(focusMarks, ids, Date.now());
  writeState(cfg.statePath, liveState);
  lastWritten = layoutFingerprint(liveState);
  return { ok: true, ids };
}

// Наружу, а не только внутрь: сторож в windows-mqtt принимает решение по этому
// же диагнозу и этим же порогам — иначе они разъедутся в двух репозиториях.
export {
  CLAUDE_WT_DEFAULTS,
  TICK_SILENCE_MS,
  TICK_GRACE_MS,
  claudeWtHealth,
} from './daemon-helpers.js';
export {
  getClaudeWtConfig,
  claudeWtProjects,
  isTerminalWindow,
  startClaudeWt,
  stopClaudeWt,
  claudeWtStatus,
  claudeWtTick,
  markSessionUnread,
};
