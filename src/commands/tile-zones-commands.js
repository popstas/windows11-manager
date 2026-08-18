/**
 * Чтение и запись `claudeWt.tileZones` в живом YAML-конфиге.
 *
 * Окно настроек трея правит `tauri-plugin-store`, а `tileZones` живёт в YAML
 * node-части — трей YAML не разбирает вовсе. Поэтому запись идёт через эту
 * node-команду, которую Rust зовёт тем же способом, что и остальные
 * (`run_node_command` и соседи), а не через прямую запись в файл настроек.
 *
 * Запись обязана сохранять комментарии и форматирование конфига целиком —
 * конфиг человек ведёт руками, и он весь в поясняющих комментариях. Правку
 * значения делает `patchTileZonesText` (`./tile-zones-patch.js`) точечно, по
 * диапазону символов узла `claudeWt.tileZones`, а не пересборкой всего
 * документа: `yaml.stringify(obj)` или `String(parseDocument(...))`
 * переразбирают весь файл и меняют форматирование мест, которых никто не
 * трогал (см. комментарий в tile-zones-patch.js).
 */
import fs from 'node:fs';
import path from 'node:path';
import { getConfig, resolveConfigPath } from '../config.js';
import { formatTileZonesText, parseTileZonesText } from './tile-zones-helpers.js';
import { patchTileZonesText } from './tile-zones-patch.js';

/** Текущие tileZones в текстовой форме поля настроек. */
function readTileZonesText() {
  const config = getConfig();
  return formatTileZonesText(config.claudeWt?.tileZones || []);
}

/**
 * Атомарная запись текста в файл рядом (тот же том — сосед по каталогу):
 * временный файл, `fsync`, переименование поверх оригинала. Тот же приём,
 * что у `src/claude-wt/state.js` (`writeState`) — переименование
 * журналируется файловой системой, а данные без `fsync` нет, и без него
 * обрыв питания посреди записи мог оставить рваный временный файл, откат на
 * который не спасал бы: переименование уже могло случиться раньше fsync.
 *
 * Право доступа временного файла берётся у оригинала явно: `fs.writeFileSync`
 * создал бы его по umask, а в этом конфиге лежит `mqtt_password` — сужать
 * права записи молча нельзя.
 *
 * При любой неудаче между открытием и переименованием временный файл
 * убирается, а не остаётся мусором `*.tmp-<pid>` рядом с конфигом.
 */
function writeFileAtomic(filePath, text) {
  const mode = fs.existsSync(filePath) ? fs.statSync(filePath).mode & 0o777 : 0o644;
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  try {
    const fd = fs.openSync(tmpPath, 'w', mode);
    try {
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

/**
 * Записать tileZones из текста поля настроек в YAML-конфиг, не трогая
 * остальное его содержимое — байт в байт, за пределами диапазона самого
 * значения `tileZones` (см. `patchTileZonesText`).
 */
function writeTileZonesText(text) {
  const { zones, error } = parseTileZonesText(text);
  if (error) throw new Error(error);

  const filePath = resolveConfigPath();
  if (!filePath) throw new Error('конфиг не найден ни в одном из мест поиска');

  const raw = fs.readFileSync(filePath, 'utf8');
  const out = patchTileZonesText(raw, zones);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileAtomic(filePath, out);

  return zones;
}

export { readTileZonesText, writeTileZonesText };
