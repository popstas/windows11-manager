/**
 * Атомарная запись текста в файл рядом (тот же том — сосед по каталогу):
 * временный файл, `fsync`, переименование поверх оригинала. Тот же приём, что
 * у `src/claude-wt/state.js` (`writeState`) — переименование журналируется
 * файловой системой, а данные без `fsync` нет, и без него обрыв питания
 * посреди записи мог оставить рваный временный файл, откат на который не
 * спасал бы: переименование уже могло случиться раньше fsync.
 *
 * Право доступа временного файла берётся у оригинала явно: `fs.writeFileSync`
 * создал бы его по umask, а в правящемся этим модулем конфиге лежит
 * `mqtt_password` — сужать права записи молча нельзя. Права проставляются
 * через `fchmodSync` уже после открытия, а не через параметр `mode` у
 * `openSync`: тот режется тем же umask при создании файла (076 при `umask 077`
 * стало бы 600 и здесь не страшно, но узость не гарантирована — `fchmodSync`
 * её не оставляет на волю системных умолчаний).
 *
 * При любой неудаче между открытием и переименованием временный файл убирается,
 * а не остаётся мусором `*.tmp-<pid>` рядом с конфигом.
 *
 * Отдельным модулем, а не при одном из вызывающих: конфиг правят два соседа —
 * поле зон (`tile-zones-commands.js`) и поля вкладки Claude
 * (`claude-config-commands.js`), и вторая копия этих тонкостей однажды
 * разошлась бы с первой.
 */
import fs from 'node:fs';

function writeFileAtomic(filePath, text) {
  const mode = fs.existsSync(filePath) ? fs.statSync(filePath).mode & 0o777 : 0o644;
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  try {
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.fchmodSync(fd, mode);
      fs.writeSync(fd, text, null, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch { /* временного файла и не появилось, или уже убран */ }
    throw e;
  }
}

export { writeFileAtomic };
