/**
 * Чтение и запись `claudeWt.tileZones` в живом YAML-конфиге.
 *
 * Окно настроек трея правит `tauri-plugin-store`, а `tileZones` живёт в YAML
 * node-части — трей YAML не разбирает вовсе. Поэтому запись идёт через эту
 * node-команду, которую Rust зовёт тем же способом, что и остальные
 * (`run_node_command` и соседи), а не через прямую запись в файл настроек.
 *
 * Запись обязана сохранять комментарии — конфиг человек ведёт руками, и он
 * весь в поясняющих комментариях. Наивная сериализация всего объекта
 * (`JSON.parse`/`stringify` или `yaml.stringify(obj)`) их бы стёрла. Вместо
 * этого — Document API пакета `yaml` (`parseDocument` + точечная правка узла +
 * `String(doc)`), который сохраняет комментарии и форматирование остального
 * файла нетронутыми.
 */
import fs from 'node:fs';
import { parseDocument } from 'yaml';
import { getConfig, resolveConfigPath } from '../config.js';
import { formatTileZonesText, parseTileZonesText } from './tile-zones-helpers.js';

/** Текущие tileZones в текстовой форме поля настроек. */
function readTileZonesText() {
  const config = getConfig();
  return formatTileZonesText(config.claudeWt?.tileZones || []);
}

/**
 * Записать tileZones из текста поля настроек в YAML-конфиг, не трогая
 * остальное его содержимое.
 *
 * Запись атомарна: пишется во временный файл рядом с конфигом, затем —
 * переименование поверх оригинала. Обрыв посреди записи оставляет нетронутым
 * старый файл, а не половину нового.
 */
function writeTileZonesText(text) {
  const { zones, error } = parseTileZonesText(text);
  if (error) throw new Error(error);

  const filePath = resolveConfigPath();
  if (!filePath) throw new Error('конфиг не найден ни в одном из мест поиска');

  const raw = fs.readFileSync(filePath, 'utf8');
  const doc = parseDocument(raw, { merge: true });

  // Плоский стиль `{ monitor: 1, position: 6 }` — тот же, что у примера в
  // config.example.yaml, а не блочный (каждое поле на своей строке).
  const seq = doc.createNode(zones.map((z) => ({ monitor: z.monitor, position: z.position })));
  for (const item of seq.items) item.flow = true;
  doc.setIn(['claudeWt', 'tileZones'], seq);

  const out = String(doc);
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, out, 'utf8');
  fs.renameSync(tmpPath, filePath);

  return zones;
}

export { readTileZonesText, writeTileZonesText };
