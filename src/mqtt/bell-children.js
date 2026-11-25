/**
 * Список окон дочерних сессий для звонка WezTerm (режим `no children`).
 *
 * Обработчик `bell` в wezterm.lua молчит у окна, чей ключ заголовка есть в
 * `%USERPROFILE%\.wezterm-bell-children` (формат и правило ключа —
 * src/claude-wt/bell-children-helpers.js). Этот файл пишет служба: у неё уже
 * есть окна терминалов (`terminalWindowsOf`, как у иконок и прятания кнопок) и
 * привязка окна к сессии (`claudeWtWindowSessions`), а в цикл демона чтение
 * сетевого каталога детей не пускает бюджет опроса (AGENTS.md).
 *
 * Дети — sessionId из каталога `children` на pc-virt (с Windows — рядом с
 * sessionsFile, читается только список файлов) и из местного реестра
 * `child-registry.js`: ребёнок `session-new` попадает туда до SMB и до
 * привязки демоном, со своим hwnd.
 *
 * Бюджет: раз в BELL_INTERVAL_MS — getVisibleWindowIds() и чтение маленького
 * местного реестра; путь к exe — один раз на hwnd. Индекс сессий и каталог детей
 * трогаются, только когда изменились окна, их заголовки или реестр, и раз в
 * BELL_REFRESH_MS — чтобы заметить нового ребёнка в каталоге.
 *
 * Fail-open: файл переписывается при смене списка и не реже раза в
 * BELL_HEARTBEAT_MS (время в первой строке — срок годности для lua). Сбой
 * пересчёта — запись прекращается, список протухает, звенят все. claudeWt
 * выключен или служба остановлена — файл убирается.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BELL_CHILDREN_FILE, BELL_HEARTBEAT_MS, bellChildKeys, bellChildrenText, childrenDirFor,
} from '../claude-wt/bell-children-helpers.js';
import { readChildren } from '../claude-wt/child-registry.js';
import { terminalWindowsOf } from './window-icons.js';
import { writeFileAtomic } from '../commands/write-file-atomic.js';

const BELL_INTERVAL_MS = 3000;
const BELL_REFRESH_MS = 15000;

function startBellChildren({
  winMan, log, file = path.join(os.homedir(), BELL_CHILDREN_FILE), readRegistry = readChildren,
  intervalMs = BELL_INTERVAL_MS, refreshMs = BELL_REFRESH_MS, heartbeatMs = BELL_HEARTBEAT_MS,
  now = () => Date.now(), setIntervalFn = setInterval, clearIntervalFn = clearInterval,
  write = writeFileAtomic, remove = f => fs.rmSync(f, { force: true }),
}) {
  const off = { tick() {}, stop() {} };
  if (typeof winMan?.getVisibleWindowIds !== 'function') return off;

  const terminalWindows = terminalWindowsOf(winMan);
  let lastPrint = '';
  let lastFull = -Infinity;
  // Ключи с последнего удачного пересчёта; null — верить нечему, не писать.
  let keys = null;
  let written = null;
  let writtenAt = -Infinity;
  // Файл мог остаться от прошлого процесса — первый выключенный тик его убирает.
  let maybeOnDisk = true;
  let lastError = '';

  function report(e) {
    if (e.message === lastError) return;
    lastError = e.message;
    log(`bell children: ${e.message}`, 'warn');
  }

  function drop() {
    keys = null;
    written = null;
    writtenAt = -Infinity;
    lastPrint = '';
    lastFull = -Infinity;
    if (!maybeOnDisk) return;
    try {
      remove(file);
      maybeOnDisk = false;
    } catch (e) {
      report(e);
    }
  }

  function recompute(cfg, windows, registry, t) {
    const sessions = windows.length ? winMan.claudeWtWindowSessions(windows) : [];
    const children = windows.length ? winMan.claudeWtHeadIds(childrenDirFor(cfg)) : new Set();
    return bellChildKeys({ windows, sessions, children, registry, now: t });
  }

  function tick() {
    try {
      const cfg = winMan.getClaudeWtConfig();
      if (!cfg?.enabled) {
        drop();
        return;
      }
      const t = now();
      const { windows } = terminalWindows();
      const registry = readRegistry();
      const print = JSON.stringify([windows, registry]);
      if (keys === null || print !== lastPrint || t - lastFull >= refreshMs) {
        keys = null;
        keys = recompute(cfg, windows, registry, t);
        lastPrint = print;
        lastFull = t;
      }
      const body = keys.join('\n');
      if (body === written && t - writtenAt < heartbeatMs) return;
      write(file, bellChildrenText(keys, Math.floor(t / 1000)));
      maybeOnDisk = true;
      written = body;
      writtenAt = t;
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
      maybeOnDisk = true;
      drop();
    },
  };
}

export { startBellChildren, BELL_INTERVAL_MS, BELL_REFRESH_MS };
