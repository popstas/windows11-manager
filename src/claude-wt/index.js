import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConfig } from '../config.js';
import { getVisibleWindowIds, getWindowById, getActiveWindowId, focusWindowById } from '../windows.js';
import { placeWindowByConfig } from '../placement.js';
import { movedDesktop } from '../placement-helpers.js';
import { noAutoplaceIds } from '../no-autoplace.js';
import { getWindowsMonitors } from '../monitors.js';
import { virtualDesktop } from '../virtual-desktop.js';
import { loadSessionIndexFor, loadBackgroundAgentsFor } from './sessions.js';
import { readState, writeState, upsertSlot } from './state.js';
import {
  buildWindowsFile,
  windowsFingerprint,
  shouldWriteWindowsFile,
  writeWindowsFile,
  removeWindowsFile,
  signalPrint,
  shouldWriteSignal,
  signalPath,
  localWindowsFileName,
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
  indexWanted,
  emptyTickStats,
  recordTick,
  isStaleTick,
  sameTitleSessionIds,
  sessionMark,
  suppressFocus,
  applyFocusSuppression,
  applyPendingUnread,
} from './daemon-helpers.js';
import { loadProgress } from './progress.js';
import { activeAgent } from './view-helpers.js';
import { stripTitleDecoration } from './title-helpers.js';
import { snapshotTick, resetSnapshotter, currentSnapshots } from './snapshotter.js';
import { resolveHeadLayout } from './head-zones.js';
import { REPO_ROOT, iconsSidecarPath, projectIcons, headIcon } from './window-icons-helpers.js';
import { unreadSidecarPath, appendUnreadRequest, freshUnreadRequests } from './unread-requests-helpers.js';

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
// Местная копия файла окон (`features.localSource`) — свой отпечаток и своё
// сердцебиение: отвалившийся V: (частая беда nb) не должен глушить местную
// запись, а удачная местная — притворяться, что удалённая дошла.
let lastLocalFingerprint = '';
let lastLocalWrite = 0;

/** `~/.ccfzf/windows/<host>.json` — умолчание `CCFZF_WINDOWS_DIR` у ccfzf. */
function localWindowsFile(host) {
  return path.join(os.homedir(), '.ccfzf', 'windows', localWindowsFileName(host));
}
// Отпечаток последнего сигнала пикеру (см. signalPrint) — своя, узкая копия
// расклада без сердцебиения: строка пишется на смену отпечатка и только на неё.
let lastSignalPrint = null;
// Иконки окон от службы (window-icons.json рядом с файлом состояния): mtime
// последнего прочитанного и сама карта. Битый или пропавший файл оставляет
// прежнюю карту — иконка в списке пикера не стоит того, чтобы ронять тик.
let iconsMtime = 0;
let iconsMap = {};
let liveState = null;
let prevActiveWindowId = 0;
let reportedTitles = new Set();

// Появился ли на прошлом тике НОВЫЙ заголовок без сессии. Индекс читается ДО
// step(), то есть про непривязанное окно мы узнаём на тик позже, — и это
// нормально: тик секундный, а второе чтение дампа в том же тике стоило бы
// сетевого чтения на каждом витке.
let wantedIndex = false;
// Непривязанные заголовки прошлого тика: спрос поднимает появление нового, а
// не наличие хоть одного. Окно терминала, сессией Claude не являющееся, стоит
// непривязанным вечно — см. `indexWanted`.
let unresolvedSeen = new Set();

// Сессии, чей следующий переход фокуса не считается просмотром. Живёт в памяти
// демона: пометка нужна ровно на те секунды, что человек закрывает пикер, а
// переживший перезапуск демон и так начинает с чистого экрана.
let focusMarks = {};

// Пометка, поставленная посреди тика, попала бы в карту слотов, которую тик
// уже отцепил: step() снимает копию до первого await, а `liveState = nextState`
// в конце уносит именно её. Поэтому пометки копятся отдельно и применяются к
// тому состоянию, которое тик уносит с собой.
let pendingUnread = {};

// Просьбы «непрочитано» от службы (unread-requests.json рядом с файлом
// состояния, см. unread-requests-helpers.js): mtime прочитанного и время
// последней применённой просьбы. Свежий демон старые просьбы не применяет.
let unreadMtime = 0;
let unreadAppliedAt = 0;

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

/**
 * Ответ пробрасывается наружу: по нему решается, уходить ли следом за окном на
 * его стол. Не вышло — `null`, и переезда не было тем более.
 */
async function place(rule, what) {
  try {
    return await placeWindowByConfig(rule);
  } catch (e) {
    console.error(`[claude-wt] failed to place ${what}: ${e.message}`);
    return null;
  }
}

async function claudeWtTick(tickGen = null) {
  const cfg = getClaudeWtConfig();
  // Состояние живёт в памяти: с диска оно читается один раз при старте, дальше
  // файл — только снимок для восстановления, а не рабочая структура.
  if (!liveState) liveState = readState(cfg.statePath);
  takeUnreadRequests(cfg.statePath);
  const windows = snapshot();
  const sessionIndex = loadSessionIndexFor(cfg, Date.now(), wantedIndex);
  wantedIndex = false;
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
    // Окна, поставленные намеренно (просьба открыть сессию на экране под
    // курсором). Читается каждый тик, а не запоминается: пишет пометки другой
    // процесс — служба MQTT, — и запомненный список не узнал бы о новой.
    noAutoplace: noAutoplaceIds(),
    options: { stableTicks: cfg.stableTicks },
  });
  prevWindows = nextWindows;
  // Спрос на следующий тик. Считается той же функцией, что и жалоба в лог:
  // второе правило «какое окно считать непривязанным» разошлось бы с первым.
  ({ wanted: wantedIndex, seen: unresolvedSeen } = indexWanted(nextWindows, unresolvedSeen));
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
    // В `moves` идёт состоявшийся переезд, а не намерение: правило со столом
    // ставится почти на каждый перенос координат, но стол при этом чаще всего
    // и так свой. Считай мы переездом само правило — переход следом случался
    // бы на ровном месте, а он не бесплатный (`movedDesktop`).
    const placed = await place(rule, `window ${action.windowId}`);
    if (movedDesktop(placed)) moves.push({ windowId: action.windowId, desktop: rule.desktop });
  }

  if (cfg.desktop) {
    const fixes = desktopOnlyActions({
      prevWindows: seenWindows, nextWindows, slots: nextState.slots, actions,
    });
    for (const fix of fixes) {
      const placed = await place({ window: fix.windowId, desktop: fix.desktop }, `window ${fix.windowId} on desktop ${fix.desktop}`);
      if (movedDesktop(placed)) moves.push({ windowId: fix.windowId, desktop: fix.desktop });
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
 * Принять просьбы «непрочитано», которые служба оставила в файле рядом с
 * состоянием (markSessionUnread вне процесса демона). Ложатся они тем же путём,
 * что и пометка, сделанная в этом процессе: в `pendingUnread` (тик наложит их
 * на унесённое состояние, и они уедут и в state-файл, и в файл окон) и в
 * подавление возвратного фокуса. Файл локальный: один statSync на тик.
 */
function takeUnreadRequests(statePath) {
  const file = unreadSidecarPath(statePath);
  if (!file) return;
  let raw;
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (mtime === unreadMtime) return;
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    unreadMtime = mtime;
  } catch {
    return; // нет файла или он пишется — заберём на следующем тике
  }
  const { marks, ids, lastAt } = freshUnreadRequests(raw, unreadAppliedAt);
  unreadAppliedAt = lastAt;
  if (!ids.length) return;
  for (const id of ids) {
    if (liveState.slots[id]) liveState.slots[id] = upsertSlot(liveState.slots[id], marks[id]);
    pendingUnread[id] = marks[id];
  }
  // Возвратный фокус гасится только у «непросмотрено»: после «просмотрено»
  // переход на окно и есть просмотр.
  const unread = ids.filter(id => marks[id].unreadAt > 0);
  const seen = ids.filter(id => !(marks[id].unreadAt > 0));
  if (unread.length) focusMarks = suppressFocus(focusMarks, unread, Date.now());
  if (unread.length) console.log(`[claude-wt] marked unread by request: ${unread.join(', ')}`);
  if (seen.length) console.log(`[claude-wt] marked seen by request: ${seen.join(', ')}`);
}

/**
 * Карта sessionId → иконка, которую решила служба (src/mqtt/window-icons.js).
 * Файл локальный, mtime здесь не врёт (в отличие от сетевого диска), и на
 * каждом тике это один statSync.
 */
function readWindowIcons(statePath) {
  const file = iconsSidecarPath(statePath);
  if (!file) return iconsMap;
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (mtime === iconsMtime) return iconsMap;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    iconsMap = parsed && typeof parsed.icons === 'object' && parsed.icons ? parsed.icons : {};
    iconsMtime = mtime;
  } catch { /* нет файла или он пишется — прежняя карта */ }
  return iconsMap;
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
  // Основные зоны для полей monitor/zone/slot. Файлы FancyZones и список
  // мониторов перечитываются не чаще раза в минуту (кэш в head-zones.js), и
  // одна и та же причина отказа пишется в журнал один раз.
  const layout = resolveHeadLayout({
    headZones: cfg.headZones,
    problems: cfg.headZonesProblems,
    log: message => console.warn(`[claude-wt] ${message}`),
    nowMs,
  });
  const payload = buildWindowsFile({
    windows, slots, host: os.hostname(), pid: process.pid, nowMs, snapshots,
    layout, headZones: cfg.headZones,
    icons: readWindowIcons(cfg.statePath),
    projects: claudeWtProjects(),
    // Иконки строк без окна — истории и проектов у читателя. Решаются здесь,
    // а не службой: метки head им не нужны, а конфиг у демона свой и тот же.
    projectIcons: projectIcons(cfg, REPO_ROOT),
    headIcon: headIcon(cfg, REPO_ROOT),
    // Ключ верхнего уровня, не внутри claudeWt: вложенный молча ничего не
    // сделает — та же семья, что placeWindowOnOpen и publishStats. `cfg` тут —
    // подобъект claudeWt (см. getClaudeWtConfig), поэтому порт берётся у
    // корневого конфига, как это делают src/mqtt/autoplacer.js и stats.js.
    //
    // Умолчание то же самое, что слушает src/mqtt/service.js (`?? 9722`), и
    // должно остаться тем же: без него на машине без явного `httpPort` в
    // конфиге слушатель поднимался бы на 9722, а файл трекера объявлял бы
    // порт отсутствующим — пикер тихо откатывался бы на MQTT.
    httpPort: getConfig().httpPort ?? 9722,
    // Тоже верхнего уровня, рядом с портом: адрес слушателя, доступный с
    // pc-virt (`nb.popstas.pro`). Пусто — читатель берёт имя машины.
    httpHost: getConfig().httpHost,
  });
  // Сигнал пикеру: узкий отпечаток (без сердцебиения, см. signalPrint) — до
  // гейта ниже, у него своё правило записи.
  const signal = signalPrint(payload);
  if (shouldWriteSignal({ print: signal, lastPrint: lastSignalPrint })) {
    try {
      writeWindowsFile(signalPath(), {
        generated: Math.floor(nowMs / 1000),
        host: os.hostname(),
        pid: process.pid,
        print: signal,
      });
      lastSignalPrint = signal;
    } catch (e) {
      // Строка в лог и всё: сигнал это добавка, и ронять из-за него тик
      // слежения за окнами нельзя — без пометки человек проживёт, без
      // слежения нет.
      console.error(`[claude-wt] signal write failed: ${e.message}`);
    }
  }
  const fingerprint = windowsFingerprint(payload.windows, payload.snapshots, payload.projects, payload.headIcon);
  const due = shouldWriteWindowsFile({
    fingerprint, lastFingerprint: lastWindowsFingerprint, lastWriteMs: lastWindowsWrite, nowMs,
  });
  // Второй адрес — свой же каталог: там файл читает агрегатор этой машины, и
  // только оттуда окно доедет до сессии, которая работает здесь. Отказ одной
  // записи не отменяет другую: адреса и читатели разные.
  if (cfg.features?.localSource) {
    const localDue = shouldWriteWindowsFile({
      fingerprint, lastFingerprint: lastLocalFingerprint, lastWriteMs: lastLocalWrite, nowMs,
    });
    if (localDue) {
      try {
        writeWindowsFile(localWindowsFile(os.hostname()), payload);
        lastLocalFingerprint = fingerprint;
        lastLocalWrite = nowMs;
      } catch (e) {
        console.error(`[claude-wt] local windows file write failed: ${e.message}`);
      }
    }
  }
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
  lastLocalFingerprint = '';
  lastLocalWrite = 0;
  prevActiveWindowId = 0;
  focusMarks = {};
  pendingUnread = {};
  unreadMtime = 0;
  unreadAppliedAt = Date.now();
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
    // Местную копию — тоже, и независимо от выключателя: его могли снять,
    // пока демон работал, а оставленный файл местный агрегатор читал бы
    // до WINDOWS_TTL как живой.
    try {
      removeWindowsFile(localWindowsFile(os.hostname()));
    } catch (e) {
      console.error(`[claude-wt] local windows file remove failed: ${e.message}`);
    }
    lastWindowsFingerprint = '';
    lastWindowsWrite = 0;
    lastLocalFingerprint = '';
    lastLocalWrite = 0;
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
 *
 * Кроме отката `focusedAt` ставит `unreadAt` (sessionMark): он едет в файл
 * трекера, и пикер считает сессию непросмотренной, пока `unreadAt` новее и его
 * местной отметки, и `focusedAt`.
 */
function markSessionUnread(id) {
  return markSession(id, 'unread');
}

/**
 * Явное «просмотрено» без перехода на окно: `focusedAt` «сейчас», `unreadAt`
 * снят. Окно не поднимается и фокус не уходит — только отметки (решение head
 * 22.11). Записи агента не требует: смотреть можно и на сессию без неё.
 */
function markSessionSeen(id) {
  return markSession(id, 'seen');
}

function markSession(id, kind) {
  const cfg = getClaudeWtConfig();
  if (!cfg.enabled) return { ok: false, reason: 'claudeWt.enabled is false in config' };
  if (!cfg.statePath) return { ok: false, reason: 'claudeWt.statePath is not set in config' };
  // Демон в другом процессе (так всегда в установке с треем: просьба приходит в
  // службу): его слоты в памяти, и правка файла отсюда не доживала до
  // следующей его записи. Тогда — просьба ему в файле, см. takeUnreadRequests.
  if (intervalId === null) return requestMark(cfg, id, kind);
  if (!liveState) liveState = readState(cfg.statePath);
  if (!liveState.slots[id]) return { ok: false, reason: `unknown session ${id}` };

  const mark = sessionMark(kind, {
    updated: kind === 'unread' ? agentUpdatedFor(cfg, id) : 0,
    nowSec: Math.floor(Date.now() / 1000),
  });
  // Без записи хука сессия и так не «прочитана»: гасить нечего.
  if (!mark) return { ok: false, reason: 'no agent record yet' };

  const ids = sameTitleSessionIds(liveState.slots, id);
  for (const sid of ids) {
    liveState.slots[sid] = upsertSlot(liveState.slots[sid], mark);
    // Тик, который окажется в полёте прямо сейчас, унесёт свою собственную копию
    // слотов мимо этой правки — см. комментарий у pendingUnread. Дублируем
    // пометку сюда, чтобы claudeWtTick() наложил её поверх nextState перед тем,
    // как тот станет новым liveState.
    pendingUnread[sid] = mark;
  }
  if (kind === 'unread') focusMarks = suppressFocus(focusMarks, ids, Date.now());
  writeState(cfg.statePath, liveState);
  lastWritten = layoutFingerprint(liveState);
  return { ok: true, ids, ...mark };
}

/** Запись хука, относительно которой отматывается «просмотрено». */
function agentUpdatedFor(cfg, id) {
  const agents = loadBackgroundAgentsFor(cfg);
  const childIds = (agents[id] ?? []).map(child => child.id);
  const progress = loadProgress(cfg.progressDir, [id, ...childIds]);
  return activeAgent(id, progress, agents).agent?.updated ?? 0;
}

/**
 * markSession вне процесса демона: состояние читается с диска заново на
 * каждую просьбу (кэшировать его здесь нельзя — новые сессии появляются у
 * демона, а не тут), и просьба дописывается в unread-requests.json. Запись —
 * через временный файл и rename: демон читает этот файл каждую секунду.
 *
 * `requested: true` в ответе — просьба принята, ляжет на ближайшем тике
 * демона (раз в секунду).
 */
function requestMark(cfg, id, kind) {
  const state = readState(cfg.statePath);
  if (!state.slots[id]) return { ok: false, reason: `unknown session ${id}` };
  const mark = sessionMark(kind, {
    updated: kind === 'unread' ? agentUpdatedFor(cfg, id) : 0,
    nowSec: Math.floor(Date.now() / 1000),
  });
  if (!mark) return { ok: false, reason: 'no agent record yet' };
  const file = unreadSidecarPath(cfg.statePath);
  if (!file) return { ok: false, reason: 'claudeWt.statePath has no directory' };
  const ids = sameTitleSessionIds(state.slots, id);
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* первый раз или битый — с нуля */ }
  const next = appendUnreadRequest(prev, { at: Date.now(), ids, ...mark });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next));
  fs.renameSync(tmp, file);
  return { ok: true, ids, requested: true, ...mark };
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
  markSessionSeen,
  // Экспортирован ради test/http-port-agreement.test.js: тест зовёт запись
  // файла напрямую, минуя claudeWtTick — тому нужен живой перебор окон.
  publishWindows,
};
export { removeWindowsFile } from './windows-file.js';
