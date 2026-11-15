/**
 * Кнопки окон WezTerm на панели задач: зелёная полоса, пока агент работает,
 * жёлтая с миганием, пока ждёт ответа, — как wt рисует сам по OSC 9;4.
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
import { TBPF, taskbarLook, isWeztermPath, planTaskbar, resetOps } from '../claude-wt/taskbar-helpers.js';

// Вопрос агента должен загореться быстро: wt рисует его сразу, а HA-экспорт
// с его 15 с для этого слишком медленный.
const TASKBAR_INTERVAL_MS = 2500;

function startTaskbarState({
  winMan, log, intervalMs = TASKBAR_INTERVAL_MS,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval,
}) {
  const off = { tick() {}, stop() {} };
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
    for (const op of ops) {
      winMan.setTaskbarProgress(op.id, TBPF[op.state], op.value);
      if (op.flash) winMan.flashWindow(op.id, op.flash === 'on');
      log(`taskbar: ${op.id} ${op.state}${op.flash ? ` flash ${op.flash}` : ''}`);
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
      const wanted = new Map(agents.map(a => [a.id, taskbarLook(a.agentState)]));
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

  return {
    tick,
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
