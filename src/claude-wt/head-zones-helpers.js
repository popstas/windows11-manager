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

import { isMinimized } from '../windows-helpers.js';
import { stackInCell } from '../claude-layout-helpers.js';

const PLACEMENTS = ['stack', 'free'];

/** Доля площади окна внутри зоны, с которой окно считается стоящим в ней. */
const ZONE_MIN_SHARE = 0.6;

/** Мест в зоне по высоте: с четвёртого окна новое ложится поверх. */
const MAX_SLOTS = 3;

/** Окно нигде: свёрнуто, раскладки нет или вне всех мониторов. */
const NO_LOCATION = Object.freeze({ monitor: null, zone: null, slot: null });

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

const isRect = r => r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;

function overlapArea(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Прямоугольник монитора из `editor-parameters.json` в пространстве окон.
 *
 * Формула та же, что у зон (`calcFancyZonePos`): editor-parameters живёт в
 * физических пикселях, окна — в логических, и между ними деление на dpi/96.
 * Разойдись они, окно в зоне числилось бы на соседнем мониторе.
 */
function editorMonitorRect(entry) {
  const scale = entry?.dpi ? entry.dpi / 96 : 1;
  const raw = {
    x: entry?.['left-coordinate'],
    y: entry?.['top-coordinate'],
    width: entry?.['work-area-width'],
    height: entry?.['work-area-height'],
  };
  if (scale === 1) return raw;
  return {
    x: Math.round(raw.x / scale),
    y: Math.round(raw.y / scale),
    width: Math.round(raw.width / scale),
    height: Math.round(raw.height / scale),
  };
}

/**
 * Основная зона, в которой стоит окно: не меньше 60% площади окна внутри неё.
 *
 * Зоны одного монитора законно перекрываются (на правом мониторе ноутбука —
 * на 364 px), и окно в полосе перекрытия подходит обеим: побеждает большее
 * пересечение, а при равенстве — первая по списку, то есть первая в паре.
 */
function zoneOfRect(rect, zones) {
  if (!isRect(rect)) return null;
  const area = rect.width * rect.height;
  let best = null;
  let bestArea = 0;
  for (const zone of zones ?? []) {
    const inter = overlapArea(rect, zone.rect);
    if (inter / area >= ZONE_MIN_SHARE && inter > bestArea) {
      best = zone;
      bestArea = inter;
    }
  }
  return best;
}

/**
 * Место окна в зоне, 1–3, по верхней кромке и в целых числах.
 *
 * Пороги стоят посередине между верхними кромками, которые даёт
 * `stackInCell` на 1, 2 и 3 места: окно на всю зону — место 1, половины — 1
 * и 2, трети — 1, 2, 3. Округление `dy / (h/3)` отдало бы нижней половине
 * (ровно 1.5) место 3, а счёт по центру окна — окну на всю зону место 2.
 */
function slotInZone(rect, zone) {
  const p = Math.floor(zone.height / MAX_SLOTS);
  const dy = rect.y - zone.y;
  if (2 * dy < p) return 1;
  if (4 * dy < 7 * p) return 2;
  return 3;
}

/** Монитор FancyZones, на котором центр окна, или null. */
function monitorOfRect(rect, monitors) {
  if (!isRect(rect)) return null;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const hit = (monitors ?? []).find(({ rect: m }) => (
    isRect(m) && cx >= m.x && cx < m.x + m.width && cy >= m.y && cy < m.y + m.height
  ));
  return hit ? hit.monitor : null;
}

/**
 * Где стоит окно: монитор, основная зона и место в ней.
 *
 * Свёрнутое окно нигде не стоит и места не занимает — то же правило, что у
 * плитки и у трекера (`isMinimized` из windows-helpers, по прямоугольнику).
 */
function locateWindow(bounds, layout) {
  if (!layout || !isRect(bounds) || isMinimized(bounds)) return NO_LOCATION;
  const zone = zoneOfRect(bounds, layout.zones);
  return {
    monitor: zone ? zone.monitor : monitorOfRect(bounds, layout.monitors),
    zone: zone ? zone.position : null,
    slot: zone ? slotInZone(bounds, zone.rect) : null,
  };
}

/**
 * Стопка детей одного head в зоне: где встанет новый и кто из своих сдвинется.
 *
 * `own` — видимые дети этого head, уже стоящие в зоне. Пока их меньше трёх,
 * зона делится на `k + 1` равных мест, свои переставляются на места 1..k в
 * порядке их нынешнего положения сверху вниз (перестановка при открытии —
 * решение Стаса, на закрытие окна она не распространяется), новый — на
 * место `k + 1`. С трёх и больше сетка остаётся из трёх мест, новый ложится
 * поверх места `(k mod 3) + 1`, а остальные не двигаются: высота окна никогда
 * не меньше трети зоны.
 *
 * @param {{ zone: Rect, own: {id: string, rect: Rect}[] }} opts
 * @returns {{ moves: {id: string, pos: Rect}[], pos: Rect }}
 */
function stackPlan({ zone, own }) {
  const k = own.length;
  if (k >= MAX_SLOTS) return { moves: [], pos: stackInCell(zone, MAX_SLOTS)[k % MAX_SLOTS] };
  const places = stackInCell(zone, k + 1);
  const ordered = [...own].sort((a, b) => a.rect.y - b.rect.y);
  return {
    moves: ordered.map((c, i) => ({ id: c.id, pos: places[i] })),
    pos: places[k],
  };
}

/**
 * Место поверх чужих окон: сетка из трёх, место `(count mod 3) + 1`, никто
 * не двигается. Так режим `free` делит зону чужой группы, когда других
 * вариантов нет.
 */
function overlayPos(zone, count) {
  return stackInCell(zone, MAX_SLOTS)[count % MAX_SLOTS];
}

/**
 * Зона ребёнка в режиме `stack`: соседняя основная зона монитора head, а если
 * head не в основной зоне (развёрнут, перетащен руками) — вторая зона пары.
 * Монитор head не в headZones или неизвестен — null, и окно ставится как
 * раньше.
 */
function pickStackZone({ headLoc, headZones }) {
  const pair = headLoc?.monitor != null ? headZones?.[headLoc.monitor] : null;
  if (!pair) return null;
  const position = headLoc.zone === pair[1] ? pair[0] : pair[1];
  return { monitor: headLoc.monitor, position };
}

/**
 * Порядок перебора зон режима `free`: сначала пара монитора head, потом
 * остальные мониторы по возрастанию номера, внутри пары — её порядок. Только
 * зоны, у которых сейчас есть прямоугольник (`available`).
 */
function freeCandidates({ headZones, headMonitor, available }) {
  const byKey = new Map((available ?? []).map(z => [zoneKey(z.monitor, z.position), z]));
  const monitors = Object.keys(headZones ?? {}).map(Number).sort((a, b) => a - b);
  const order = monitors.includes(headMonitor)
    ? [headMonitor, ...monitors.filter(m => m !== headMonitor)]
    : monitors;
  const out = [];
  for (const m of order) {
    for (const p of headZones[m]) {
      const z = byKey.get(zoneKey(m, p));
      if (z) out.push(z);
    }
  }
  return out;
}

/**
 * Зона режима `free`.
 *
 * `occupancy` по ключу зоны: `own` — видимые дети этого head, `foreign` —
 * все остальные окна сессий со стола head, включая самого head. Порядок
 * предпочтений:
 * 1. пустая зона — первая по кандидатам;
 * 2. зона только своих детей — где их меньше, при равенстве первая; дальше
 *    правило стопки;
 * 3. везде чужие — где окон меньше всего; новое окно ложится поверх
 *    (`overlay`), чужие не двигаются.
 */
function pickFreeZone({ candidates, occupancy }) {
  const occ = z => occupancy.get(zoneKey(z.monitor, z.position)) ?? { own: 0, foreign: 0 };
  const empty = candidates.find(z => occ(z).own + occ(z).foreign === 0);
  if (empty) return { zone: empty, how: 'stack' };
  const minBy = (list, f) => list.reduce((best, z) => (best === null || f(z) < f(best) ? z : best), null);
  const ownOnly = minBy(candidates.filter(z => occ(z).foreign === 0), z => occ(z).own);
  if (ownOnly) return { zone: ownOnly, how: 'stack' };
  const least = minBy(candidates, z => occ(z).own + occ(z).foreign);
  return least ? { zone: least, how: 'overlay' } : null;
}

export {
  ZONE_MIN_SHARE,
  MAX_SLOTS,
  NO_LOCATION,
  zoneKey,
  normalizeHeadZones,
  normalizeChildPlacement,
  editorMonitorRect,
  zoneOfRect,
  slotInZone,
  monitorOfRect,
  locateWindow,
  stackPlan,
  overlayPos,
  pickStackZone,
  freeCandidates,
  pickFreeZone,
};
