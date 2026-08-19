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
import { writeFileAtomic } from './write-file-atomic.js';

/** Текущие tileZones в текстовой форме поля настроек. */
function readTileZonesText() {
  const config = getConfig();
  return formatTileZonesText(config.claudeWt?.tileZones || []);
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
