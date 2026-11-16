/**
 * Кнопки окон WezTerm на панели задач: зелёная полоса, пока агент работает,
 * жёлтая с миганием, пока ждёт ответа, — как wt рисует сам по OSC 9;4; и
 * ровный оранжевый без полосы на законченном ходе, пока окно не смотрели, —
 * как wt на звонке. «Смотрели» — окно выходило вперёд (focusedAt демона) или
 * человек отпустил сессию Shift+кликом в ccfzf-picker (`dismiss()`, команда
 * `claude-session-seen`): эта отметка живёт здесь, в памяти службы, потому что
 * подсветку держит этот процесс, а не демон.
 * Почему это делает служба, а не терминал, — в src/claude-wt/taskbar-helpers.js.
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
  TBPF, taskbarLook, isWeztermPath, planTaskbar, resetOps, dismissedSeen, pruneDismissed,
} from '../claude-wt/taskbar-helpers.js';

// Вопрос агента должен загореться быстро: wt рисует его сразу, а HA-экспорт
// с его 15 с для этого слишком медленный.
const TASKBAR_INTERVAL_MS = 2500;

function startTaskbarState({
  winMan, log, intervalMs = TASKBAR_INTERVAL_MS,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval,
}) {
  const off = { tick() {}, dismiss() {}, undismiss() {}, stop() {} };
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
  // sessionId → секунда, когда человек отпустил подсветку мимо фокуса.
  let dismissed = new Map();
  let lastError = '';

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

  function tick() {
    try {
      const { windows, present } = weztermWindows();
      if (!windows.length && !applied.size) return;
      const agents = windows.length ? winMan.claudeWtWindowAgents(windows) : [];
      dismissed = pruneDismissed(dismissed, agents);
      const seen = a => Boolean(a.agentSeen) || dismissedSeen(dismissed.get(a.sessionId), a.agentUpdated);
      const wanted = new Map(agents.map(a => [a.id, taskbarLook(a.agentState, seen(a))]));
      const { ops, next } = planTaskbar(applied, wanted, present);
      apply(ops);
      applied = next;
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

  /**
   * Человек отпустил сессию мимо фокуса — погасить её кнопку сейчас, не
   * дожидаясь тика. Отметка сгорает сама, как только хук напишет новое.
   */
  function dismiss(sessionId) {
    if (!sessionId) return;
    dismissed.set(sessionId, Math.floor(Date.now() / 1000));
    tick();
  }

  /** Обратное: сессию вернули в непрочитанное — отметка больше не держит. */
  function undismiss(sessionId) {
    if (!dismissed.delete(sessionId)) return;
    tick();
  }

  return {
    tick,
    dismiss,
    undismiss,
    stop() {
      clearIntervalFn(timer);
      try {
        apply(resetOps([...applied.keys()]));
      } catch (e) {
        report(e);
      }
      applied = new Map();
    },
  };
}

export { startTaskbarState, TASKBAR_INTERVAL_MS };
