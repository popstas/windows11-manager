/**
 * Иконки окон claude: окно head — корона, окно сессии — иконка её проекта или
 * профиля. Что какой иконке положено — src/claude-wt/window-icons-helpers.js.
 * Ставит WM_SETICON по hwnd окнам и wt, и WezTerm (проба 15.11: держится в
 * обоих, панель задач и Alt+Tab её показывают).
 *
 * Иконку держит этот процесс: HICON живёт, пока жива служба. Поэтому после
 * перезапуска службы иконки ставятся всем окнам заново (applied пуст), а на
 * stop() снимаются.
 *
 * Про бюджет опроса (AGENTS.md). Раз в ICONS_INTERVAL_MS — getVisibleWindowIds()
 * и путь к exe один раз на hwnd. Сеть (индекс сессий, список меток head)
 * трогается, только когда изменился набор окон терминала, их заголовки или
 * настройки иконок, и раз в ICONS_REFRESH_MS — чтобы заметить новую метку head.
 * Настройки из окна настроек применяются без перезапуска: конфиг
 * перечитывается по mtime, и его смена меняет отпечаток.
 *
 * Решённое (sessionId → абсолютный путь, '' — без иконки) служба кладёт в
 * window-icons.json рядом с файлом состояния: файл окон для пикера пишет
 * демон, а роль окна (метки head) знает только служба. Пишется, только когда
 * карта изменилась; выключенные иконки — пустая карта.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  iconFor, resolveIconPath, iconsSidecarPath, publishedIcons, headsDirFor, planIcons,
} from '../claude-wt/window-icons-helpers.js';
import { writeFileAtomic } from '../commands/write-file-atomic.js';

const ICONS_INTERVAL_MS = 3000;
const ICONS_REFRESH_MS = 15000;
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]+$/, '');

function writeIconsSidecar(cfg, icons) {
  const file = iconsSidecarPath(cfg.statePath);
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, JSON.stringify({ icons }));
}

function startWindowIcons({
  winMan, log, intervalMs = ICONS_INTERVAL_MS, refreshMs = ICONS_REFRESH_MS, repoRoot = REPO_ROOT,
  now = () => Date.now(), setIntervalFn = setInterval, clearIntervalFn = clearInterval,
  publishIcons = writeIconsSidecar,
}) {
  const off = { tick() {}, stop() {} };
  if (typeof winMan?.hasWindowIconControl !== 'function') return off;
  if (!winMan.hasWindowIconControl()) {
    log('window icons: в аддоне node-window-manager нет setWindowIcon — иконки окон не ставятся '
      + '(пересоберите vendor/node-window-manager)', 'warn');
    return off;
  }

  const verdicts = new Map();
  let applied = new Map();
  let lastPrint = '';
  let lastFull = 0;
  const failed = new Set();
  let lastError = '';
  let lastPublished = null;

  function publish(cfg, icons) {
    const text = JSON.stringify(icons);
    if (text === lastPublished) return;
    publishIcons(cfg, icons);
    lastPublished = text;
  }

  function terminalWindows() {
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
  }

  function apply(ops) {
    for (const op of ops) {
      const ok = winMan.setWindowIcon(op.id, op.path ? resolveIconPath(op.path, repoRoot) : '');
      if (!ok && op.path && !failed.has(op.path)) {
        failed.add(op.path);
        log(`window icons: не удалось поставить ${op.path} окну ${op.id} (нет файла или окна)`, 'warn');
      } else if (ok) {
        log(`window icons: ${op.id} ${op.path || 'снята'}`);
      }
    }
  }

  function resetAll() {
    apply([...applied.keys()].map(id => ({ id, path: '' })));
    applied = new Map();
  }

  function report(e) {
    if (e.message === lastError) return;
    lastError = e.message;
    log(`window icons: ${e.message}`, 'warn');
  }

  function tick() {
    try {
      const cfg = winMan.getClaudeWtConfig();
      if (!cfg.enabled || !cfg.windowIcons?.enabled) {
        if (applied.size) resetAll();
        lastPrint = '';
        publish(cfg, {});
        return;
      }
      const { windows, present } = terminalWindows();
      const print = JSON.stringify([windows, cfg.windowIcons, cfg.projects.map(p => [p.cwd, p.icon ?? '', p.profile ?? ''])]);
      if (print === lastPrint && now() - lastFull < refreshMs) return;
      lastPrint = print;
      lastFull = now();
      const sessions = windows.length ? winMan.claudeWtWindowSessions(windows) : [];
      const heads = sessions.length ? winMan.claudeWtHeadIds(headsDirFor(cfg)) : new Set();
      const wanted = new Map(sessions.map(s => [s.id, iconFor(s, { heads, cfg })]));
      const { ops, next } = planIcons(applied, wanted, present);
      apply(ops);
      applied = next;
      publish(cfg, publishedIcons(sessions, wanted, repoRoot));
      lastError = '';
    } catch (e) {
      report(e);
    }
  }

  tick();
  const timer = setIntervalFn(tick, intervalMs);
  timer?.unref?.();

  return {
    tick,
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

export { startWindowIcons, ICONS_INTERVAL_MS, ICONS_REFRESH_MS };
