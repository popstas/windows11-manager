/**
 * Прятание кнопок окон погашенных сессий с панели задач
 * (ITaskbarList::DeleteTab/AddTab). Набор sessionId присылает ccfzf-picker
 * целиком (`setSet`); поверх него — явные отметки `hide`/`show` из claude-wt
 * CLI (`store`, src/claude-wt/taskbar-hide-store.js). Сигнал человеку —
 * вопрос агента или непросмотренный итог — сильнее и набора, и отметки:
 * служба возвращает такую кнопку сама, не дожидаясь пикера (скрытый пикер
 * опрашивает с бэкоффом до 8 минут). Решения — src/claude-wt/taskbar-hide-helpers.js.
 *
 * Возвращать кнопки — обязанность службы. DeleteTab переживает вызвавший
 * процесс, а трей гасит службу через kill, и stop() может не случиться вовсе:
 * поэтому на старте addTab получают все окна терминалов. Журнал спрятанного не
 * нужен — addTab на показанной кнопке ничего не меняет, ни места, ни значка,
 * ни полосы (замер на nb, AGENTS.md). Набор от пикера протухает через
 * TASKBAR_HIDE_TTL_MS: больше бэкоффа скрытого пикера (8 мин) плюс его
 * heartbeat (5 мин). Явные отметки не протухают.
 *
 * Сама кнопка возвращается только с перезапуском explorer — его видно по
 * смене `getTaskbarWindow()`, и тогда спрятанные прячутся заново. Плюс
 * страховка раз в TASKBAR_REHIDE_MS на незамеренные события (сон, блокировка,
 * мониторы), которые hwnd панели могут и не сменить. DeleteTab идемпотентен.
 *
 * Вернувшаяся кнопка новая: значок head и полоса WezTerm на ней пропали, а
 * вызовы на спрятанной кнопке отвечают true и теряются. Поэтому вернувшиеся
 * окна уходят в `onShown` — служба передаёт их в `resync` window-icons.js и
 * taskbar.js.
 *
 * Про бюджет опроса (AGENTS.md). Таймер раз в intervalMs зовёт
 * getVisibleWindowIds() и getTaskbarWindow(), путь к exe — раз на hwnd.
 * Сеть (индекс сессий, state.json) — только когда есть набор, явные отметки
 * или спрятанные кнопки, а состояние агента — только окнам-кандидатам: тем,
 * что спрятаны или идут прятаться.
 */
import {
  parseHideSet, hasSignal, nextExplicit, wantedHidden, planTabs,
} from '../claude-wt/taskbar-hide-helpers.js';
import { terminalWindowsOf } from './window-icons.js';

const TASKBAR_HIDE_INTERVAL_MS = 3000;
const TASKBAR_HIDE_TTL_MS = 20 * 60 * 1000;
const TASKBAR_REHIDE_MS = 60 * 1000;
// Сколько пропавших из видимых спрятанных окон помнить.
const LOST_MAX = 64;

function startTaskbarHide({
  winMan, log, store, onShown = () => {},
  intervalMs = TASKBAR_HIDE_INTERVAL_MS, ttlMs = TASKBAR_HIDE_TTL_MS, rehideMs = TASKBAR_REHIDE_MS,
  now = () => Date.now(), setIntervalFn = setInterval, clearIntervalFn = clearInterval,
}) {
  const off = {
    tick() {},
    setSet: () => 0,
    statusOf: () => ({ applied: false, reason: 'no taskbar tab support' }),
    showAll: () => 0,
    stop() {},
  };
  if (typeof winMan?.hasTabControl !== 'function') return off;
  if (!winMan.hasTabControl()) {
    log('taskbar hide: в аддоне node-window-manager нет deleteTab/addTab — кнопки не прячутся '
      + '(пересоберите vendor/node-window-manager)', 'warn');
    return off;
  }

  const terminalWindows = terminalWindowsOf(winMan);
  const taskbarWindow = () => (typeof winMan.getTaskbarWindow === 'function' ? winMan.getTaskbarWindow() : 0);
  // hwnd → sessionId: кнопки, которые спрятали мы.
  const hidden = new Map();
  // Спрятанные окна, пропавшие из видимых (SW_HIDE и прочее): кнопка у них
  // по-прежнему удалена (замер на nb, AGENTS.md). Вернутся видимыми — addTab.
  const lost = new Map();
  // Окна терминалов прошлого тика: новое среди них получает addTab.
  let known = new Set();
  // Набор от пикера и время его прихода.
  let set = new Set();
  let setAt = 0;
  let tray = taskbarWindow();
  let trayChanged = false;
  let lastRehide = now();
  // С последнего полного прохода — для statusOf.
  let windowOf = new Map();
  let signaled = new Set();
  let lastError = '';
  const failed = new Set();

  function report(e) {
    if (e.message === lastError) return;
    lastError = e.message;
    log(`taskbar hide: ${e.message}`, 'warn');
  }

  // Неудавшийся addTab оставляет окно в `hidden`: следующий тик повторит.
  // Окну, которое мы не прятали, addTab ничего не меняет (замер на nb) — ни
  // строки, ни `onShown`.
  function show(ids) {
    const back = [];
    for (const id of ids) {
      const sessionId = hidden.get(id) ?? lost.get(id);
      const ours = hidden.has(id) || lost.has(id);
      if (!winMan.addTab(id)) continue;
      hidden.delete(id);
      lost.delete(id);
      if (!ours) continue;
      log(`taskbar hide: ${id} ${sessionId} возвращена`);
      back.push(id);
    }
    if (back.length) onShown(back);
    return back.length;
  }

  // Невидимого окна (SW_HIDE) в `present` нет, а кнопка у него остаётся
  // удалённой, — поэтому «нет среди видимых» не значит «закрылось» (решение
  // ревью Task 4, поверх формулировки плана «hwnd нет среди окон — окно
  // закрылось»). Окно терминала, появившееся среди видимых, получает addTab до
  // плана: показанной кнопке это ничего не делает, а всё ещё нужное спрячется
  // обычным планом на том же тике.
  function returnAppeared(termIds) {
    const appeared = [...termIds].filter(id => !known.has(id));
    known = termIds;
    if (!appeared.length) return;
    // Своё, не вернувшееся, — снова в `hidden`: план повторит addTab.
    const ours = appeared.filter(id => lost.has(id));
    show(appeared);
    for (const id of ours) {
      if (!lost.has(id)) continue;
      hidden.set(id, lost.get(id));
      lost.delete(id);
    }
  }

  // Неудавшийся deleteTab в `hidden` не попадает: следующий тик повторит.
  function hide(ids, sessionOf) {
    for (const id of ids) {
      if (!winMan.deleteTab(id)) {
        if (!failed.has(id)) {
          failed.add(id);
          log(`taskbar hide: не удалось спрятать кнопку окна ${id}`, 'warn');
        }
        continue;
      }
      failed.delete(id);
      // Перепрятывание уже спрятанного строки не пишет: иначе страховка
      // давала бы строку на окно каждую минуту.
      if (!hidden.has(id)) log(`taskbar hide: ${id} ${sessionOf.get(id)} спрятана`);
      hidden.set(id, sessionOf.get(id) ?? hidden.get(id));
    }
  }

  function liveSet() {
    if (set.size && now() - setAt > ttlMs) {
      set = new Set();
      log('taskbar hide: набор протух');
    }
    return set;
  }

  // Explorer перезапущен — кнопки вернулись сами. Ноль (панели нет) только
  // запоминается: прятать в пустоту незачем, сработает следующая смена.
  function watchTaskbar() {
    const t = taskbarWindow();
    if (t === tray) return;
    tray = t;
    if (!t) return;
    trayChanged = true;
    if (hidden.size) log('taskbar hide: панель задач пересоздана (перезапуск explorer) — кнопки прячутся заново');
  }

  // Явные отметки: закрылось окно — снять, появилось окно сессии — запомнить.
  // «Закрылось» — окна нет вовсе (getWindowById → null), а не «нет среди
  // видимых»: невидимое окно ещё вернётся (решение ревью Task 4). Спрашиваются
  // только отмеченные hwnd, которых нет в `present`, — обычно ни одного.
  function trackExplicit(present, bySession) {
    for (const id of store.ids()) {
      const e = store.get(id);
      if (!e) continue;
      if (Number.isFinite(e.hwnd)) {
        if (!present.has(e.hwnd) && !winMan.getWindowById(e.hwnd)) store.set(id, null);
      } else if (bySession.has(id)) {
        store.patch(id, { hwnd: bySession.get(id) });
      }
    }
  }

  // Новый ход сессии снимает её `hide`. Неизвестное состояние паузой не
  // считается: иначе собственный ход агента снял бы отметку.
  function advanceExplicit(agents) {
    for (const a of agents) {
      if (!a.agentState) continue;
      const e = store.get(a.sessionId);
      if (e?.mode !== 'hide') continue;
      const next = nextExplicit(e, a.agentState);
      if (next === null) store.set(a.sessionId, null);
      else if (next.sawIdle && !e.sawIdle) store.patch(a.sessionId, { sawIdle: true });
    }
  }

  function tick() {
    try {
      watchTaskbar();
      const { windows, present } = terminalWindows();
      for (const id of [...hidden.keys()]) {
        if (present.has(id)) continue;
        lost.set(id, hidden.get(id));
        hidden.delete(id);
      }
      // Закрытые окна в `lost` копились бы всю жизнь службы.
      while (lost.size > LOST_MAX) lost.delete(lost.keys().next().value);
      const termIds = new Set(windows.map(w => w.id));
      returnAppeared(termIds);
      if (!hidden.size) lastRehide = now();
      const current = liveSet();
      if (!current.size && !store.ids().length && !hidden.size) {
        trayChanged = false;
        windowOf = new Map();
        signaled = new Set();
        return;
      }
      const sessions = windows.length ? winMan.claudeWtWindowSessions(windows) : [];
      const bySession = new Map();
      for (const s of sessions) if (s.sessionId && !bySession.has(s.sessionId)) bySession.set(s.sessionId, s.id);
      trackExplicit(present, bySession);
      const candidates = new Set(sessions
        .filter(s => current.has(s.sessionId) || store.get(s.sessionId)?.mode === 'hide' || hidden.has(s.id))
        .map(s => s.id));
      const agents = candidates.size ? winMan.claudeWtWindowAgents(windows.filter(w => candidates.has(w.id))) : [];
      advanceExplicit(agents);
      const agentOf = new Map(agents.map(a => [a.sessionId, a]));
      const signalOf = id => hasSignal(agentOf.get(id));
      const wanted = wantedHidden({ sessions, set: current, explicitOf: id => store.get(id), signalOf });
      const reapply = trayChanged || (hidden.size > 0 && now() - lastRehide >= rehideMs);
      if (reapply) {
        trayChanged = false;
        lastRehide = now();
      }
      const { remove, add } = planTabs(new Set(hidden.keys()), wanted, termIds, reapply);
      // Панели нет (explorer лежит) — прятать некуда: ждать её возвращения.
      if (tray || typeof winMan.getTaskbarWindow !== 'function') hide(remove, new Map(sessions.map(s => [s.id, s.sessionId])));
      show(add);
      windowOf = bySession;
      signaled = new Set(sessions.filter(s => signalOf(s.sessionId)).map(s => s.sessionId));
      lastError = '';
    } catch (e) {
      report(e);
    }
  }

  try {
    known = new Set(terminalWindows().windows.map(w => w.id));
    for (const id of known) winMan.addTab(id);
  } catch (e) {
    report(e);
  }
  tick();
  const timer = setIntervalFn(tick, intervalMs);
  timer?.unref?.();

  /** Набор от пикера `{sessions: [...]}` целиком заменяет прежний. Число сессий в нём. */
  function setSet(body) {
    set = parseHideSet(body);
    setAt = now();
    tick();
    return set.size;
  }

  // Встала ли явная отметка сессии на её окне — по последнему проходу.
  function statusOf(sessionId) {
    const e = store.get(sessionId);
    // Без отметки решает пикер: снятие встало всегда.
    if (!e) return { applied: true };
    const id = windowOf.get(sessionId);
    if (id === undefined) return { applied: false, reason: 'no window' };
    if (e.mode === 'show') return hidden.has(id) ? { applied: false, reason: 'not applied (see tray log)' } : { applied: true };
    if (hidden.has(id)) return { applied: true };
    if (signaled.has(sessionId)) return { applied: false, reason: 'session needs attention' };
    return { applied: false, reason: 'not applied (see tray log)' };
  }

  // Спрятанное плюс все окна терминалов на экране: кнопку могли потерять и мимо
  // `hidden` (окно пропадало из видимых). Показанной кнопке addTab — no-op.
  function returnAll() {
    return show([...new Set([...hidden.keys(), ...terminalWindows().windows.map(w => w.id)])]);
  }

  /** Пункт трея «Show all taskbar buttons»: сбросить отметки и набор, вернуть всё. */
  function showAll() {
    store.clearAll();
    set = new Set();
    setAt = now();
    try {
      return returnAll();
    } catch (e) {
      report(e);
      return 0;
    }
  }

  return {
    tick,
    setSet,
    statusOf,
    showAll,
    stop() {
      clearIntervalFn(timer);
      try {
        for (const id of new Set([...hidden.keys(), ...terminalWindows().windows.map(w => w.id)])) winMan.addTab(id);
      } catch (e) {
        report(e);
      }
      hidden.clear();
      lost.clear();
    },
  };
}

export { startTaskbarHide, TASKBAR_HIDE_INTERVAL_MS, TASKBAR_HIDE_TTL_MS, TASKBAR_REHIDE_MS };
