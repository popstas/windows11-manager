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
import { fancyZonesToPos } from '../fancyzones.js';
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
        rect = fancyZonesToPos({ monitor, position }, { positionsFallback: false });
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

export { HEAD_LAYOUT_TTL_MS, resolveHeadLayout, resetHeadLayoutCache };
