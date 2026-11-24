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
 * поэтому на старте addTab получают все окна терминалов. Перед своим kill
 * («Stop service», «Exit») трей просит `release()` — кнопки возвращаются,
 * отметки остаются до следующего старта. Служба не отвечает вовсе — CLI
 * возвращает кнопки сам, `returnTerminalTabs`. Журнал спрятанного не
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
import { isMinimized } from '../windows-helpers.js';

const TASKBAR_HIDE_INTERVAL_MS = 3000;
const TASKBAR_HIDE_TTL_MS = 20 * 60 * 1000;
const TASKBAR_REHIDE_MS = 60 * 1000;
// Сколько тиков подряд прятать заново после смены панели задач: explorer
// создаёт кнопки через секунды после Shell_TrayWnd (живая проверка на nb), и
// одно перепрятывание на первом тике уходило в пустоту до страховки в 60 с.
// 4 тика по 3 с — около 10 с, как `overlayResync` в window-icons.js.
const TASKBAR_REHIDE_TICKS_AFTER_TRAY = 4;
// Сколько пропавших из видимых спрятанных окон помнить.
const LOST_MAX = 64;
// Сколько после постановки явной hide не-active чтение, записанное хуком до
// неё, считается устаревшим: кеш loadProgress 3 с плюс запаздывание хука на nb.
// Дальше простой засчитывается паузой как есть — иначе hide на давно
// простаивающей сессии пережила бы её следующий ход (хук до промпта молчит).
const TASKBAR_STALE_GRACE_MS = 10 * 1000;
// Свёрнутое окно из набора пикера прячется, только пробыв свёрнутым столько
// подряд (решение Стаса, 24.11: «прятать через минуту после сворачивания, а
// не сразу»). Явная hide и развёрнутое погашенное — сразу, спрятанное
// остаётся спрятанным.
const MINIMIZED_HIDE_DELAY_MS = 60 * 1000;

/**
 * addTab всем видимым окнам терминалов в обход службы — для CLI, когда служба
 * не отвечает (убита, не запущена). Отбор окон тот же, что у службы
 * (`terminalWindowsOf`); показанной кнопке addTab ничего не меняет. Сбой
 * одного окна не мешает остальным. `{supported, shown}` — сколько addTab прошло.
 */
function returnTerminalTabs(winMan) {
  if (typeof winMan?.hasTabControl !== 'function' || !winMan.hasTabControl()) return { supported: false, shown: 0 };
  let shown = 0;
  for (const { id } of terminalWindowsOf(winMan)().windows) {
    try {
      if (winMan.addTab(id)) shown += 1;
    } catch {
      // Следующее окно.
    }
  }
  return { supported: true, shown };
}

function startTaskbarHide({
  winMan, log, store, onShown = () => {}, isBlinking = () => false,
  intervalMs = TASKBAR_HIDE_INTERVAL_MS, ttlMs = TASKBAR_HIDE_TTL_MS, rehideMs = TASKBAR_REHIDE_MS,
  now = () => Date.now(), setIntervalFn = setInterval, clearIntervalFn = clearInterval,
}) {
  const off = {
    tick() {},
    setSet: () => 0,
    statusOf: () => ({ applied: false, reason: 'no taskbar tab support' }),
    showAll: () => 0,
    release: () => 0,
    isReleased: () => false,
    startedAt: now(),
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
  // Сколько тиков ещё прятать заново после смены панели.
  let trayRehide = 0;
  let lastRehide = now();
  // С последнего полного прохода — для statusOf.
  let windowOf = new Map();
  let signaled = new Set();
  let lastError = '';
  const failed = new Set();
  // hwnd → когда служба впервые увидела окно свёрнутым (подряд). Сворачивания
  // до старта службы она не видела — отсчёт идёт от первого взгляда.
  let minimizedSince = new Map();
  // Окна из набора, которые служба видела свёрнутыми на прошлой проверке.
  let wasMinimized = new Set();
  // hwnd → когда окно развернули. Набор пикера, пришедший раньше, считался
  // при свёрнутом окне — такое окно он не прячет, пока не придёт набор новее.
  const restoredAt = new Map();
  // После release() служба не прячет ничего до перезапуска: её вот-вот убьют.
  // Это видно и снаружи — statusOf, warn на набор, `released` в ответе
  // claude-taskbar-hide: иначе выключенное прятание выглядело бы исправным.
  let released = false;
  let releasedWarned = false;
  // Когда служба поднялась: release от CLI, запущенного раньше, — запоздалый
  // (claude-taskbar-release сверяет его `startedAt`).
  const startedAt = now();

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
    trayRehide = TASKBAR_REHIDE_TICKS_AFTER_TRAY;
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
  // считается: иначе собственный ход агента снял бы отметку. Не считается ею и
  // не-active, записанное хуком до постановки отметки, — но только первые
  // TASKBAR_STALE_GRACE_MS: hide через пару секунд после промпта читал review
  // прошлого хода (кеш loadProgress 3 с, запаздывание хука — живая проверка на
  // nb), а следующий тик видел active и снимал отметку собственным ходом агента.
  // Позже старое чтение — честный простой: сессия, спрятанная через минуты после
  // своего итога, до следующего промпта ничего не пишет, и без грации отметка
  // снялась бы ходом позже (финальное ревью, I3). `agentUpdated` — секунды,
  // `setAt` — мс.
  function advanceExplicit(agents) {
    for (const a of agents) {
      if (!a.agentState) continue;
      const e = store.get(a.sessionId);
      if (e?.mode !== 'hide') continue;
      const setAt = store.setAtOf?.(a.sessionId);
      const stale = Number.isFinite(setAt) && !((a.agentUpdated ?? 0) * 1000 > setAt)
        && now() - setAt < TASKBAR_STALE_GRACE_MS;
      if (a.agentState !== 'active' && stale) continue;
      const next = nextExplicit(e, a.agentState);
      if (next === null) store.set(a.sessionId, null);
      else if (next.sawIdle && !e.sawIdle) store.patch(a.sessionId, { sawIdle: true });
    }
  }

  // Свёрнутые окна, которые прячет только набор (явная hide — сразу и всегда):
  // - свёрнутое ждёт MINIMIZED_HIDE_DELAY_MS свёрнутым подряд (решение Стаса,
  //   24.11), уже спрятанное остаётся спрятанным;
  // - развёрнутое после свёрнутого — человек на него смотрит, а набор пикера
  //   считался при свёрнутом: не прячется (спрятанное возвращается), пока не
  //   придёт набор новее разворота, — тот решает заново (решение по ревью).
  // Свёрнутость (getBounds, без сети) спрашивается лишь у этих окон: кандидатов
  // из набора и спрятанных; отсчёт прочих забывается.
  function holdMinimized(wanted, sessions, termIds) {
    const sessionOf = new Map(sessions.map(s => [s.id, s.sessionId]));
    const nextSince = new Map();
    const nextMin = new Set();
    const t = now();
    for (const [id, at] of [...restoredAt]) if (at < setAt || !termIds.has(id)) restoredAt.delete(id);
    for (const id of [...wanted]) {
      if (store.get(sessionOf.get(id))?.mode === 'hide') continue;
      const w = terminalWindows.windowOf(id);
      if (!w) continue;
      if (isMinimized(w.getBounds())) {
        nextMin.add(id);
        restoredAt.delete(id);
        if (hidden.has(id)) continue;
        const since = minimizedSince.get(id) ?? t;
        nextSince.set(id, since);
        if (t - since < MINIMIZED_HIDE_DELAY_MS) wanted.delete(id);
        continue;
      }
      if (wasMinimized.has(id)) restoredAt.set(id, t);
      if (restoredAt.has(id)) wanted.delete(id);
    }
    minimizedSince = nextSince;
    wasMinimized = nextMin;
  }

  function tick() {
    if (released) return;
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
        trayRehide = 0;
        minimizedSince = new Map();
        wasMinimized = new Set();
        restoredAt.clear();
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
      // Мигание кеша (taskbar.js) — тоже сигнал: скрытый пикер узнал бы о нём
      // только через минуты бэкоффа, а мигать спрятанной кнопкой некуда.
      // Сеть не трогается — это память соседнего модуля.
      const blinkingSessions = new Set(sessions.filter(s => isBlinking(s.id)).map(s => s.sessionId));
      const signalOf = id => hasSignal(agentOf.get(id)) || blinkingSessions.has(id);
      const wanted = wantedHidden({ sessions, set: current, explicitOf: id => store.get(id), signalOf });
      holdMinimized(wanted, sessions, termIds);
      const reapply = trayRehide > 0 || (hidden.size > 0 && now() - lastRehide >= rehideMs);
      if (trayRehide > 0) trayRehide -= 1;
      if (reapply) lastRehide = now();
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
    if (released && !releasedWarned) {
      releasedWarned = true;
      log('taskbar hide: служба отпустила кнопки — набор не применяется до перезапуска', 'warn');
    }
    set = parseHideSet(body);
    setAt = now();
    tick();
    return set.size;
  }

  // Встала ли явная отметка сессии на её окне — по последнему проходу.
  function statusOf(sessionId) {
    if (released) return { applied: false, reason: 'released (restart the service)' };
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

  // Спрятанное первым, затем окна терминалов на экране; сбой одного addTab
  // (или чтения окон) не оставляет спрятанными остальные. Число вернувшихся
  // своих кнопок.
  function returnEverything() {
    let back = 0;
    const done = new Set();
    for (const id of [...hidden.keys()]) {
      done.add(id);
      try {
        if (winMan.addTab(id)) {
          hidden.delete(id);
          back += 1;
        }
      } catch (e) {
        report(e);
      }
    }
    let terms = [];
    try {
      terms = terminalWindows().windows.map(w => w.id);
    } catch (e) {
      report(e);
    }
    for (const id of terms) {
      if (done.has(id)) continue;
      try {
        winMan.addTab(id);
      } catch (e) {
        report(e);
      }
    }
    return back;
  }

  /**
   * Перед kill-ом из трея («Stop service», «Exit»): вернуть все кнопки, не
   * трогая ни отметок, ни набора, и больше не прятать — следующий старт
   * спрячет по отметкам заново. Звать только перед остановкой: служба после
   * этого до перезапуска не прячет ничего.
   */
  function release() {
    if (!released) clearIntervalFn(timer);
    released = true;
    const back = returnEverything();
    log(`taskbar hide: служба останавливается — возвращено кнопок: ${back}, отметки сохранены`);
    return back;
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
    release,
    isReleased: () => released,
    startedAt,
    stop() {
      if (!released) clearIntervalFn(timer);
      released = true;
      returnEverything();
      hidden.clear();
      lost.clear();
    },
  };
}

export {
  startTaskbarHide, returnTerminalTabs,
  TASKBAR_HIDE_INTERVAL_MS, TASKBAR_HIDE_TTL_MS, TASKBAR_REHIDE_MS, TASKBAR_REHIDE_TICKS_AFTER_TRAY,
  TASKBAR_STALE_GRACE_MS, MINIMIZED_HIDE_DELAY_MS,
};
