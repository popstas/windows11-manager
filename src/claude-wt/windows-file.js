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

export * from './windows-file-helpers.js';
export { writeWindowsFile };
