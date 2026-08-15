/** Pure helper functions for the claude-wt daemon. No external I/O. */

import { normalizeProjects } from './project-helpers.js';
import { upsertSlot } from './state-helpers.js';
import { normalizeTerminals } from './terminal-helpers.js';

const CLAUDE_WT_DEFAULTS = {
  enabled: true,
  interval: 1000,
  stableTicks: 2,
  sessionsFile: '',
  statePath: '',
  // Опубликованный файл окон: у какой сессии открыто окно, на каком столе и на
  // какой машине. Читает его ccfzf на стороне агента, чтобы дописать пометку в
  // свой список сессий. Пусто — не писать: добавка необязательная, и молчание
  // здесь законный режим работы, а не поломка.
  windowsFile: '',
  // Каталог, куда хук wt-progress.sh на стороне агента пишет <id>.state.json.
  // Пусто — состояний нет и кружок в пикере остаётся двухцветным.
  progressDir: '',
  desktop: true,
  debug: false,
  profile: '',
  // Какой терминал открывать, когда просьба его не назвала.
  terminal: 'wt',
  // Реестр терминалов: имя → чем открывать. Умолчания — в terminal-helpers.js.
  terminals: {},
  // Чьи окна считать окнами терминала. Пусто — встроенный список.
  terminalExecutables: [],
  projects: [],
  // Умолчание терминала выражено один раз, реестром (`terminal` →
  // `TERMINAL_DEFAULTS`); здесь его нет намеренно — назвавший `command` сам
  // конфиг тем самым помечает себя старым (см. isLegacyLaunch), и реестр в
  // нём перестаёт действовать.
  launch: { args: [] },
  // Fresh session in a project folder (project hotkeys). Placeholders: {cwd}, {name}.
  launchNew: { args: [] },
  restore: { auto: false, windowTimeoutMs: 30000, launchDelayMs: 2000, settleMs: 500 },
  snapshots: { enabled: true, path: '', debounceMs: 60000, keep: 20 },
};

/** Deep-ish merge: launch / launchNew / restore / snapshots merged key by key. */
function mergeClaudeWtConfig(raw) {
  const cfg = raw ?? {};
  return {
    ...CLAUDE_WT_DEFAULTS,
    ...cfg,
    terminals: normalizeTerminals(cfg.terminals),
    projects: normalizeProjects(cfg.projects ?? CLAUDE_WT_DEFAULTS.projects),
    launch: { ...CLAUDE_WT_DEFAULTS.launch, args: [...CLAUDE_WT_DEFAULTS.launch.args], ...(cfg.launch ?? {}) },
    launchNew: {
      ...CLAUDE_WT_DEFAULTS.launchNew,
      args: [...CLAUDE_WT_DEFAULTS.launchNew.args],
      ...(cfg.launchNew ?? {}),
    },
    restore: { ...CLAUDE_WT_DEFAULTS.restore, ...(cfg.restore ?? {}) },
    snapshots: { ...CLAUDE_WT_DEFAULTS.snapshots, ...(cfg.snapshots ?? {}) },
    terminalExecutables: Array.isArray(cfg.terminalExecutables) && cfg.terminalExecutables.length
      ? cfg.terminalExecutables.map(String)
      : [...TERMINAL_EXECUTABLES],
  };
}

// Терминалы, чьи окна трекер опознаёт по умолчанию. Список, а не регулярка по
// одному имени: терминалов теперь два, и оба обязаны опознаваться.
const TERMINAL_EXECUTABLES = ['WindowsTerminal.exe', 'wezterm-gui.exe'];

/**
 * Окно терминала — по имени исполняемого файла.
 *
 * Список, а не регулярка по одному имени: терминалов теперь два, и оба обязаны
 * опознаваться. Не опознанное окно трекер терминалом не считает вовсе — сессия
 * откроется, но пропадёт из списка: ни пометки окна, ни фокуса, ни привязки.
 * Сверяется имя целиком, поэтому `WindowsTerminalHelper.exe` мимо.
 */
function isTerminalPath(path, executables = TERMINAL_EXECUTABLES) {
  const name = String(path ?? '').split(/[\\/]/).pop() ?? '';
  if (!name) return false;
  return executables.some(exe => exe.toLowerCase() === name.toLowerCase());
}

/**
 * Virtual desktop moves that step() cannot express.
 *
 * `desktop` rides along on a move action, and step() suppresses the action when
 * the window already sits at its remembered position — so a window that is in
 * the right place but on the wrong desktop would never come back. This fills
 * that hole for windows that were bound to a session on *this* tick and got no
 * action of their own.
 *
 * A binding only counts as entering a session when the window had a settled
 * title before it. On a daemon restart every open window goes from "no settled
 * title yet" straight to its session on the second tick, and hauling them all
 * across virtual desktops is not what restarting a position tracker should do —
 * checking merely that the window existed last tick is not enough, because on
 * a restart it did.
 */
function desktopOnlyActions({ prevWindows = [], nextWindows = [], slots = {}, actions = [] }) {
  const prev = new Map(prevWindows.map(w => [w.id, w]));
  const moving = new Set(actions.map(a => a.windowId));
  const out = [];
  for (const w of nextWindows) {
    if (!w.sessionId || moving.has(w.id)) continue;
    const was = prev.get(w.id);
    if (!was || !was.stableTitle || was.sessionId === w.sessionId) continue;
    const desktop = slots[w.sessionId]?.desktop;
    if (desktop == null) continue;
    out.push({ windowId: w.id, desktop });
  }
  return out;
}

/**
 * What the state file is actually for, minus the clock. `updated` ticks every
 * second, so comparing whole states would defeat the write deduplication it was
 * written for and put a file write on every tick.
 */
function layoutFingerprint(state) {
  return JSON.stringify({ slots: state?.slots ?? {}, lastLayout: state?.lastLayout ?? [] });
}

/**
 * Сессия, чьё окно только что вышло на передний план.
 *
 * Считается только переход. Пока окно остаётся впереди, отметка не обновляется:
 * иначе состояние переписывалось бы на диск каждую секунду всё время, что окно
 * висит активным — а `layoutFingerprint()` включает слоты целиком, так что
 * каждая такая отметка означала бы запись файла.
 *
 * Фокус читается в демоне, а не в менеджере сессий, потому что переключиться на
 * окно можно и руками — Alt+Tab, клик по таскбару, — и такой просмотр ничем не
 * отличается от перехода через пикер.
 */
function focusedSessionIds({ activeWindowId, prevActiveWindowId, windows = [], slots = {} }) {
  if (!activeWindowId || activeWindowId === prevActiveWindowId) return [];
  const sessionId = windows.find(w => w.id === activeWindowId)?.sessionId;
  if (!sessionId) return [];
  return sameTitleSessionIds(slots, sessionId);
}

/**
 * Окно, у которого пора перечитать номер виртуального стола.
 *
 * Стол слот получал ровно один раз, на привязке — чтение спавнит
 * VirtualDesktop11.exe, и в горячем цикле ему не место, — а дальше навязывался
 * окну при каждой смене заголовка и перепривязке (см. desktopOnlyActions) и
 * ещё и переезжал в слот следующей сессии того же окна. Позицию демон при этом
 * переучивает каждый тик. Из-за этой несимметричности ручной перенос окна на
 * другой стол не значил ничего: 2026-08-12 сессия `home` возвращалась на стол
 * «work» через минуту после того, как её уносили на «home», — номер в слоте
 * помнил единственную привязку, случившуюся когда-то на чужом столе.
 *
 * Переход фокуса — и редкое событие (одно чтение на переход, не на тик), и
 * точный момент, когда человек показал, где окну быть: чтобы дать окну фокус,
 * его сначала надо увидеть.
 *
 * Близнецам по заголовку номер не раздаётся, в отличие от отметки «просмотрено»:
 * два окна с одним названием законно живут на разных столах (у `ExpertizeMe`
 * так и есть), и чужой номер затёр бы их собственный.
 */
function desktopRelearnTarget({ activeWindowId, prevActiveWindowId, windows = [], slots = {} }) {
  if (!activeWindowId || activeWindowId === prevActiveWindowId) return null;
  const win = windows.find(w => w.id === activeWindowId);
  if (!win?.sessionId) return null;
  // Стол ещё не читали — это работа bindings, и второе чтение на том же тике
  // ничего не добавит.
  if (slots?.[win.sessionId]?.desktop == null) return null;
  return { windowId: win.id, sessionId: win.sessionId };
}

/**
 * Сколько после старта демона переносы не считаются поводом сменить стол.
 *
 * На перезапуске prevWindows пуст, и каждое открытое окно за пару тиков
 * привязывается заново — часть при этом уезжает на свой стол. Уводить за ними
 * вид означало бы, что деплой или перезапуск трея молча выбрасывает человека на
 * чужой рабочий стол. Десяти секунд хватает на всю стартовую волну: заголовок
 * устаканивается за stableTicks (2 тика по секунде).
 */
const FOLLOW_GRACE_MS = 10000;

/**
 * Стол, на который нужно уйти вслед за уехавшим окном.
 *
 * Окно новой сессии открывается на том столе, где человек сейчас, а слот может
 * помнить другой — и демон честно уносит окно туда. Со стороны человека это
 * выглядит как исчезновение: окно открыли, оно мигнуло и пропало.
 *
 * Идём только за окном, которое в этот момент было передним, то есть за тем, с
 * которым человек работает. Фоновое окно, уносимое на свой стол, вида не
 * трогает — иначе чужая перепривязка выдёргивала бы человека с его стола.
 * Переднее окно по определению стоит на видимом столе, поэтому переключение
 * туда, где оно уже было, — безобидный холостой вызов.
 */
function desktopFollowTarget({ moves = [], activeWindowId, startedAt = 0, nowMs = 0 }) {
  if (!activeWindowId) return null;
  if (startedAt && nowMs - startedAt < FOLLOW_GRACE_MS) return null;
  const mine = moves.filter(m => m.windowId === activeWindowId && m.desktop);
  return mine.length ? mine[mine.length - 1].desktop : null;
}

/**
 * Ответ GetWindowDesktopNumber → номер стола, как его хранит слот (1-based).
 *
 * Неудачное чтение обязано остаться неудачным: vd11Command отдаёт undefined на
 * невыпарсенный вывод и null на stderr, и `Number(null) + 1` — это 1, готовый
 * молча уехать в слот вместо настоящего номера.
 */
function relearnedDesktop(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num + 1 : null;
}

/**
 * Сколько держится пометка «следующий фокус не считать». Пикер — окно поверх, и
 * на Esc фокус возвращается тому окну, из которого пришли: без этого только что
 * поставленная пометка гасла бы через секунду после закрытия списка. Пятнадцать
 * секунд хватает, чтобы дочитать список и закрыть его; дольше держать нельзя —
 * запись переживёт настоящий, осознанный переход в окно.
 */
const FOCUS_SUPPRESS_MS = 15000;

/**
 * Слоты, которые делят с этим первый заголовок.
 *
 * Одна и та же работа, переоткрытая заново, оставляет слот на каждый id, но
 * окно с таким названием на экране одно. Всё, что делает фокус или пометка,
 * должно относиться ко всем близнецам сразу — иначе в списке горит один, а
 * гаснет другой.
 */
function sameTitleSessionIds(slots, sessionId) {
  const title = slots?.[sessionId]?.titles?.[0];
  if (!title) return [sessionId];
  const sameTitle = Object.keys(slots).filter(id => slots[id]?.titles?.[0] === title);
  return sameTitle.includes(sessionId) ? sameTitle : [sessionId, ...sameTitle];
}

/**
 * Какую метку фокуса писать, чтобы сессия снова стала непрочитанной.
 *
 * Секунда до записи агента, а не ноль: `seenSinceUpdate()` сравнивает эти два
 * числа и вернёт `false` в обоих случаях, но ноль выкидывает слот из порядка
 * `project-helpers.js`, по которому хоткей проекта выбирает последнюю сессию.
 * Пометка непрочитанным не должна перекладывать Ctrl+F11.
 */
function unreadFocusedAt(updated) {
  return updated > 0 ? updated - 1 : 0;
}

/** Поставить пометку «пропустить следующий фокус» на каждый id. */
function suppressFocus(marks, ids, nowMs) {
  const next = { ...marks };
  for (const id of ids) next[id] = nowMs + FOCUS_SUPPRESS_MS;
  return next;
}

/**
 * Отсеять из пойманного фокуса то, что только что пометили непрочитанным.
 *
 * Пометка одноразовая и сгорает при первом же переходе: второй раз подряд в то
 * же окно человек заходит уже осознанно, и это настоящий просмотр. Просроченные
 * записи выбрасываются здесь же — отдельной чистки нет, потому что эта функция
 * вызывается каждый тик.
 */
function applyFocusSuppression({ marks = {}, ids = [], nowMs }) {
  const nextMarks = {};
  for (const [id, until] of Object.entries(marks)) {
    if (until > nowMs && !ids.includes(id)) nextMarks[id] = until;
  }
  return {
    ids: ids.filter(id => !((marks[id] ?? 0) > nowMs)),
    marks: nextMarks,
  };
}

/**
 * Наложить отложенные пометки на слоты, которые тик уносит в liveState.
 *
 * Пометка, пришедшая посреди тика, иначе потерялась бы: она правит прежнюю
 * карту слотов, а тик заменяет её целиком своей — see markSessionUnread() и
 * claudeWtTick() в index.js. Id, которых в этой карте уже нет (сессия успела
 * пропасть из состояния), тихо пропускаются — метить нечего.
 */
function applyPendingUnread(slots, pending) {
  const ids = Object.keys(pending ?? {});
  if (!ids.length) return slots;
  const next = { ...slots };
  for (const id of ids) {
    if (!next[id]) continue;
    next[id] = upsertSlot(next[id], { focusedAt: pending[id] });
  }
  return next;
}

/** Settled titles of terminal windows that could not be attributed to a session. */
function unresolvedTitles(nextWindows) {
  return [...new Set(nextWindows.filter(w => w.stableTitle && !w.sessionId).map(w => w.stableTitle))];
}

// Минута молчания при тике раз в секунду — это не флуктуация, а поломка.
const TICK_SILENCE_MS = 60000;
// Столько демону дают на первый успешный тик после старта: maybeRestoreOnStart()
// и первый разбор дампа с сетевого диска занимают заметно больше одного тика.
const TICK_GRACE_MS = 60000;

function emptyTickStats() {
  return { lastTickAt: 0, tickFailures: 0, lastTickError: '' };
}

/**
 * Учёт одного тика.
 *
 * Отметка времени двигается только на успехе — то есть когда тик дошёл до
 * записи состояния. Упавший тик её не трогает: иначе демон, падающий каждую
 * секунду, выглядел бы здоровее всех.
 */
function recordTick(stats, { ok, error, nowMs }) {
  if (ok) return { lastTickAt: nowMs, tickFailures: 0, lastTickError: '' };
  return {
    lastTickAt: stats.lastTickAt,
    tickFailures: stats.tickFailures + 1,
    lastTickError: error || 'unknown error',
  };
}

/**
 * Здоров ли демон, по данным, которые он о себе отдаёт.
 *
 * Различает три беды, и это существенно: «интервал не заведён» лечится
 * перезапуском, «тиков не было ни одного» указывает на падение в первом же
 * проходе, «тики были, но давно» — на то, что что-то сломалось по дороге.
 */
function claudeWtHealth({ running, lastTickAt, startedAt, nowMs, silenceMs, graceMs }) {
  // Ноль, а не nowMs - startedAt: остановленный демон обнуляет startedAt, и
  // разница с началом эпохи выливалась в «последний тик 1785000000s назад».
  // Возраста у незапущенного демона нет, и сторож этот кусок строки опускает.
  if (!running) return { healthy: false, reason: 'not running', ageMs: 0 };
  if (!lastTickAt) {
    const ageMs = nowMs - startedAt;
    return ageMs < graceMs
      ? { healthy: true, reason: 'starting', ageMs }
      : { healthy: false, reason: 'no ticks', ageMs };
  }
  const ageMs = nowMs - lastTickAt;
  return ageMs > silenceMs
    ? { healthy: false, reason: 'stale', ageMs }
    : { healthy: true, reason: 'ok', ageMs };
}

/**
 * Отстал ли тик от текущего поколения демона.
 *
 * Сторож поднимает демона заново ровно тогда, когда тик вероятнее всего завис:
 * в `placeWindowByConfig()` или в `GetWindowDesktopNumber()`, который спавнит
 * exe. Обещание такого тика переживает `startClaudeWt()`, и, досчитавшись, оно
 * запишет дореcтартовый снимок поверх файла нового поколения, а его `.then`
 * отметит успешный тик в счётчиках нового — то есть хронически висящий тик
 * бесконечно обновлял бы `lastTickAt`, и сторож не сработал бы больше никогда.
 *
 * `tickGen === null` — тик, запущенный руками (CLI, тесты). Поколения у него
 * нет, отгораживать нечего.
 */
function isStaleTick(tickGen, currentGen) {
  return tickGen !== null && tickGen !== currentGen;
}

export {
  CLAUDE_WT_DEFAULTS,
  TICK_SILENCE_MS,
  TICK_GRACE_MS,
  FOCUS_SUPPRESS_MS,
  FOLLOW_GRACE_MS,
  isStaleTick,
  mergeClaudeWtConfig,
  TERMINAL_EXECUTABLES,
  isTerminalPath,
  desktopOnlyActions,
  desktopRelearnTarget,
  desktopFollowTarget,
  relearnedDesktop,
  layoutFingerprint,
  focusedSessionIds,
  sameTitleSessionIds,
  unreadFocusedAt,
  suppressFocus,
  applyFocusSuppression,
  applyPendingUnread,
  unresolvedTitles,
  emptyTickStats,
  recordTick,
  claudeWtHealth,
};
