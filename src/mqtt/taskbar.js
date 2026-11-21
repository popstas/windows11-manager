/**
 * Кнопки окон WezTerm на панели задач: зелёная полоса, пока агент работает,
 * жёлтая с миганием, пока ждёт ответа, — как wt рисует сам по OSC 9;4; и
 * ровный оранжевый без полосы на законченном ходе, пока окно не смотрели, —
 * как wt на звонке. «Смотрели» — окно выходило вперёд (focusedAt демона).
 * Ход закончен, а фоновая команда агента идёт (`shell` из дампа ccfzf) —
 * зелёная полоса на 2% поверх того же правила мигания.
 * Отметки человека из ccfzf-picker — `dismiss()` (Mark seen, команда
 * `claude-session-seen`) гасит, `markUnread()` (Mark unread,
 * `claude-session-unread`) зажигает — живут здесь, в памяти службы, потому что
 * подсветку держит этот процесс, а не демон.
 * Почему это делает служба, а не терминал, — в src/claude-wt/taskbar-helpers.js.
 *
 * Мигание жёлтой полосой перед остыванием кеша промпта (`cacheWarn()`, команда
 * `claude-cache-warn`) — слой поверх этого вида, а не второй хозяин полосы:
 * кадр «выкл» и конец мигания возвращают полосу из `applied`. Набор сессий
 * присылает ccfzf-picker целиком, сроки по `cacheAt` считает служба сама.
 * Свой таймер на BLINK_MS заводится, только пока мигает хотя бы одно окно.
 * Фокус окна и «Mark seen» снимают мигание до следующей метки кеша.
 *
 * Про бюджет опроса (AGENTS.md, «claude-wt polling budget»). Таймер раз в
 * TASKBAR_INTERVAL_MS зовёт только getVisibleWindowIds() (~1-3 мс). Путь к exe
 * читается один раз на hwnd (getWindowById), getWindows() не зовётся вовсе,
 * номер рабочего стола тоже. Сеть (индекс сессий и state.json с V:) трогается,
 * только когда на экране есть окна WezTerm, и только файлы их сессий: пока
 * человек сидит в wt, таймер стоит почти ничего.
 *
 * Сброс — на старте и на stop(). Трей гасит службу через kill, и stop() тогда
 * не зовётся: закраска, оставшаяся от прежнего процесса, снимается при
 * следующем старте.
 */
import {
  TBPF, taskbarLook, isWeztermPath, planTaskbar, resetOps, markHolds, pruneMarks,
  BLINK_MS, cacheWarnDue, blinkBar, cacheWarnKey, parseCacheWarn, newTurnSince,
} from '../claude-wt/taskbar-helpers.js';

// Вопрос агента должен загореться быстро: wt рисует его сразу, а HA-экспорт
// с его 15 с для этого слишком медленный.
const TASKBAR_INTERVAL_MS = 2500;

function startTaskbarState({
  winMan, log, intervalMs = TASKBAR_INTERVAL_MS,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval,
  blinkMs = BLINK_MS, nowSec = () => Math.floor(Date.now() / 1000),
}) {
  const off = { tick() {}, dismiss() {}, markUnread() {}, cacheWarn() {}, stop() {} };
  if (typeof winMan?.hasTaskbarControl !== 'function') return off;
  if (!winMan.hasTaskbarControl()) {
    log('taskbar: в аддоне node-window-manager нет setTaskbarProgress/flashWindow — '
      + 'кнопки окон WezTerm не подсвечиваются (пересоберите vendor/node-window-manager)', 'warn');
    return off;
  }

  // hwnd → объект окна WezTerm или null (не WezTerm). Вердикт один на всю жизнь
  // hwnd: Windows переиспользует хэндлы, поэтому пропавший забывается.
  const verdicts = new Map();
  let applied = new Map();
  // sessionId → {kind: 'seen'|'unread', at} — отметка человека из пикера.
  let marks = new Map();
  let lastError = '';
  // Мигание перед остыванием кеша: набор от пикера, снятые фокусом или
  // «Mark seen» пары (id, cacheAt), окна сессий с последнего тика и те, что
  // мигают сейчас (hwnd → sessionId).
  let warnSec = 0;
  let warns = new Map();
  let warnDismissed = new Set();
  let bySession = new Map();
  let blinking = new Map();
  let blinkTimer = null;
  let blinkOn = false;

  function weztermWindows() {
    const ids = winMan.getVisibleWindowIds();
    const present = new Set(ids);
    for (const id of [...verdicts.keys()]) if (!present.has(id)) verdicts.delete(id);
    const windows = [];
    for (const id of ids) {
      if (!verdicts.has(id)) {
        const w = winMan.getWindowById(id);
        verdicts.set(id, w && isWeztermPath(w.path) ? w : null);
      }
      const w = verdicts.get(id);
      if (w) windows.push({ id, title: w.getTitle() });
    }
    return { windows, present };
  }

  function apply(ops) {
    // Окно, которое и так впереди, не зажигается: ровная подсветка (в отличие
    // от прежнего FLASHW_TIMERNOFG) встала бы и на нём и держалась бы до
    // следующего перехода на окно. Человек смотрит на него — это и есть
    // просмотр. Активное окно спрашивается только здесь, на редком включении.
    let fg = null;
    for (const op of ops) {
      winMan.setTaskbarProgress(op.id, TBPF[op.state], op.value);
      let flash = op.flash;
      if (flash === 'on') {
        if (fg === null) fg = winMan.getActiveWindowId?.() ?? 0;
        if (fg === op.id) flash = 'skip (foreground)';
        else winMan.flashWindow(op.id, true);
      } else if (flash === 'off') {
        winMan.flashWindow(op.id, false);
      }
      log(`taskbar: ${op.id} ${op.state}${flash ? ` flash ${flash}` : ''}`);
    }
  }

  // Ошибка повторялась бы каждые 2,5 с: в журнал — только новая.
  function report(e) {
    if (e.message === lastError) return;
    lastError = e.message;
    log(`taskbar: ${e.message}`, 'warn');
  }

  function restoreBar(id) {
    const bar = blinkBar(applied.get(id), false);
    winMan.setTaskbarProgress(id, TBPF[bar.state], bar.value);
  }

  function stopBlinkTimer() {
    if (blinkTimer === null) return;
    clearIntervalFn(blinkTimer);
    blinkTimer = null;
  }

  // Кадр мигания. Окно, которое впереди, снимает мигание: человек смотрит на
  // него — это и есть «увидел». Передний hwnd — один вызов на кадр.
  // Обработчик таймера ловит ошибку на месте: необработанное исключение в
  // нём уронило бы всю службу (у src/index.js нет uncaughtException).
  function blinkFrame() {
    try {
      blinkOn = !blinkOn;
      const fg = winMan.getActiveWindowId?.() ?? 0;
      for (const [id, sessionId] of [...blinking]) {
        if (fg === id) {
          warnDismissed.add(cacheWarnKey(sessionId, warns.get(sessionId)?.cacheAt));
          blinking.delete(id);
          restoreBar(id);
          log(`taskbar: ${id} cache warn off (foreground)`);
          continue;
        }
        const bar = blinkBar(applied.get(id), blinkOn);
        winMan.setTaskbarProgress(id, TBPF[bar.state], bar.value);
      }
      if (!blinking.size) stopBlinkTimer();
    } catch (e) {
      report(e);
    }
  }

  // Кто должен мигать сейчас — по набору пикера и состоянию окон с тика.
  function updateBlink() {
    const due = new Map();
    for (const [sessionId, warn] of warns) {
      const w = bySession.get(sessionId);
      const key = cacheWarnKey(sessionId, warn.cacheAt);
      if (!w || warnDismissed.has(key)) continue;
      // Новый ход запоминается насовсем для этой метки: через минуту хук
      // переведёт сессию в idle, а idle по `updated` от старого хода не
      // отличить — и старый набор зажёг бы мигание на свежем кеше.
      if (newTurnSince(warn.cacheAt, w.agent)) {
        warnDismissed.add(key);
        continue;
      }
      if (cacheWarnDue(warn, warnSec, nowSec(), w.agent)) due.set(w.id, sessionId);
    }
    for (const id of blinking.keys()) {
      if (due.has(id)) continue;
      restoreBar(id);
      log(`taskbar: ${id} cache warn off`);
    }
    const started = [...due.keys()].filter(id => !blinking.has(id));
    blinking = due;
    for (const id of started) log(`taskbar: ${id} cache warn on`);
    if (!blinking.size) {
      stopBlinkTimer();
      return;
    }
    if (blinkTimer === null) {
      blinkOn = false;
      blinkTimer = setIntervalFn(blinkFrame, blinkMs);
      blinkTimer?.unref?.();
      blinkFrame();
    }
  }

  function tick() {
    try {
      const { windows, present } = weztermWindows();
      if (!windows.length && !applied.size) {
        bySession = new Map();
        updateBlink();
        return;
      }
      const agents = windows.length ? winMan.claudeWtWindowAgents(windows) : [];
      marks = pruneMarks(marks, agents);
      const markOf = a => (markHolds(marks.get(a.sessionId), a.agentUpdated) ? marks.get(a.sessionId).kind : null);
      const wanted = new Map(agents.map(a => [a.id, taskbarLook(a.agentState, Boolean(a.agentSeen), markOf(a), a.shell === true)]));
      const { ops, next } = planTaskbar(applied, wanted, present);
      apply(ops);
      applied = next;
      bySession = new Map(agents.map(a => [a.sessionId, {
        id: a.id, agent: { agentState: a.agentState, agentUpdated: a.agentUpdated },
      }]));
      updateBlink();
      lastError = '';
    } catch (e) {
      report(e);
    }
  }

  try {
    apply(resetOps(weztermWindows().windows.map(w => w.id)));
  } catch (e) {
    report(e);
  }
  const timer = setIntervalFn(tick, intervalMs);
  timer?.unref?.();

  function mark(sessionId, kind) {
    if (!sessionId) return;
    marks.set(sessionId, { kind, at: Math.floor(Date.now() / 1000) });
    tick();
  }

  /**
   * Mark seen: погасить кнопку сессии сейчас, не дожидаясь тика, в любом
   * состоянии. Отметка сгорает сама, как только хук напишет новое.
   */
  function dismiss(sessionId) {
    // Только идущее мигание: Shift+клик гасит оранжевый конец хода через
    // минуту после него, и отменять этим предупреждение на 50-й минуте
    // значило бы молча выключить его у большинства сессий.
    const warn = warns.get(sessionId);
    if (warn && [...blinking.values()].includes(sessionId)) {
      warnDismissed.add(cacheWarnKey(sessionId, warn.cacheAt));
    }
    mark(sessionId, 'seen');
  }

  /** Mark unread: зажечь кнопку, даже у просмотренной сессии в review и idle. */
  function markUnread(sessionId) {
    mark(sessionId, 'unread');
  }

  /**
   * Набор от ccfzf-picker: `{warnMin, sessions: [{id, cacheAt}]}`. Заменяет
   * прежний целиком — сессия, которой в наборе нет, мигать перестаёт. Снятые
   * пары, которых в наборе больше нет, забываются: иначе карта росла бы всю
   * жизнь службы. Возвращает число сессий в наборе.
   */
  function cacheWarn(body) {
    const parsed = parseCacheWarn(body);
    warnSec = parsed.warnSec;
    warns = parsed.warns;
    const keys = new Set([...warns].map(([id, w]) => cacheWarnKey(id, w.cacheAt)));
    warnDismissed = new Set([...warnDismissed].filter(k => keys.has(k)));
    tick();
    return warns.size;
  }

  return {
    tick,
    dismiss,
    markUnread,
    cacheWarn,
    stop() {
      clearIntervalFn(timer);
      stopBlinkTimer();
      // Мигающее окно в `applied` может и не лежать (просмотренный review без
      // полосы) — сброс берёт оба списка, иначе жёлтая осталась бы висеть.
      const lit = new Set([...applied.keys(), ...blinking.keys()]);
      blinking = new Map();
      try {
        apply(resetOps([...lit]));
      } catch (e) {
        report(e);
      }
      applied = new Map();
    },
  };
}

export { startTaskbarState, TASKBAR_INTERVAL_MS };
