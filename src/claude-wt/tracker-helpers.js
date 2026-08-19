/** Pure helper functions for the claude-wt tracker. No external I/O. */
import { upsertSlot } from './state-helpers.js';
import { clampBoundsToMonitors } from '../geometry.js';
import { isMinimized as isMinimizedBounds } from '../windows-helpers.js';

/**
 * Follow one window's title across ticks. A title becomes "stable" only after
 * it has held for stableTicks: entering a session flips the title two or three
 * times in a row (shell -> claude -> session name), and reacting to the
 * intermediate values would bind the window to the wrong thing.
 */
function trackTitle(before, win, stableTicks) {
  const sameTitle = before?.title === win.title;
  const titleTicks = sameTitle ? before.titleTicks + 1 : 1;
  const settled = titleTicks >= stableTicks;
  return {
    id: win.id,
    title: win.title,
    titleTicks,
    stableTitle: settled ? win.title : (before?.stableTitle ?? null),
    sessionId: before?.sessionId ?? null,
    bounds: win.bounds,
    pendingMove: before?.pendingMove ?? null,
    // Имя терминала едет дальше вместе с окном: `publishWindows` берёт его из
    // `nextWindows`, а те собираются здесь. Без этой строки поле терялось
    // ровно тут — снимок его называл, файл отдавал пустую строку, и читатель
    // молча оставлял прежний глиф. Ловится такое только на живой машине:
    // пустое поле от «терминал незнакомый» не отличить.
    app: win.app ?? before?.app ?? '',
  };
}

/**
 * Title → hwnd that may bind for it.
 *
 * When several windows show the same title, only the largest hwnd wins: Windows
 * tends to hand out increasing handles, so that is the newest window. The rest
 * stay unbound so two twins cannot fight over one slot.
 */
function titleWinnerIds(windows) {
  const winners = new Map();
  for (const w of windows) {
    if (!w.title) continue;
    const prev = winners.get(w.title);
    if (prev === undefined || w.id > prev) winners.set(w.title, w.id);
  }
  return winners;
}

/**
 * Title -> session, first from the ccfzf dump, then from our own title history.
 * The fallback keeps the module working while V: is unmounted or the dump is
 * stale, at the cost of only knowing sessions we have already seen.
 *
 * Several slots claiming the same title: pick the one seen most recently.
 * `ambiguous` stays true so callers can tell a tie happened, but binding no
 * longer refuses — the pick is good enough.
 */
function resolveSession(title, sessionIndex, slots) {
  if (!title) return null;
  const fromDump = sessionIndex?.[title];
  if (fromDump) return { id: fromDump.id, cwd: fromDump.cwd, ambiguous: fromDump.ambiguous };
  const matches = Object.entries(slots ?? {}).filter(([, slot]) => slot.titles?.includes(title));
  if (!matches.length) return null;
  matches.sort((a, b) => (b[1].lastSeen ?? 0) - (a[1].lastSeen ?? 0));
  const [id, slot] = matches[0];
  return { id, cwd: slot.cwd ?? '', ambiguous: matches.length > 1 };
}

const DEFAULTS = { stableTicks: 2, moveTimeoutMs: 5000, minimizedX: -10000 };

/**
 * Свёрнуто ли окно — то же правило, что у расстановки, фокуса и раскладки.
 *
 * Обёртка, а не копия: само сравнение живёт в `windows-helpers.js`, здесь
 * только развёртка окна в границы, потому что тик и файл окон держат окно
 * целиком, а те трое — одни границы. Второй экземпляр сравнения разошёлся бы
 * с первым молча — тик продолжал бы пропускать окно при расстановке, а
 * читатель на той стороне показывал бы его обычным; ровно так и сломался
 * фокус, когда в windows.js стоял свой порог.
 *
 * Окно без границ читается как обычное: «не знаю» дороже ошибиться в сторону
 * гашения — погашенная строка у открытого окна заметнее, чем негашёная у
 * свёрнутого.
 */
function isMinimized(win, minimizedX = DEFAULTS.minimizedX) {
  return isMinimizedBounds(win?.bounds, minimizedX);
}

// A window never comes back from setBounds() at exactly the size it was asked
// for on a scaled monitor: node-window-manager multiplies by the scale factor
// and floors going in, divides and floors coming out, so 602 px at 125% is read
// back as 601. Exact comparison would mean the move never "arrives" (the guard
// waits out its whole timeout), and the rounded-down rectangle then overwrites
// the remembered one — a pixel lost per restore, forever. Same 2px tolerance
// placement.js already uses in isBoundsMatch.
const BOUNDS_TOLERANCE = 2;

function boundsEqual(a, b) {
  if (!a || !b) return false;
  return ['x', 'y', 'width', 'height'].every(k => Math.abs(a[k] - b[k]) < BOUNDS_TOLERANCE);
}

/**
 * One tick of the tracker: pure, so the whole behaviour table is testable
 * without Windows. Returns the next state plus what the daemon must do:
 * `actions` are windows to move, `bindings` are windows whose virtual desktop
 * number should be read once (that call spawns VirtualDesktop11.exe, so it
 * must never happen on every tick).
 *
 * `monitors` (plain `[{ bounds }]` data, so this stays pure) is optional but
 * should be passed by the daemon: the remembered rectangle is clamped onto the
 * currently connected monitors *here*, so the bounds we ask for and the bounds
 * the pendingMove guard waits for are the same rectangle. Clamping in the
 * caller instead would leave the guard waiting for a position the window can
 * never reach, and the timeout would then record the clamped position as if
 * the user had chosen it — destroying the original.
 */
function step({ prevWindows = [], windows = [], sessionIndex = {}, state, now, options = {}, monitors = [] }) {
  const { stableTicks, moveTimeoutMs, minimizedX } = { ...DEFAULTS, ...options };
  // `now` stays in ms because pendingMove.since/moveTimeoutMs need that resolution;
  // everything persisted to state (lastSeen, updated) is stamped in epoch seconds.
  const nowSec = Math.floor(now / 1000);
  const prev = new Map(prevWindows.map(w => [w.id, w]));
  const winners = titleWinnerIds(windows);
  const slots = { ...state.slots };
  const nextWindows = [];
  const actions = [];
  const bindings = [];
  const lastLayout = [];

  for (const win of windows) {
    const before = prev.get(win.id);
    const tracked = trackTitle(before, win, stableTicks);
    const minimized = isMinimized(win, minimizedX);
    const titleChanged = tracked.stableTitle !== (before?.stableTitle ?? null);
    // Twin titles: only the largest hwnd may own the session. An older window
    // that was already bound must release — otherwise both would rewrite one slot.
    const titleKey = tracked.stableTitle ?? tracked.title;
    const losesToNewer = Boolean(titleKey)
      && winners.has(titleKey)
      && winners.get(titleKey) !== win.id;
    if (losesToNewer) tracked.sessionId = null;

    // Сессия в окне меняется и без смены заголовка: человек вышел из claude и
    // запустил его снова в том же терминале — id новый, заголовок прежний.
    // Привязка же делалась ровно один раз, в момент смены заголовка, и окно
    // навсегда оставалось на прежнем id. Замерено 2026-08-03: строка
    // `ExpertizeMe` пять часов стояла на сводке мёртвой сессии, а работающая в
    // этом же окне не появлялась в списке вовсе — своего слота у неё не было.
    //
    // Судья тут только дамп. Пока он этого заголовка не знает (новая сессия ещё
    // не попала в него), молчим: иначе окно теряло бы слот на каждое отставание
    // дампа. Свёрнутое окно и незавершённый перенос пропускаем — у первого
    // нечего записать в слот, у второго на привязке держится сторож pendingMove.
    const dumpSays = sessionIndex?.[tracked.stableTitle];
    const rebinds = Boolean(tracked.sessionId) && !losesToNewer && !titleChanged
      && !minimized && !tracked.pendingMove
      && Boolean(dumpSays) && dumpSays.id !== tracked.sessionId;
    // Виртуальный стол у окна прежний — оно никуда не уезжало. Спрашивать его
    // заново значило бы спавнить VirtualDesktop11.exe на каждую перепривязку.
    const releasedDesktop = rebinds ? (slots[tracked.sessionId]?.desktop ?? null) : null;
    if (rebinds) tracked.sessionId = null;

    if (losesToNewer) {
      // skip binding
    } else if (titleChanged) {
      const resolved = resolveSession(tracked.stableTitle, sessionIndex, slots);
      tracked.sessionId = resolved ? resolved.id : null;
      if (tracked.sessionId) {
        const known = slots[tracked.sessionId];
        const common = { title: tracked.stableTitle, cwd: resolved.cwd, now: nowSec };
        if (known?.bounds) {
          slots[tracked.sessionId] = upsertSlot(known, common);
          const target = clampBoundsToMonitors(known.bounds, monitors);
          // Уже стоит там, где нужно — не дёргаем окно. Иначе перезапуск демона
          // (пустой prevWindows) тащил бы каждое открытое окно, включая протаскивание
          // между виртуальными столами через action.desktop.
          if (!boundsEqual(win.bounds, target)) {
            actions.push({ windowId: win.id, bounds: target, desktop: known.desktop });
            tracked.pendingMove = { bounds: target, since: now };
          }
          // Слот с bounds, но без номера рабочего стола (одна неудачная попытка
          // прочитать его, или файл состояния старого формата) иначе никогда бы
          // не получил второго шанса: bindings пушились только при создании слота.
          if (known.desktop == null && !minimized) {
            bindings.push({ windowId: win.id, sessionId: tracked.sessionId });
          }
        } else if (!minimized) {
          // Слот заводится только вместе с позицией: слот без bounds бесполезен
          // и был бы всё равно выброшен normalizeState при следующем чтении.
          slots[tracked.sessionId] = upsertSlot(known, { ...common, bounds: win.bounds });
          bindings.push({ windowId: win.id, sessionId: tracked.sessionId });
        }
      }
    } else if (tracked.sessionId) {
      const arrived = Boolean(tracked.pendingMove) && boundsEqual(win.bounds, tracked.pendingMove.bounds);
      const timedOut = Boolean(tracked.pendingMove) && !arrived && now - tracked.pendingMove.since > moveTimeoutMs;
      const settled = !tracked.pendingMove || arrived || timedOut;
      if (settled) {
        tracked.pendingMove = null;
        // Истёк таймаут — окно так и не доехало. Позиция, на которой оно сейчас
        // стоит, выбрана не пользователем, а неудавшимся переносом: записать её
        // значило бы затереть запомненную. Пропускаем этот тик, со следующего
        // запись возобновляется как обычно.
        if (!minimized && !timedOut) {
          // A session first seen while minimized reaches here with no slot yet
          // (the titleChanged branch above deliberately skipped creating one).
          // Carry the title along so the slot isn't created identity-less, and
          // bind exactly once — the same moment the titleChanged branch would
          // have bound it, had the window not been minimized at the time.
          const known = slots[tracked.sessionId];
          // Окно стоит ровно там, куда запомненная позиция ложится на текущие
          // мониторы. Если её пришлось зажать (монитор отключён), записывать
          // зажатое значение нельзя: исходные координаты пропали бы навсегда и
          // после возврата монитора окно осталось бы на главном экране. Любая
          // другая позиция — выбор пользователя, её и запоминаем.
          const atRemembered = Boolean(known?.bounds)
            && boundsEqual(win.bounds, clampBoundsToMonitors(known.bounds, monitors));
          slots[tracked.sessionId] = upsertSlot(known, {
            title: tracked.stableTitle,
            ...(atRemembered ? {} : { bounds: win.bounds }),
            now: nowSec,
          });
          if (!known) bindings.push({ windowId: win.id, sessionId: tracked.sessionId });
        }
      }
    } else if (tracked.stableTitle && !minimized) {
      // Заголовок устоялся раньше, чем сессия попала в дамп ccfzf: дамп
      // переписывается периодически, а привязка пробовалась ровно один раз —
      // в момент смены заголовка. Без второй попытки такое окно осталось бы
      // без слота навсегда, пока заголовок не сменится ещё раз. Стоило это
      // на живом прогоне двух сессий из шести.
      const resolved = resolveSession(tracked.stableTitle, sessionIndex, slots);
      if (resolved) {
        tracked.sessionId = resolved.id;
        const known = slots[resolved.id];
        // Окно не двигаем: это не вход в сессию, а догнавший дамп. Окно стоит
        // здесь давно, и его позиция — выбор пользователя, а не то, что нужно
        // исправлять.
        slots[resolved.id] = upsertSlot(known, {
          title: tracked.stableTitle, cwd: resolved.cwd, bounds: win.bounds,
          desktop: releasedDesktop, now: nowSec,
        });
        // Спрашиваем номер стола по итоговому слоту, а не по тому, был ли он до
        // нас: у перепривязки слот новый, но стол уже известен от предыдущей
        // сессии этого же окна.
        if (slots[resolved.id].desktop == null) {
          bindings.push({ windowId: win.id, sessionId: resolved.id });
        }
      }
    }

    // Два окна могут разрешиться в один слот через историю заголовков; planRestore
    // читает lastLayout один-к-одному и запустил бы такую сессию дважды.
    if (tracked.sessionId && !lastLayout.includes(tracked.sessionId)) lastLayout.push(tracked.sessionId);
    nextWindows.push(tracked);
  }

  return {
    nextWindows,
    actions,
    bindings,
    nextState: { ...state, slots, lastLayout, updated: nowSec },
  };
}

export { trackTitle, titleWinnerIds, resolveSession, step, boundsEqual, isMinimized };
