/**
 * Обёртка переподключения вокруг ssh — чистая часть, без I/O.
 *
 * Зачем: у WezTerm нет перезапуска завершившейся панели, и после обрыва ssh
 * окно сессии оставалось с «didn't exit cleanly» без способа вернуться. Обёртка
 * стоит между терминалом и ssh: при потере связи спрашивает Enter и
 * переподключается командой повтора — по id сессии (шаблон `launch`, `ccfzf
 * --session {id} --kiosk`), а не исходной: `claude -n` создал бы пустую
 * тёзку, а шаблон `launchSession` повторно отдал бы первый промпт.
 *
 * Командная строка обёртки:
 *   <node> ssh-reconnect.js --retry <base64(JSON argv)> -- <argv...>
 * Повтор едет одним аргументом в base64: кавычки удалённой команды так не
 * проходят второй раз через разбор командной строки Windows.
 */

/**
 * Коды, которыми ssh сообщает о потере связи. 255 — код самого ssh
 * («Connection closed by remote host»). Сборка OpenSSH для Windows выходит с
 * -1, и это же значение снаружи видно беззнаковым — 4294967295 (так его
 * показал WezTerm).
 */
const LOST_CODES = new Set([255, -1, 4294967295]);

/** Повтор, упавший быстрее этого, считается «возобновить не удалось». */
const RETRY_QUICK_MS = 15000;

function isConnectionLost(code) {
  return LOST_CODES.has(code);
}

function encodeArgv(argv) {
  return Buffer.from(JSON.stringify(argv.map(String)), 'utf8').toString('base64');
}

function decodeArgv(b64) {
  try {
    const parsed = JSON.parse(Buffer.from(String(b64), 'base64').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length && parsed.every(a => typeof a === 'string')) return parsed;
  } catch {
    // ниже — null
  }
  return null;
}

/**
 * Разобрать аргументы обёртки (без node и пути к скрипту).
 * Нет `--` или пустая команда — `{ ok: false }`: запускать нечего.
 * Битый `--retry` — повтора нет, но исходная команда всё равно запускается:
 * окно без переподключения лучше, чем окно, не открывшее сессию вовсе.
 */
function parseWrapperArgs(argv) {
  const sep = argv.indexOf('--');
  if (sep < 0 || sep === argv.length - 1) return { ok: false, reason: 'usage: ssh-reconnect.js [--retry <b64>] -- <command> [args...]' };
  const own = argv.slice(0, sep);
  const original = argv.slice(sep + 1);
  let retry = null;
  const at = own.indexOf('--retry');
  if (at >= 0) retry = decodeArgv(own[at + 1]);
  return { ok: true, original, retry };
}

/**
 * Что делать после выхода очередной попытки.
 *
 * - 0 — сессия закончилась по-хорошему: выйти с 0, панель закроется.
 * - потеря связи — спросить и, по Enter, переподключиться командой повтора
 *   (её нет — исходной).
 * - повтор упал быстро не потерей связи — например, обрыв случился до первого
 *   запроса, транскрипта нет и `ccfzf --session` ответил «not found»: терять
 *   нечего, предложить исходную команду.
 * - всё прочее — выйти с тем же кодом: WezTerm удержит панель с текстом
 *   ошибки, как и без обёртки.
 *
 * @returns {{ kind: 'exit', code: number } | { kind: 'ask', message: string, next: 'retry'|'original' }}
 */
function nextStep({ code, attempt, elapsedMs, hasRetry }) {
  if (code === 0) return { kind: 'exit', code: 0 };
  if (isConnectionLost(code)) {
    return { kind: 'ask', message: 'Соединение потеряно. Enter — переподключиться, другая клавиша — закрыть.', next: hasRetry ? 'retry' : 'original' };
  }
  if (attempt === 'retry' && elapsedMs < RETRY_QUICK_MS) {
    return { kind: 'ask', message: `Возобновить сессию не удалось (код ${code}). Enter — запустить исходную команду, другая клавиша — закрыть.`, next: 'original' };
  }
  return { kind: 'exit', code: exitCodeFor(code) };
}

/** Код для process.exit: null (убит сигналом) — 1, иначе как есть. */
function exitCodeFor(code) {
  return Number.isInteger(code) ? code : 1;
}

/** Нажатие из сырого режима консоли: Enter — `\r` или `\n`. */
function isEnterKey(chunk) {
  const s = String(chunk);
  return s === '\r' || s === '\n' || s === '\r\n';
}

export {
  LOST_CODES,
  RETRY_QUICK_MS,
  isConnectionLost,
  encodeArgv,
  decodeArgv,
  parseWrapperArgs,
  nextStep,
  exitCodeFor,
  isEnterKey,
};
