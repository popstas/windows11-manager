import os from 'node:os';
import { getConfig } from '../config.js';
import { getVisibleWindowIds, getWindowById, getActiveWindowId, focusWindowById } from '../windows.js';
import { placeWindowByConfig } from '../placement.js';
import { getWindowsMonitors } from '../monitors.js';
import { virtualDesktop } from '../virtual-desktop.js';
import { loadSessionIndex, loadBackgroundAgents } from './sessions.js';
import { readState, writeState, upsertSlot } from './state.js';
import {
  buildWindowsFile,
  windowsFingerprint,
  shouldWriteWindowsFile,
  writeWindowsFile,
  removeWindowsFile,
} from './windows-file.js';
import { step } from './tracker-helpers.js';
import {
  mergeClaudeWtConfig,
  isTerminalPath,
  terminalAppName,
  desktopOnlyActions,
  desktopRelearnTarget,
  desktopFollowTarget,
  relearnedDesktop,
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
import { snapshotTick, resetSnapshotter, currentSnapshots } from './snapshotter.js';

function getClaudeWtConfig() {
  return mergeClaudeWtConfig(getConfig().claudeWt);
}

function claudeWtProjects() {
  return getClaudeWtConfig().projects;
}

function isTerminalWindow(w) {
  return isTerminalPath(w?.path, getClaudeWtConfig().terminalExecutables);
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
    // Имя терминала берётся здесь, а не в publishWindows: путь к exe есть
    // только у объекта окна, и живёт тот в этой карте. Стоит это одного
    // разбора строки на окно за тик — путь уже прочитан, `getPath()` тут не
    // зовётся.
    windows.push({ id, title, bounds, app: terminalAppName(w.path) });
  }
  return windows;
}

let intervalId = null;
let prevWindows = [];
let lastWritten = '';
// Отпечаток и время последней записи опубликованного файла окон. Отдельно от
// lastWritten: тот сторожит расклад целиком (координаты, вернувшиеся сессии), а
// этот — только то, что видно чужому читателю.
let lastWindowsFingerprint = '';
let lastWindowsWrite = 0;
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

  // Переднее окно читается ДО переносов, и это существенно дважды. Во-первых,
  // за уехавшим окном идём только если человек работал именно с ним, а
  // переехавшее на чужой стол окно передним быть перестаёт. Во-вторых,
  // placeWindow() зовёт bringToTop() на каждый перенос координат: прочитанный
  // после этого hwnd — наш собственный ход, и он засчитывался как «человек
  // посмотрел на сессию».
  const activeWindowId = getActiveWindowId();
  const moves = [];

  for (const action of actions) {
    // action.bounds уже зажаты внутри step() — повторно клампить не нужно
    const rule = { window: action.windowId, ...action.bounds };
    if (cfg.desktop && action.desktop) rule.desktop = action.desktop;
    moves.push({ windowId: action.windowId, desktop: rule.desktop });
    await place(rule, `window ${action.windowId}`);
  }

  if (cfg.desktop) {
    const fixes = desktopOnlyActions({
      prevWindows: seenWindows, nextWindows, slots: nextState.slots, actions,
    });
    for (const fix of fixes) {
      moves.push({ windowId: fix.windowId, desktop: fix.desktop });
      await place({ window: fix.windowId, desktop: fix.desktop }, `window ${fix.windowId} on desktop ${fix.desktop}`);
    }
  }

  // Окно новой сессии открывается там, где человек сейчас, а слот может помнить
  // другой стол — и окно уезжает у него из-под рук, выглядя исчезнувшим. Идём
  // следом, но только за тем окном, которое было передним.
  if (cfg.desktop) {
    const follow = desktopFollowTarget({ moves, activeWindowId, startedAt, nowMs: Date.now() });
    if (follow) {
      try {
        // Слот хранит 1-based номер, GoToDesktopNumber ждёт 0-based — та же
        // пара, что у GetWindowDesktopNumber выше.
        await virtualDesktop.GoToDesktopNumber(follow - 1);
        // Перейти на стол — ещё не вернуться к окну: передним после
        // переключения Windows оставляет что придётся, и человек, шедший за
        // своим окном, оказывается на нужном столе перед чужим. Раньше это
        // прятала пауза в focusSpawnedWindow: фокус брался уже после всех
        // переносов, то есть ценой четырёх секунд ожидания на каждое открытие.
        // Здесь тот же исход достаётся даром — окно, за которым пошли, и есть
        // то, которое надо сделать передним.
        if (!focusWindowById(activeWindowId)) {
          console.error(`[claude-wt] followed window ${activeWindowId} to desktop ${follow}, but focus did not stick`);
        }
      } catch (e) {
        console.error(`[claude-wt] failed to follow window to desktop ${follow}: ${e.message}`);
      }
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
  // Тем же переходом фокуса переучивается номер виртуального стола: окно, на
  // которое человек только что перешёл, стоит там, где он его и хочет видеть.
  // Пометка «пропустить этот фокус» сюда не относится — она про «посмотрел
  // осознанно», а стол окна от намерения не зависит.
  if (cfg.desktop) {
    const relearn = desktopRelearnTarget({
      activeWindowId, prevActiveWindowId, windows: nextWindows, slots: nextState.slots,
    });
    if (relearn) {
      try {
        const desktop = relearnedDesktop(await virtualDesktop.GetWindowDesktopNumber(relearn.windowId));
        const slot = nextState.slots[relearn.sessionId];
        if (desktop !== null && slot && slot.desktop !== desktop) {
          nextState.slots[relearn.sessionId] = upsertSlot(slot, { desktop });
        }
      } catch (e) {
        console.error(`[claude-wt] failed to relearn desktop for ${relearn.windowId}: ${e.message}`);
      }
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
  publishWindows(cfg, nextWindows, nextState.slots);
}

/**
 * Опубликовать файл окон — необязательную добавку для читателей на той стороне.
 *
 * Ошибка записи гасится строкой в лог. Файл нужен ccfzf ради одной пометки в
 * списке сессий, и недоступный сетевой диск не повод ронять тик, который следит
 * за окнами: без пометки человек проживёт, без слежения — нет.
 */
function publishWindows(cfg, windows, slots) {
  if (!cfg.windowsFile) return;
  const nowMs = Date.now();
  // Снимки берутся из кэша снапшотера, а не из файла: publishWindows зовётся
  // каждый тик, а файл снимков лежит там же, где состояние, — на диске.
  const snapshots = currentSnapshots();
  const payload = buildWindowsFile({
    windows, slots, host: os.hostname(), pid: process.pid, nowMs, snapshots,
    projects: claudeWtProjects(),
  });
  const fingerprint = windowsFingerprint(payload.windows, payload.snapshots, payload.projects);
  const due = shouldWriteWindowsFile({
    fingerprint, lastFingerprint: lastWindowsFingerprint, lastWriteMs: lastWindowsWrite, nowMs,
  });
  if (!due) return;
  try {
    writeWindowsFile(cfg.windowsFile, payload);
    lastWindowsFingerprint = fingerprint;
    lastWindowsWrite = nowMs;
  } catch (e) {
    console.error(`[claude-wt] windows file write failed: ${e.message}`);
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
  // Свежий демон обязан опубликовать файл первым же тиком: pid в нём сменился,
  // а по старому сторож демона снял бы мёртвый процесс — то есть ничей.
  lastWindowsFingerprint = '';
  lastWindowsWrite = 0;
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
    // Опубликованный файл переживал остановку и продолжал предъявлять читателям
    // и сторожу pid процесса, которого больше нет. Убираем его тем же движением,
    // что и интервал: остановленный демон не тикает, и файла у него быть не
    // должно. Ошибку сюда не пускаем — остановка обязана дойти до конца.
    try {
      const { windowsFile } = getClaudeWtConfig();
      removeWindowsFile(windowsFile);
    } catch (e) {
      console.error(`[claude-wt] windows file remove failed: ${e.message}`);
    }
    lastWindowsFingerprint = '';
    lastWindowsWrite = 0;
  }
}

function claudeWtStatus() {
  const cfg = getClaudeWtConfig();
  const state = liveState ?? readState(cfg.statePath);
  return {
    running: intervalId !== null,
    // Диагностика: чей это процесс. Рабочий экземпляр того же числа уходит в
    // windowsFile — по нему сторож демона (watchdog.js) снимает замолчавшего.
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
export { removeWindowsFile } from './windows-file.js';
