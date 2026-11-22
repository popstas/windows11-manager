/**
 * Основные зоны мониторов (`claudeWt.headZones`), разрешённые в прямоугольники
 * пространства окон, и мониторы FancyZones рядом с ними.
 *
 * Читают это трое: трекер на каждом тике (поля `monitor/zone/slot` файла
 * окон), `session-new` на окне ребёнка и раскладка группы. Поэтому кэш:
 * файлы FancyZones и список живых мониторов перечитываются не чаще раза в
 * минуту, а в тике демона — бюджет опроса (AGENTS.md).
 *
 * Два отличия от разрешения зон у правил размещения, оба намеренные:
 * - без отката через `positionsMap`: зона отключённого монитора иначе тихо
 *   легла бы на другой экран, и `free` посчитал бы одно место двумя зонами;
 * - монитор из `editor-parameters.json` берётся, только если он подключён
 *   сейчас: файл обновляется, лишь когда открывают редактор зон, и
 *   отключённый монитор в нём живёт до перезагрузки.
 *
 * Каждая причина отказа — строка `warn`, но одна и та же пишется один раз,
 * пока набор причин не сменится: трекер зовёт это раз в секунду, и лог
 * popstas-pc уже вырос до 316 МБ на одном повторяющемся отказе.
 */
import { fancyZonesToPos, getFancyZoneInfo } from '../fancyzones.js';
import { getSortedMonitors, getWindowsMonitors } from '../monitors.js';
import { toWindowSpace } from '../claude-layout-helpers.js';
import { editorMonitorRect, zoneKey } from './head-zones-helpers.js';

const HEAD_LAYOUT_TTL_MS = 60_000;

let cache = null; // { key, at, layout }
let lastProblems = '';

function resetHeadLayoutCache() {
  cache = null;
  lastProblems = '';
}

const centerIn = (r, b) => {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  return cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height;
};

function liveMonitorRects() {
  return getWindowsMonitors().map((m) => {
    const raw = m.bounds ?? m.getBounds?.();
    return toWindowSpace(raw, m.getScaleFactor?.() ?? 1);
  }).filter(Boolean);
}

/** Мониторы FancyZones (нумерация кода), подключённые сейчас. */
function connectedMonitors(problems) {
  let editor;
  let live;
  try {
    editor = getSortedMonitors();
    live = liveMonitorRects();
  } catch (e) {
    problems.push(`claude-wt headZones: мониторы FancyZones не прочитались — ${e.message}`);
    return null;
  }
  const out = [];
  editor.forEach((entry, i) => {
    const rect = editorMonitorRect(entry);
    if (live.some(b => centerIn(rect, b))) out.push({ monitor: i + 1, rect });
  });
  return out;
}

function compute(headZones, problems) {
  const monitors = connectedMonitors(problems);
  if (!monitors) return null;
  const zones = [];
  // Ключи — целые, и JS перебирает их по возрастанию: это и есть порядок
  // мониторов для всех читателей (спека: «остальные в порядке ключей»).
  for (const [key, pair] of Object.entries(headZones)) {
    const monitor = Number(key);
    if (!monitors.some(m => m.monitor === monitor)) {
      problems.push(`claude-wt headZones: монитор ${monitor} не подключён или неизвестен FancyZones — его зоны пропущены`);
      continue;
    }
    for (const position of pair) {
      let rect;
      try {
        // quiet: причину пишем сами, один раз на смену набора причин.
        rect = fancyZonesToPos({ monitor, position }, { positionsFallback: false, quiet: true });
      } catch (e) {
        problems.push(`claude-wt headZones: зона ${zoneKey(monitor, position)} — ${e.message}, пропущена`);
        continue;
      }
      if (!rect) {
        problems.push(`claude-wt headZones: зона ${zoneKey(monitor, position)} не разрешилась — пропущена`);
        continue;
      }
      zones.push({ monitor, position, rect });
    }
  }
  return zones.length ? { monitors, zones } : null;
}

/**
 * @param {{ headZones: Record<string,[number,number]>, problems?: string[],
 *   log: (message: string, level?: string) => void, nowMs?: number }} opts
 *   `problems` — причины из разбора конфига (`cfg.headZonesProblems`).
 * @returns {import('./head-zones-helpers.js').HeadLayout|null}
 */
function resolveHeadLayout({ headZones, problems: configProblems = [], log, nowMs = Date.now() }) {
  const zonesSet = headZones && Object.keys(headZones).length > 0;
  const key = JSON.stringify(headZones ?? {});
  if (cache && cache.key === key && nowMs - cache.at < HEAD_LAYOUT_TTL_MS) return cache.layout;
  const problems = [...configProblems];
  const layout = zonesSet ? compute(headZones, problems) : null;
  cache = { key, at: nowMs, layout };
  const text = problems.join('\n');
  if (text !== lastProblems) {
    for (const p of problems) log(p, 'warn');
    lastProblems = text;
  }
  return layout;
}

/**
 * Одна зона FancyZones `{monitor, position}` в прямоугольник пространства окон
 * — для переноса уже открытого окна (`claude-place` с `mode: "zone"`).
 *
 * В отличие от `resolveHeadLayout`, зона не обязана быть в `claudeWt.headZones`:
 * перенос окна — просьба про раскладку FancyZones монитора, а не про основные
 * зоны head. Два правила оттуда же остаются, и по тем же причинам: монитор
 * должен быть подключён сейчас (`editor-parameters.json` помнит отключённые до
 * перезагрузки) и никакого отката через `positionsMap` — зона отключённого
 * монитора иначе тихо легла бы на другой экран.
 *
 * Без кэша: просьба редкая (агент, по одной), а свежий ответ важнее.
 * Причины — по-английски: их читает агент в stderr CLI.
 *
 * @param {{monitor: number, position: number}} zone
 * @returns {{ rect: {x:number,y:number,width:number,height:number} } | { error: string }}
 */
function resolveZone({ monitor, position }) {
  const problems = [];
  const monitors = connectedMonitors(problems);
  if (!monitors) return { error: `FancyZones monitors could not be read: ${problems.join('; ')}` };
  if (!monitors.some(m => m.monitor === monitor)) {
    const known = monitors.map(m => m.monitor).join(', ') || 'none';
    return { error: `monitor ${monitor} is not connected or unknown to FancyZones (connected: ${known})` };
  }
  const opts = { positionsFallback: false, quiet: true };
  let info;
  let rect;
  try {
    info = getFancyZoneInfo({ monitor, position }, opts);
    if (info?.zone) rect = fancyZonesToPos({ monitor, position }, opts);
  } catch (e) {
    return { error: `zone ${zoneKey(monitor, position)}: FancyZones files could not be read (${e.message})` };
  }
  if (!info || !info.layout) return { error: `monitor ${monitor} has no custom FancyZones layout applied` };
  if (!info.zone) {
    const n = info.layout.info?.zones?.length ?? 0;
    return { error: `zone ${zoneKey(monitor, position)} is not in the FancyZones layout of monitor ${monitor} (zones 1..${n})` };
  }
  if (!rect) return { error: `zone ${zoneKey(monitor, position)} did not resolve` };
  return { rect };
}

export { HEAD_LAYOUT_TTL_MS, resolveHeadLayout, resetHeadLayoutCache, resolveZone };
