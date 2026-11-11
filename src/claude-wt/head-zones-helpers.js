/**
 * Окна head и его детей по основным зонам FancyZones: чистая часть.
 *
 * Конфиг, геометрия «в какой зоне стоит окно», планы размещения ребёнка и
 * раскладки группы. Ни node-window-manager, ни файлов здесь нет — тесты
 * гоняются на машине разработчика. Спека:
 * docs/superpowers/specs/2026-11-11-claude-wt-head-zones-design.md.
 *
 * Номер монитора — номер FancyZones в нумерации кода (`getSortedMonitors`,
 * тот же, что у `tileZones` и `rule.fancyZones`), а не сырой порядок
 * `editor-parameters.json`: на popstas-nb они расходятся.
 */

/** @typedef {{x:number, y:number, width:number, height:number}} Rect */
/** @typedef {{monitor:number, position:number, rect:Rect}} ZoneRect */
/** @typedef {{monitors: {monitor:number, rect:Rect}[], zones: ZoneRect[]}} HeadLayout */
/** @typedef {{monitor:number|null, zone:number|null, slot:1|2|3|null}} Location */

const PLACEMENTS = ['stack', 'free'];

const isPositiveInt = v => Number.isInteger(v) && v >= 1;

/** Ключ зоны в картах и сообщениях: `1:4`. */
function zoneKey(monitor, position) {
  return `${monitor}:${position}`;
}

/**
 * `claudeWt.headZones`: монитор → пара основных зон.
 *
 * Разбор поэлементный, как у соседних списков конфига: одна опечатка не гасит
 * остальные мониторы, а её причина уходит в `problems` — молча выброшенная
 * запись выглядела бы как «зоны не работают» без единого следа в журнале.
 * Строки вместо чисел не принимаются: `'1'` в YAML — это уже кавычки, которые
 * человек поставил руками, и угадывать за него незачем.
 */
function normalizeHeadZones(raw) {
  const zones = {};
  const problems = [];
  if (raw === undefined || raw === null) return { zones, problems };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('claudeWt.headZones: ожидается карта «монитор: [зона, зона]»');
    return { zones, problems };
  }
  for (const [key, value] of Object.entries(raw)) {
    const monitor = Number(key);
    if (!isPositiveInt(monitor)) {
      problems.push(`claudeWt.headZones.${key}: номер монитора — целое от 1`);
      continue;
    }
    if (!Array.isArray(value) || value.length !== 2 || !value.every(isPositiveInt)) {
      problems.push(`claudeWt.headZones.${key}: ожидается пара номеров зон, например [3, 4]`);
      continue;
    }
    if (value[0] === value[1]) {
      problems.push(`claudeWt.headZones.${key}: зоны пары совпадают`);
      continue;
    }
    zones[monitor] = [value[0], value[1]];
  }
  return { zones, problems };
}

/** Как ставить ребёнка без явной зоны. Всё незнакомое — `stack`, умолчание. */
function normalizeChildPlacement(raw) {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return PLACEMENTS.includes(v) ? v : 'stack';
}

export { zoneKey, normalizeHeadZones, normalizeChildPlacement };
