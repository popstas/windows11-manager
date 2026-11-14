/**
 * Чистые помощники поля `headZones` в окне настроек: разбор и форматирование
 * текстовой формы textarea, рендер значения в YAML. Без I/O.
 *
 * Строка — `monitor: head,children`, по монитору на строку: `2: 5,6` значит
 * «на мониторе 2 head стоит в зоне 5, его дети — в зоне 6». Принимается и
 * `2,5,6` — та же запятая, что у соседнего поля tile zones. Номер монитора —
 * нумерация кода FancyZones, как у `tileZones` (см. head-zones-helpers.js в
 * claude-wt).
 *
 * Правила годности зон не повторяются здесь, а берутся из
 * `normalizeHeadZones` — того же разбора, которым их читает демон: поле не
 * должно пропускать в конфиг то, что демон потом выбросит с warn.
 */
import { normalizeHeadZones } from '../claude-wt/head-zones-helpers.js';

const LINE_RE = /^(\d+)\s*[:,]\s*(\d+)\s*,\s*(\d+)$/;

/** Зоны -> текст textarea: `monitor: head,children`, мониторы по возрастанию. */
function formatHeadZonesText(zones = {}) {
  return Object.keys(zones)
    .map(Number)
    .sort((a, b) => a - b)
    .map((m) => `${m}: ${zones[m][0]},${zones[m][1]}`)
    .join('\n');
}

/**
 * Текст textarea -> карта `{ монитор: [зона, зона] }`.
 *
 * Пустые строки пропускаются. Неразборчивая строка, повтор монитора (в карте
 * второй молча затёр бы первый) и негодная пара — ошибка с номером строки.
 */
function parseHeadZonesText(text = '') {
  const raw = {};
  const lineOf = {};
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = LINE_RE.exec(line);
    if (!m) {
      return {
        zones: null,
        error: `строка ${i + 1} не разбирается: "${line}" (ожидается "monitor: head,children", например "2: 5,6")`,
      };
    }
    const monitor = Number(m[1]);
    if (monitor in raw) {
      return { zones: null, error: `строка ${i + 1}: монитор ${monitor} уже задан в строке ${lineOf[monitor]}` };
    }
    raw[monitor] = [Number(m[2]), Number(m[3])];
    lineOf[monitor] = i + 1;
  }
  const { zones, problems } = normalizeHeadZones(raw);
  if (problems.length) return { zones: null, error: problems.join('; ') };
  return { zones, error: null };
}

/** Карта зон -> однострочная flow-карта YAML: `{ 1: [3, 4], 2: [5, 6] }`. */
function renderHeadZonesFlow(zones) {
  const items = Object.keys(zones)
    .map(Number)
    .sort((a, b) => a - b)
    .map((m) => `${m}: [${zones[m][0]}, ${zones[m][1]}]`);
  return `{ ${items.join(', ')} }`;
}

export { formatHeadZonesText, parseHeadZonesText, renderHeadZonesFlow };
