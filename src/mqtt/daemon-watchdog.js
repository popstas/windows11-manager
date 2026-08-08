/**
 * Сторож демона claude-wt в процессе MQTT-службы.
 *
 * Сам сторож (../claude-wt/watchdog.js) ничего не знает ни про файлы, ни про
 * процессы: здесь ему собирают статус, лечение и часы.
 *
 * Откуда берётся статус. `claudeWtStatus()` рассказывает про демона, живущего в
 * том же процессе: `running` — это «заведён ли интервал здесь», а `pid` — это
 * `process.pid` того, кто спросил. В windows-mqtt демон крутился рядом со
 * сторожем, и такой ответ был правдой; здесь демон — отдельный дочерний процесс
 * Tauri, и `claudeWtStatus()` из MQTT-службы вернул бы `running: false` и свой
 * собственный pid, то есть сторож объявлял бы демона мёртвым каждые тридцать
 * секунд и целился бы в себя. Поэтому статус собирается из опубликованного
 * файла окон (`claudeWt.windowsFile`): демон переписывает его каждый свой тик и
 * не реже раза в тридцать секунд даже при неизменной раскладке (сердцебиение),
 * и кладёт туда `host` и свой настоящий `pid`.
 *
 * Чем лечим. Поднять демона отсюда нельзя: его уже поднимает и перезапускает при
 * выходе Rust (`ChildKind::ClaudeWt`, backoff в children.rs). Два демона на
 * одном файле состояния хуже, чем ни одного, поэтому лечение — снять
 * замолчавший процесс и дать Rust поднять его заново. Если pid из файла не
 * достался, процесс не ищется по имени: сторож, который делает вид, что чинит,
 * хуже сторожа, который докладывает, — тогда громкая строка в лог и уведомление
 * человеку.
 */
import fs from 'node:fs';
import os from 'node:os';
import { createClaudeWtWatchdog, CHECK_INTERVAL_MS } from '../claude-wt/watchdog.js';
import { WINDOWS_FILE_HEARTBEAT_MS } from '../claude-wt/windows-file-helpers.js';

// Молчание считается в сердцебиениях файла, а не в тиках демона: TICK_SILENCE_MS
// (минута) — про счётчик тиков в памяти демона, а сюда доезжает только запись
// файла раз в тридцать секунд. Минута — это два сердцебиения, то есть одна
// задержавшаяся запись на сетевой диск уже давала бы ложный диагноз. Три — цена
// в полторы минуты за то, чтобы не снимать здорового демона.
const SILENCE_MS = 3 * WINDOWS_FILE_HEARTBEAT_MS;
// Столько ждём файла с отметкой после старта самой службы. Дольше молчания:
// демона мог только что поднять Rust (backoff до 32 с), а первый его тик идёт
// после maybeRestoreOnStart() и разбора дампа с сетевого диска.
const GRACE_MS = 120000;

/**
 * Статус демона по опубликованному файлу окон.
 *
 * `running` здесь — «демон должен работать», а не «интервал заведён»: файл о
 * заведённом интервале ничего не знает, а сторожа заводят только при
 * `claudeWt.enabled`. Молчание такого демона и есть поломка, ради которой всё
 * затевалось, и разбирает её `claudeWtHealth` по возрасту отметки.
 *
 * Файл чужой машины считается отсутствующим: `windowsFile` может лежать на общем
 * диске, а снимать процесс по чужому pid — это снимать что попало у себя.
 *
 * Счётчики падений тиков сюда не едут: в файле их нет, и сторож про них молчит.
 */
function daemonStatusFromFile(payload, { hostname, startedAt }) {
  const foreign = Boolean(payload) && payload.host !== hostname;
  const generated = !foreign && Number.isFinite(payload?.generated) ? payload.generated : 0;
  const pid = !foreign && Number.isFinite(payload?.pid) ? payload.pid : 0;
  return {
    running: true,
    // Секунды в файле — читателем там питон; здесь миллисекунды, как у health().
    lastTickAt: generated > 0 ? generated * 1000 : 0,
    startedAt,
    pid: pid > 0 ? pid : 0,
    foreign,
    tickFailures: 0,
    lastTickError: '',
  };
}

/** Прочитать файл окон. Нет файла — нет отметки: это законное «демон молчит». */
function readWindowsFile(filePath, readFile) {
  const raw = readFile(filePath);
  if (raw === null) return null;
  return JSON.parse(raw);
}

function defaultReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    // Нет файла — демон ещё не писал; всё прочее (сеть отвалилась, права)
    // сторож различить не может и одинаково считает молчанием.
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/** Лечение: снять замолчавший процесс. Поднимет его Rust — он же его и запускал. */
function createRemedy({ kill, log, notify }) {
  return (status) => {
    const { pid } = status;
    // Свой собственный pid — признак того, что статус приехал не оттуда,
    // откуда думали. Служба, снявшая сама себя, выглядела бы как «сторож
    // помог»: MQTT молчит, демон молчит, в логе ни строки.
    if (!pid || pid === process.pid) {
      log('claude-wt: демон молчит, но его pid неизвестен — процесс по имени не ищу, '
        + 'нужен ручной перезапуск демона', 'error');
      notify('claude-wt: демон молчит, pid неизвестен — нужен ручной перезапуск');
      return false;
    }
    try {
      kill(pid);
    } catch (e) {
      // ESRCH — процесса уже нет: значит он вышел сам и его поднимает Rust.
      // Всё остальное (права, чужой процесс) человеку тоже надо знать.
      log(`claude-wt: не смог снять замолчавшего демона (pid ${pid}): ${e.message}`, 'error');
      notify(`claude-wt: демон молчит, снять процесс ${pid} не вышло: ${e.message}`);
      return false;
    }
    log(`claude-wt: снимаю замолчавшего демона (pid ${pid}), поднять его заново — дело Tauri`, 'warn');
    notify(`claude-wt: демон молчал, процесс ${pid} снят — Tauri поднимет его заново`);
    return true;
  };
}

/**
 * Завести сторожа. Возвращает `{ stop() }` в любом случае — вызывающему не
 * приходится помнить, завёлся ли он.
 */
function startDaemonWatchdog({
  winMan,
  log,
  notify = () => {},
  kill = (pid) => process.kill(pid),
  readFile = defaultReadFile,
  now = Date.now,
  hostname = os.hostname(),
}) {
  const noop = { stop() {} };

  let cfg;
  try {
    cfg = winMan.getClaudeWtConfig();
  } catch (e) {
    log(`claude-wt: сторож не заведён — конфиг демона не прочитан: ${e.message}`, 'error');
    return noop;
  }
  if (!cfg?.enabled) return noop;

  // Диагноз ставит библиотека. Нет его — сторожа не заводим вовсе: иначе
  // check() падал бы раз в тридцать секунд в глушащий обработчик таймера, и с
  // виду сторож работал бы, а на деле не смотрел бы ни за чем.
  if (typeof winMan.claudeWtHealth !== 'function') {
    log('claude-wt: библиотека без claudeWtHealth — сторож не заведён, '
      + 'молчание демона замечено не будет', 'error');
    return noop;
  }
  // Единственный сигнал о живости демона из другого процесса. Без него сторожу
  // не на что смотреть, и молчать об этом нельзя.
  if (!cfg.windowsFile) {
    log('claude-wt: claudeWt.windowsFile не задан — сторожу не по чему судить о демоне, '
      + 'он не заведён, молчание демона замечено не будет', 'error');
    return noop;
  }

  const startedAt = now();
  let foreignReported = false;

  const check = createClaudeWtWatchdog({
    status: () => {
      const payload = readWindowsFile(cfg.windowsFile, readFile);
      const status = daemonStatusFromFile(payload, { hostname, startedAt });
      if (status.foreign && !foreignReported) {
        foreignReported = true;
        log(`claude-wt: ${cfg.windowsFile} пишет чужая машина (${payload.host}), `
          + 'наш демон в нём не виден', 'warn');
      }
      return status;
    },
    health: (args) => winMan.claudeWtHealth(args),
    remedy: createRemedy({ kill, log, notify }),
    log,
    now,
    silenceMs: SILENCE_MS,
    graceMs: GRACE_MS,
  });

  const timerId = setInterval(check, CHECK_INTERVAL_MS);
  return {
    stop() {
      clearInterval(timerId);
    },
  };
}

export {
  startDaemonWatchdog,
  daemonStatusFromFile,
  createRemedy,
  readWindowsFile,
  SILENCE_MS,
  GRACE_MS,
};
