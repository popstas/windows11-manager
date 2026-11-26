/**
 * Список окон тихих сессий для звонка WezTerm: `%USERPROFILE%\.wezterm-bell-quiet`.
 *
 * Формат и правило ключа — src/claude-wt/bell-children-helpers.js
 * (`bellQuietKeys`, `bellChildrenText` с заголовком `# wezterm-bell-quiet`).
 * Ключи считает тик кнопок панели задач (src/mqtt/taskbar.js): у него уже есть
 * окна WezTerm с сырыми заголовками и состояние их агентов, а звонит только
 * WezTerm. Свой цикл с loadProgress здесь был бы вторым чтением state.json с
 * V: на тот же тик — и кэш progress.js выбрасывает id, которых нет в текущем
 * вызове, так что два зовущих с разными наборами окон читали бы сеть заново.
 *
 * Fail-open, как у списка детей: файл переписывается при смене ключей и не
 * реже раза в BELL_HEARTBEAT_MS (время в первой строке — срок годности для
 * lua). Сбой тика — файл убирается сразу, а не протухает пять минут: застрявший
 * в списке ключ глушил бы звонок нового вопроса той же сессии.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BELL_QUIET_FILE, BELL_QUIET_HEADER, BELL_HEARTBEAT_MS, bellChildrenText,
} from '../claude-wt/bell-children-helpers.js';
import { writeFileAtomic } from '../commands/write-file-atomic.js';

function createBellQuietWriter({
  log = () => {}, file = path.join(os.homedir(), BELL_QUIET_FILE), heartbeatMs = BELL_HEARTBEAT_MS,
  now = () => Date.now(), write = writeFileAtomic, remove = f => fs.rmSync(f, { force: true }),
} = {}) {
  let written = null;
  let writtenAt = -Infinity;
  // Файл мог остаться от прошлого процесса — первый drop() его убирает.
  let maybeOnDisk = true;
  let lastError = '';

  function report(e) {
    if (e.message === lastError) return;
    lastError = e.message;
    log(`bell quiet: ${e.message}`, 'warn');
  }

  /** Ключи тихих окон с тика; пишет при смене и на сердцебиении. */
  function update(keys) {
    const t = now();
    const body = keys.join('\n');
    if (body === written && t - writtenAt < heartbeatMs) return;
    try {
      write(file, bellChildrenText(keys, Math.floor(t / 1000), BELL_QUIET_HEADER));
      maybeOnDisk = true;
      written = body;
      writtenAt = t;
      lastError = '';
    } catch (e) {
      report(e);
    }
  }

  /** Убрать файл: сбой тика, остановка службы, нечем считать. */
  function drop() {
    written = null;
    writtenAt = -Infinity;
    if (!maybeOnDisk) return;
    try {
      remove(file);
      maybeOnDisk = false;
    } catch (e) {
      report(e);
    }
  }

  return { update, drop };
}

const NO_BELL_QUIET = { update() {}, drop() {} };

export { createBellQuietWriter, NO_BELL_QUIET };
