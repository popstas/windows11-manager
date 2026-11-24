/**
 * Иконки окон claude: окно сессии — иконка её проекта или профиля, окно head —
 * та же иконка проекта и значок head в углу кнопки на панели задач (режим
 * `windowIcons.headMode: badge`, по умолчанию) либо значок head вместо иконки
 * (`icon`). Что какой иконке положено — src/claude-wt/window-icons-helpers.js.
 * Иконку ставит WM_SETICON по hwnd окнам и wt, и WezTerm (проба 15.11: держится
 * в обоих, панель задач и Alt+Tab её показывают); значок —
 * ITaskbarList3::SetOverlayIcon, виден только на кнопке панели задач и только
 * при включённых в Windows значках на кнопках.
 *
 * Иконку держит этот процесс: HICON живёт, пока жива служба. Поэтому после
 * перезапуска службы иконки ставятся всем окнам заново (applied пуст), а на
 * stop() снимаются. Значок explorer копирует себе и держит сам — он
 * переживает убитую службу, поэтому на первом полном проходе значок снимается
 * со всех окон терминала, которым он не положен. И наоборот: перезапуск
 * explorer значки стирает — его видно по смене hwnd панели задач
 * (`getTaskbarWindow()`, один FindWindow на тик), и значки ставятся заново
 * сразу и ещё раз на следующем полном проходе (кнопки explorer создаёт не
 * мгновенно).
 *
 * Про бюджет опроса (AGENTS.md). Раз в ICONS_INTERVAL_MS — getVisibleWindowIds(),
 * getTaskbarWindow() и путь к exe один раз на hwnd. Сеть (индекс сессий,
 * список меток head) трогается, только когда изменился набор окон терминала,
 * их заголовки, настройки иконок или панель задач, и раз в ICONS_REFRESH_MS —
 * чтобы заметить новую метку head. Настройки из окна настроек применяются без
 * перезапуска: конфиг перечитывается по mtime, и его смена меняет отпечаток.
 *
 * Решённое (sessionId → абсолютный путь, '' — без иконки) служба кладёт в
 * window-icons.json рядом с файлом состояния: файл окон для пикера пишет
 * демон, а роль окна (метки head) знает только служба. У head там главная
 * иконка окна: в режиме badge — иконка проекта, в режиме icon — значок head
 * (`publishedIcons`). Пишется, только когда карта изменилась;
 * выключенные иконки — пустая карта.
 *
 * Явное, заданное из claude-wt CLI (`store`, src/claude-wt/session-icons.js),
 * ложится поверх `iconFor`: явная иконка важнее значка head в режиме icon и
 * иконки проекта, явный значок — значка head и правил `badges` (решение Стаса,
 * вариант A). Версия хранилища входит в отпечаток, так что правка встаёт на
 * ближайшем тике; маршрут вдобавок зовёт `tick()` сам и спрашивает
 * `statusOf`, встало ли.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT, BUILTIN_HEAD_ICON, iconFor, resolveIconPath, iconsSidecarPath, publishedIcons, headsDirFor, planIcons,
  badPatterns,
} from '../claude-wt/window-icons-helpers.js';
import { writeFileAtomic } from '../commands/write-file-atomic.js';

const ICONS_INTERVAL_MS = 3000;
const ICONS_REFRESH_MS = 15000;
// Значок окна неизвестен (оставлен прошлым процессом или стёрт explorer):
// planIcons видит «было не то» и ставит или снимает его.
const UNKNOWN = '\0unknown';

/**
 * Окна терминалов на экране: `() => {windows: [{id, title}], present}`, где
 * `present` — все видимые hwnd. Путь к exe читается один раз на hwnd
 * (getWindowById), пропавший hwnd забывается: Windows переиспользует хэндлы.
 * Кеш вердиктов свой у каждого вызова — им пользуется и служба прятания
 * кнопок (taskbar-hide.js).
 */
function terminalWindowsOf(winMan) {
  const verdicts = new Map();
  return function terminalWindows() {
    const ids = winMan.getVisibleWindowIds();
    const present = new Set(ids);
    for (const id of [...verdicts.keys()]) if (!present.has(id)) verdicts.delete(id);
    const windows = [];
    for (const id of ids) {
      if (!verdicts.has(id)) {
        const w = winMan.getWindowById(id);
        verdicts.set(id, w && winMan.isTerminalWindow(w) ? w : null);
      }
      const w = verdicts.get(id);
      if (w) windows.push({ id, title: w.getTitle() });
    }
    return { windows, present };
  };
}

function writeIconsSidecar(cfg, icons) {
  const file = iconsSidecarPath(cfg.statePath);
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, JSON.stringify({ icons }));
}

function startWindowIcons({
  winMan, log, intervalMs = ICONS_INTERVAL_MS, refreshMs = ICONS_REFRESH_MS, repoRoot = REPO_ROOT,
  now = () => Date.now(), setIntervalFn = setInterval, clearIntervalFn = clearInterval,
  publishIcons = writeIconsSidecar, store = null,
}) {
  const off = {
    tick() {}, stop() {}, resync() {}, statusOf: () => ({ applied: false, reason: 'no icon service' }),
  };
  if (typeof winMan?.hasWindowIconControl !== 'function') return off;
  if (!winMan.hasWindowIconControl()) {
    log('window icons: в аддоне node-window-manager нет setWindowIcon — иконки окон не ставятся '
      + '(пересоберите vendor/node-window-manager)', 'warn');
    return off;
  }

  const canOverlay = typeof winMan.hasOverlayIconControl === 'function' && winMan.hasOverlayIconControl();
  if (!canOverlay) {
    log('window icons: в аддоне node-window-manager нет setOverlayIcon — значок head ставится вместо иконки '
      + '(пересоберите vendor/node-window-manager)', 'warn');
  }

  const terminalWindows = terminalWindowsOf(winMan);
  // hwnd → {icon?, overlay?}: что поставили мы.
  let applied = new Map();
  let lastPrint = '';
  let lastFull = 0;
  const failed = new Set();
  // Кривые регэкспы из badges, о которых уже предупредили.
  const badNamed = new Set();
  // Путь значка head: у него подпись `head`, у значков проекта — имя файла.
  let headPath = '';
  let lastError = '';
  let lastPublished = null;
  // С последнего полного прохода — для statusOf.
  let enabled = false;
  let windowOf = new Map();
  // Значки окнам терминала надо сверить: на старте — снять оставленные
  // прошлым процессом, после перезапуска explorer — поставить заново. Число —
  // сколько полных проходов подряд считать значки неизвестными.
  let overlayResync = canOverlay ? 1 : 0;
  let tray = canOverlay ? winMan.getTaskbarWindow() : 0;

  function publish(cfg, icons) {
    const text = JSON.stringify(icons);
    if (text === lastPublished) return;
    publishIcons(cfg, icons);
    lastPublished = text;
  }

  // Подпись значка для экранного диктора.
  function overlayDescription(iconPath) {
    if (iconPath === headPath) return 'head';
    return path.win32.basename(iconPath).replace(/\.[^.]+$/, '');
  }

  function call(op) {
    const file = op.path ? resolveIconPath(op.path, repoRoot) : '';
    if (op.kind === 'overlay') return winMan.setOverlayIcon(op.id, file, file ? overlayDescription(op.path) : '');
    return winMan.setWindowIcon(op.id, file);
  }

  // Неудавшееся не считается поставленным: следующий полный проход повторит.
  function apply(ops, next) {
    for (const op of ops) {
      const ok = call(op);
      const what = op.kind === 'overlay' ? 'значок' : 'иконку';
      if (!ok && op.path) {
        const entry = next?.get(op.id);
        if (entry) {
          delete entry[op.kind];
          if (!Object.keys(entry).length) next.delete(op.id);
        }
        if (!failed.has(`${op.kind}|${op.path}`)) {
          failed.add(`${op.kind}|${op.path}`);
          log(`window icons: не удалось поставить ${what} ${op.path} окну ${op.id} (нет файла или окна)`, 'warn');
        }
      } else if (ok) {
        const label = op.kind === 'overlay' ? `значок ${op.path || 'снят'}` : (op.path || 'снята');
        log(`window icons: ${op.id} ${label}`);
      }
    }
  }

  function resetAll() {
    const ops = [];
    for (const [id, prev] of applied) {
      for (const kind of ['icon', 'overlay']) if (prev[kind]) ops.push({ id, kind, path: '' });
    }
    apply(ops);
    applied = new Map();
  }

  function report(e) {
    if (e.message === lastError) return;
    lastError = e.message;
    log(`window icons: ${e.message}`, 'warn');
  }

  // Explorer перезапущен — значки стёрты вместе с кнопками.
  function watchTaskbar() {
    if (!canOverlay) return;
    const now = winMan.getTaskbarWindow();
    if (now === tray) return;
    tray = now;
    if (!now) return;
    log('window icons: панель задач пересоздана (перезапуск explorer) — значки ставятся заново');
    overlayResync = 2;
    lastPrint = '';
  }

  function markOverlaysUnknown(windows) {
    for (const { id } of windows) {
      const prev = applied.get(id) ?? {};
      applied.set(id, { ...prev, overlay: UNKNOWN });
    }
  }

  function tick() {
    try {
      const raw = winMan.getClaudeWtConfig();
      // Без SetOverlayIcon в аддоне значок head некуда класть на кнопку —
      // тогда он встаёт вместо иконки, как раньше.
      const cfg = canOverlay ? raw : { ...raw, windowIcons: { ...raw.windowIcons, headMode: 'icon' } };
      if (!cfg.enabled || !cfg.windowIcons?.enabled) {
        enabled = false;
        if (applied.size) resetAll();
        lastPrint = '';
        publish(cfg, {});
        return;
      }
      headPath = cfg.windowIcons?.head || BUILTIN_HEAD_ICON;
      for (const m of badPatterns(cfg)) {
        if (badNamed.has(m)) continue;
        badNamed.add(m);
        log(`window icons: кривой регэксп в badges: ${m}`, 'warn');
      }
      enabled = true;
      watchTaskbar();
      const { windows, present } = terminalWindows();
      const print = JSON.stringify([
        windows, cfg.windowIcons, cfg.projects.map(p => [p.cwd, p.icon ?? '', p.profile ?? '', p.badges ?? []]),
        store?.version ?? 0,
      ]);
      if (print === lastPrint && now() - lastFull < refreshMs) return;
      lastPrint = print;
      lastFull = now();
      if (overlayResync > 0) {
        markOverlaysUnknown(windows);
        overlayResync -= 1;
      }
      const sessions = windows.length ? winMan.claudeWtWindowSessions(windows) : [];
      const heads = sessions.length ? winMan.claudeWtHeadIds(headsDirFor(cfg)) : new Set();
      // Без SetOverlayIcon значкам проекта (badges) класть некуда — слот пуст.
      const wanted = new Map(sessions.map(s => {
        const auto = iconFor(s, { heads, cfg });
        const e = (s.sessionId && store?.get(s.sessionId)) || {};
        const want = { icon: e.icon || auto.icon, overlay: e.badge || auto.overlay };
        return [s.id, canOverlay ? want : { ...want, overlay: '' }];
      }));
      windowOf = new Map(sessions.filter(s => s.sessionId).map(s => [s.sessionId, s.id]));
      const { ops, next } = planIcons(applied, wanted, present);
      apply(ops, next);
      applied = next;
      // После расстановки и мимо общего catch: сбой записи хранилища не
      // должен останавливать автоматические иконки всех окон.
      try {
        store?.touch([...windowOf.keys()]);
      } catch (e) {
        report(e);
      }
      publish(cfg, publishedIcons(sessions, wanted, repoRoot));
      lastError = '';
    } catch (e) {
      report(e);
    }
  }

  tick();
  const timer = setIntervalFn(tick, intervalMs);
  timer?.unref?.();

  // Встало ли заданное (или снятое) сессии на её окне — по последнему проходу.
  function statusOf(sessionId, kind) {
    if (!enabled) return { applied: false, reason: 'icons disabled' };
    if (kind === 'badge' && !canOverlay) return { applied: false, reason: 'no overlay support' };
    const id = windowOf.get(sessionId);
    if (id === undefined) return { applied: false, reason: 'no window' };
    const target = store?.get(sessionId)?.[kind];
    if (!target) return { applied: true };
    const slot = kind === 'badge' ? 'overlay' : 'icon';
    if (applied.get(id)?.[slot] === target) return { applied: true };
    return { applied: false, reason: 'not applied (see tray log)' };
  }

  /**
   * Кнопкам этих окон вернули место на панели (addTab, taskbar-hide.js):
   * кнопка новая, значка на ней нет. Иконка окна (WM_SETICON) живёт на самом
   * окне и переживает addTab — сверяется только значок, на ближайшем тике.
   */
  function resync(ids) {
    if (!canOverlay || !enabled) return;
    markOverlaysUnknown(ids.map(id => ({ id })));
    lastPrint = '';
  }

  return {
    tick,
    statusOf,
    resync,
    stop() {
      clearIntervalFn(timer);
      try {
        resetAll();
      } catch (e) {
        report(e);
      }
    },
  };
}

export { startWindowIcons, terminalWindowsOf, ICONS_INTERVAL_MS, ICONS_REFRESH_MS };
