/**
 * Чтение и запись `claudeWt.headZones` в живом YAML-конфиге — поле «Head
 * zones» вкладки Claude в окне настроек.
 *
 * Тот же путь, что у `tile-zones-commands.js`: трей YAML не разбирает, поэтому
 * зовёт эту node-команду. Правка точечная (`patchConfigScalar` с рендером
 * flow-карты): меняется только значение ключа, комментарии и форматирование
 * остального конфига остаются байт в байт. Пустое поле убирает ключ — у
 * `headZones` умолчание `{}`, «зон нет, дети ставятся как раньше».
 */
import fs from 'node:fs';
import path from 'node:path';
import { getConfig, resolveConfigPath } from '../config.js';
import { normalizeHeadZones } from '../claude-wt/head-zones-helpers.js';
import { formatHeadZonesText, parseHeadZonesText, renderHeadZonesFlow } from './head-zones-helpers.js';
import { patchConfigScalar } from './config-scalar-patch.js';
import { writeFileAtomic } from './write-file-atomic.js';

/** Текущие headZones в текстовой форме поля настроек. */
function readHeadZonesText() {
  const config = getConfig();
  return formatHeadZonesText(normalizeHeadZones(config.claudeWt?.headZones).zones);
}

/** Записать headZones из текста поля настроек; вернуть записанную карту. */
function writeHeadZonesText(text) {
  const { zones, error } = parseHeadZonesText(text);
  if (error) throw new Error(error);

  const filePath = resolveConfigPath();
  if (!filePath) throw new Error('конфиг не найден ни в одном из мест поиска');

  const raw = fs.readFileSync(filePath, 'utf8');
  const value = Object.keys(zones).length ? zones : undefined;
  const out = patchConfigScalar(raw, 'claudeWt', 'headZones', value, { render: renderHeadZonesFlow });

  if (out !== raw) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileAtomic(filePath, out);
  }
  return zones;
}

export { readHeadZonesText, writeHeadZonesText };
