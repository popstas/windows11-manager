import fs from 'node:fs';
import path from 'node:path';

/**
 * Записать опубликованный файл окон.
 *
 * Tmp + rename в том же каталоге. Читатель опрашивает раз в секунду, и без
 * атомарной подмены он рано или поздно прочитал бы половину файла — а половина
 * json это не «неполные данные», это исключение вместо списка сессий.
 *
 * fsync, в отличие от state.js, не делается намеренно. Там он спасает
 * `lastLayout`, ради которого и заведено восстановление после сбоя; здесь
 * порванный питанием файл стоит одной пометки в чужом списке и переписывается
 * через тридцать секунд. Платить за это round-trip на сетевой диск дважды в
 * минуту незачем.
 */
function writeWindowsFile(filePath, payload) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, filePath);
}

/**
 * Убрать опубликованный файл окон.
 *
 * Зовётся, когда демона остановили намеренно. В файле лежит его `pid`, и сторож
 * в MQTT-службе снимает по этому номеру замолчавшего демона; пока файл считается
 * свежим (PID_TRUST_MS в mqtt/daemon-watchdog.js), номер уже мёртвого процесса
 * Windows вправе выдать кому угодно — и одно снятие успевало бы прилететь чужому
 * процессу. Отсутствие файла и сторож, и читатели понимают как «тиков нет», а
 * это ровно правда: демона больше нет.
 *
 * `.tmp` рядом убирается заодно: он остаётся только от записи, порванной на
 * половине, и без хозяина не значит ничего.
 *
 * Нет файла — нечего и убирать; всё прочее (права, отвалившийся сетевой диск)
 * бросается вызывающему, ему решать, насколько это громко.
 */
function removeWindowsFile(filePath) {
  if (!filePath) return;
  for (const target of [filePath, `${filePath}.tmp`]) {
    try {
      fs.unlinkSync(target);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
}

export * from './windows-file-helpers.js';
export { writeWindowsFile, removeWindowsFile };
