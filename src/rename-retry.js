/**
 * Переименование поверх файла с коротким повтором — хвост каждой атомарной
 * записи (временный файл + rename) в этом проекте.
 *
 * На Windows rename поверх цели, которую кто-то держит открытой без
 * FILE_SHARE_DELETE (антивирус, индексатор, чужой читатель), отвечает
 * EPERM / EBUSY / EACCES. Держат такие недолго — десятки миллисекунд, — и
 * повтор через паузу проходит. Замечено на nb 2026-11-22: демон claude-wt
 * ронял тик на `rename claude-wt.json.tmp -> claude-wt.json` раз в несколько
 * минут, и тот же тик не публиковал файл окон.
 *
 * Пауза синхронная (`Atomics.wait`): все записи здесь синхронные, и делать их
 * асинхронными ради повтора — переписать полпроекта. Худший случай —
 * 20 + 40 + 60 + 80 = 200 мс на тик в 1 с, и только когда файл держат.
 * Прочие ошибки (нет каталога, ENOSPC) не повторяются: подождав, их не
 * переждать.
 */
import fs from 'node:fs';

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const ATTEMPTS = 5;
const DELAY_MS = 20;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * @returns {number} с какой попытки удалось (1 — сразу)
 * @throws последняя ошибка, если не удалось за `attempts` попыток
 */
function renameWithRetry(from, to, { attempts = ATTEMPTS, delayMs = DELAY_MS, rename = fs.renameSync, sleep = sleepSync } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      rename(from, to);
      return attempt;
    } catch (e) {
      if (!RETRY_CODES.has(e?.code) || attempt >= attempts) throw e;
      sleep(delayMs * attempt);
    }
  }
}

export { renameWithRetry, RETRY_CODES };
