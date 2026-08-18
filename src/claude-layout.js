/**
 * Раскладки окон Claude: просьба `claude-place` от пикера и панели.
 *
 * Здесь только то, что ходит наружу — зоны FancyZones, мониторы, список
 * сессий, движение окон. Вся арифметика в claude-layout-helpers.js, и её
 * тесты гоняются на машине без node-window-manager.
 */
import { getConfig } from './config.js';
import { fancyZonesToPos } from './fancyzones.js';
import { getMonitorByPoint, getPrimaryMonitor } from './monitors.js';
import { getWindowById } from './windows.js';
import { placeWindow } from './placement.js';
import { claudeWtSessions } from './claude-wt/view.js';
import { orderSessions } from './claude-wt/ha/session-slots.js';
import { normalizeSort } from './claude-wt/ha/session-groups.js';
import { arrange } from './claude-layout-helpers.js';

/**
 * Зоны из `claudeWt.tileZones`, разрешённые в прямоугольники.
 *
 * Пусто значит «считай своей сеткой», и об этом всегда есть строка warn (кроме
 * каскада — там своей сетки нет вовсе, и эта строка была бы враньём):
 * протухший editor-parameters.json — известная болезнь этого проекта
 * (AGENTS.md, «Known issues»), и тихий откат спрятал бы её — окна просто
 * встали бы не туда, а человек искал бы причину в зонах.
 *
 * `fancyZonesToPos()` зовётся под try: сам разбор `false` в деструктуризации
 * не бросает (боксится как булево), но `getFancyZoneInfo()` внутри читает и
 * парсит `applied-layouts.json`/`custom-layouts.json`, а `getFancyZoneMonitor()`
 * — `editor-parameters.json`; отсутствующий или битый файл роняет JSON.parse
 * или fs.readFileSync, и вот это как раз бросает.
 */
function resolveZones(log, mode) {
  const list = getConfig()?.claudeWt?.tileZones;
  if (!Array.isArray(list) || !list.length) {
    if (mode !== 'cascade') {
      log('claude-place: claudeWt.tileZones не задан — считаю своей сеткой', 'warn');
    }
    return [];
  }
  const rects = [];
  for (const zone of list) {
    let rect;
    try {
      rect = fancyZonesToPos(zone);
    } catch (e) {
      log(`claude-place: зона ${JSON.stringify(zone)} — ${e.message}`, 'warn');
    }
    if (!rect) {
      log(`claude-place: зона ${JSON.stringify(zone)} не разрешилась — считаю своей сеткой`, 'warn');
      return [];
    }
    rects.push(rect);
  }
  return rects;
}

/**
 * Рабочая область — экран без панели задач, `MONITORINFO.rcWork`.
 *
 * Монитор ищется по прямоугольнику первой зоны, а не по её номеру: номер в
 * tileZones — номер монитора FancyZones (getSortedMonitors по
 * editor-parameters.json), а getMons() нумерует по config.monitors. Это две
 * разные нумерации, и сводить их здесь — заводить третье место, где они
 * разойдутся.
 *
 * Обёрнуто в try: getMonitorByPoint() зовёт getMons(), а тот лезет в
 * config.monitors[n] без защиты — если в конфиге задан monitorsSize без
 * monitors, это TypeError, а не «не нашёл». Не поймать его здесь — значит
 * уронить всю команду unhandled rejection вместо контрактного { ok: false }.
 * Откат на главный монитор — как и откат на свою сетку в resolveZones() —
 * всегда со строкой warn: без неё протухший editor-parameters.json (точка
 * зоны мимо любого mon.bounds) увозит окна на другой экран молча.
 */
function layoutWorkArea(rects, log) {
  let mon;
  try {
    mon = rects[0] && getMonitorByPoint(rects[0]);
  } catch (e) {
    log(`claude-place: определить монитор по зоне не удалось — считаю по главному (${e.message})`, 'warn');
    mon = null;
  }
  if (!mon) {
    if (rects[0]) {
      log('claude-place: монитор по зоне не найден — считаю по главному', 'warn');
    }
    try {
      mon = getPrimaryMonitor();
    } catch (e) {
      log(`claude-place: не удалось определить главный монитор — ${e.message}`, 'warn');
      return null;
    }
  }
  if (!mon) return null;
  return mon.getWorkArea?.() ?? mon.bounds ?? null;
}

/**
 * Окна, которые надо разложить, в порядке раскладки.
 *
 * `ids` пуст — все открытые сессии порядком этой машины, тем же, каким она
 * рисует панель. `ids` задан — порядок просящего: пикер видит свой список и
 * ждёт, что раскладка ляжет его чередой. Ненайденный id пропускается со
 * строкой в журнал: сессия закрыта или живёт на другой машине, и отменять из-за
 * неё всю просьбу незачем.
 */
function pickWindows(ids, log) {
  let res;
  try {
    res = claudeWtSessions();
  } catch (e) {
    return { error: e.message };
  }
  if (!res.ok) return { error: res.reason };
  const open = res.sessions.filter(s => s.open && s.windowId);
  let chosen;
  if (ids.length) {
    chosen = [];
    for (const id of ids) {
      const session = open.find(s => s.id === id);
      if (!session) {
        log(`claude-place: сессия ${id} здесь не открыта — пропущена`, 'warn');
        continue;
      }
      chosen.push(session);
    }
  } else {
    chosen = orderSessions(open, normalizeSort(getConfig()?.homeassistant?.sessionsSort));
  }
  const windows = [];
  for (const session of chosen) {
    const w = getWindowById(session.windowId);
    if (!w) {
      log(`claude-place: окно сессии ${session.id} исчезло — пропущено`, 'warn');
      continue;
    }
    windows.push(w);
  }
  return { windows, asked: ids.length || open.length };
}

/**
 * Разложить окна сессий Claude плиткой или каскадом.
 *
 * Двигает `placeWindow()`, а не голый `setBounds()`: он уже умеет пропуск
 * свёрнутых окон, пропуск «уже стоит там», поправку масштаба при переезде
 * между экранами с разным DPI, повтор при промахе и строку журнала в
 * привычном формате `from → to`. Второй раз поправлять масштаб здесь нельзя.
 *
 * `isBulk: true` глушит bringToTop() внутри: плитке он не нужен вовсе
 * (перекрытий нет), а каскаду нужен порядком, поэтому окна поднимаются
 * отдельным проходом — в порядке списка, так что последнее оказывается сверху.
 */
async function arrangeClaudeWindows({ mode, ids = [], log = () => {} }) {
  const zones = resolveZones(log, mode);
  const work = layoutWorkArea(zones, log);
  if (!work && (mode === 'cascade' || !zones.length)) {
    return { ok: false, reason: 'не найден монитор для раскладки' };
  }
  const { error, windows, asked } = pickWindows(ids, log);
  if (error) return { ok: false, reason: error };
  if (!windows.length) return { ok: false, reason: 'открытых сессий claude нет' };

  const rects = arrange({ mode, zones, work, n: windows.length });
  let placed = 0;
  for (let i = 0; i < windows.length; i += 1) {
    const pos = rects[i];
    if (!pos) break;
    // Одно упавшее окно не обрывает остальные — та же сетка, что в
    // placeWindowsByConfig(): процесс окна мог умереть между перечислением и
    // расстановкой.
    const result = await placeWindow({ w: windows[i], rule: { pos }, isBulk: true })
      .catch(e => { log(`claude-place: ${windows[i].id} — ${e.message}`, 'error'); return false; });
    // placeWindow() пропускает слишком узкие окна (false), свёрнутые и уже
    // стоящие там (skipped, changes пуст) — считаем разложенными только те,
    // для которых реально был отдан bounds-changes, иначе «N из M» врёт.
    if (result && result.changes?.some(c => c.name === 'bounds')) placed += 1;
  }
  if (mode === 'cascade') {
    for (const w of windows) {
      try {
        w.bringToTop();
      } catch (e) {
        log(`claude-place: ${w.id} не поднялось — ${e.message}`, 'warn');
      }
    }
  }
  log(`claude-place ${mode}: разложено ${placed} из ${asked}`);
  return { ok: true, placed };
}

export { arrangeClaudeWindows };
