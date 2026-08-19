/**
 * Чтение и запись скалярных полей вкладки Claude в живом YAML-конфиге.
 *
 * Окно настроек трея правит `tauri-plugin-store`, а эти поля живут в YAML
 * node-части — трей YAML не разбирает вовсе. Поэтому и чтение, и запись идут
 * через node-команду `claude-wt config`, которую Rust зовёт тем же способом,
 * что и соседнюю `claude-wt tile-zones`.
 *
 * Читается **фактический файл**, а не слитая с умолчаниями конфигурация:
 * `getConfig()` умолчаний не подмешивает (см. `src/config.js`), поэтому
 * незаданный ключ приезжает в форму как `null` и показывается плейсхолдером.
 * Иначе первое же сохранение материализовало бы в конфиг десяток умолчаний,
 * которых человек туда не писал, — и молча зафиксировало бы их, перестав
 * следовать за правкой умолчания в коде.
 *
 * Запись применяет **только пришедшие ключи**, по одному, поверх
 * накапливающегося текста, и каждая правка сама себя проверяет
 * (`patchConfigScalar` → `verifyPatch`). Файл читается один раз и пишется один
 * раз: промежуточные состояния на диск не попадают.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getConfig, resolveConfigPath } from '../config.js';
import { CLAUDE_CONFIG_FIELDS, coerceFieldValue } from './claude-config-fields.js';
import { patchConfigScalar } from './config-scalar-patch.js';
import { writeFileAtomic } from './write-file-atomic.js';

/**
 * Текущие значения полей вкладки: `{ 'claudeWt.interval': 1000, ... }`.
 * Незаданное — `null`, а не умолчание (см. шапку).
 */
function readClaudeConfig() {
  const config = getConfig();
  const out = {};
  for (const field of CLAUDE_CONFIG_FIELDS) {
    const value = config?.[field.section]?.[field.key];
    out[field.name] = value === undefined ? null : value;
  }
  return out;
}

/**
 * Записать пришедшие поля в YAML-конфиг, не трогая остального его содержимого —
 * байт в байт за пределами самих правящихся значений.
 *
 * `patch` — объект `{ 'claudeWt.interval': 1000, 'claudeWt.profile': null }`;
 * `null` значит «убрать ключ, вернуть умолчание». Возвращает список изменённых
 * имён — его печатает CLI, чтобы в журнале трея было видно, что именно ушло в
 * конфиг.
 */
function writeClaudeConfig(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('ожидается объект вида {"claudeWt.interval": 1000}');
  }

  const names = Object.keys(patch);
  if (!names.length) return [];

  // Разбор и проверка ВСЕХ полей до первой правки текста: половина
  // сохранённых полей и отказ на середине — худший исход, чем отказ целиком.
  const changes = names.map((name) => {
    const field = CLAUDE_CONFIG_FIELDS.find((f) => f.name === name);
    if (!field) throw new Error(`неизвестное поле конфига: ${name}`);
    return { field, value: coerceFieldValue(name, patch[name]) };
  });

  const filePath = resolveConfigPath();
  if (!filePath) throw new Error('конфиг не найден ни в одном из мест поиска');

  let text = fs.readFileSync(filePath, 'utf8');
  for (const { field, value } of changes) {
    text = patchConfigScalar(text, field.section, field.key, value);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileAtomic(filePath, text);

  return names;
}

export { readClaudeConfig, writeClaudeConfig };
