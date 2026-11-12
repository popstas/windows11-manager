/**
 * Окно ребёнка head-сессии: куда его поставить и кого из братьев подвинуть.
 *
 * Зовётся из хвоста `session-new` (`focusSpawnedWindow`, хук `place`), когда
 * окно нового терминала уже нашлось по имени сессии. Порядок решения — по
 * спеке (`docs/superpowers/specs/2026-11-11-claude-wt-head-zones-design.md`):
 * явная `zone`, иначе `claudeWt.childPlacement` — `stack` (соседняя основная
 * зона монитора head) или `free` (свободная основная зона). Арифметика — в
 * `head-zones-helpers.js`, здесь только чтение живых окон и расстановка.
 *
 * Три правила, за которые здесь отвечает каждая строка:
 * - head не двигается никогда — его нет среди `moves` по построению;
 * - чужие окна не двигаются — переставляются только дети этого head;
 * - окно встаёт на стол head, а фокус и подъём — только если человек сейчас
 *   на том же столе: иначе фокус увёл бы его на чужой стол.
 *
 * Ответ `null` значит «плана нет»: зовущий ставит окно по-старому (курсор
 * или слот), а причина уже в журнале строкой warn.
 */
import { claudeWtSessions } from './view.js';
import { getWindowById, getActiveWindowId } from '../windows.js';
import { placeWindow } from '../placement.js';
import { virtualDesktop } from '../virtual-desktop.js';
import { markNoAutoplace } from '../no-autoplace.js';
import { getClaudeWtConfig, isTerminalWindow } from './index.js';
import { resolveHeadLayout } from './head-zones.js';
import { readChildren, recordChild, childrenOfHead } from './child-registry.js';
import { isMinimized } from '../windows-helpers.js';
import {
  MAX_SLOTS, locateWindow, stackPlan, overlayPos, pickStackZone, freeCandidates, pickFreeZone, zoneKey,
  zonesCovered,
} from './head-zones-helpers.js';

const noTiming = () => 0;

const defaultLog = (message, level = 'info') => {
  if (level === 'warn' || level === 'error') console.warn(message);
  else console.log(message);
};

const DEFAULT_DEPS = {
  cfg: () => getClaudeWtConfig(),
  layout: opts => resolveHeadLayout(opts),
  sessions: opts => claudeWtSessions(opts),
  getWindow: id => getWindowById(id),
  activeId: () => getActiveWindowId(),
  desktopOf: id => virtualDesktop.GetWindowDesktopNumber(id),
  place: opts => placeWindow(opts),
  markNoAutoplace: id => markNoAutoplace(id),
  readChildren: () => readChildren(),
  recordChild: entry => recordChild(entry),
  isTerminal: w => isTerminalWindow(w),
  now: () => Date.now(),
};

function boundsOf(w) {
  try {
    const b = w?.getBounds?.();
    return b && !isMinimized(b) ? b : null;
  } catch {
    return null; // процесс окна умер между перечислением и этой строкой
  }
}

/** Текущий стол, 1-based, по активному окну; null — не узнать. */
async function currentDesktop(d) {
  try {
    const id = d.activeId();
    if (!id) return null;
    const num = await d.desktopOf(id);
    return num === undefined || num === null || num === '' ? null : Number(num) + 1;
  } catch {
    return null;
  }
}

let queue = Promise.resolve();

/**
 * Хвосты исполняются строго по одному. Head открывает трёх детей за
 * секунды, и без очереди оба хвоста посчитали бы одно и то же `k` и встали бы
 * друг на друга. Ошибка одного очередь не рвёт.
 *
 * @param {object} w окно нового терминала (node-window-manager)
 * @param {{ sessionId: string, headId: string|null, zone: {monitor:number, position:number}|null,
 *   name: string, mark?: Function, log?: Function }} opts
 * @returns {Promise<{ desktop: number|null, focus: boolean }|null>}
 */
function placeChildWindow(w, opts, deps = {}) {
  const run = () => placeChildNow(w, opts, { ...DEFAULT_DEPS, ...deps });
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

async function placeChildNow(w, { sessionId, headId, zone, name, mark = noTiming, log = defaultLog }, d) {
  const tag = `claude-wt session-new ${name}`;
  const fallback = (why) => {
    log(`${tag}: ${why} — окно ставится как раньше`, 'warn');
    return null;
  };
  const cfg = d.cfg();
  const layout = d.layout({ headZones: cfg.headZones, problems: cfg.headZonesProblems, log });
  if (!layout) return fallback('основные зоны (claudeWt.headZones) не разрешились');
  mark('child:layout');

  const res = d.sessions({ brief: true });
  const open = res?.ok ? res.sessions.filter(s => s.open && s.windowId) : [];
  const sessionByWindow = new Map(open.map(s => [s.windowId, s]));

  // Окно head: его монитор, зона и стол решают всё остальное.
  let head = null;
  if (headId) {
    const hs = open.find(s => s.id === headId);
    const rect = hs ? boundsOf(d.getWindow(hs.windowId)) : null;
    if (rect) head = { windowId: hs.windowId, rect, desktop: hs.desktop ?? null, loc: locateWindow(rect, layout) };
  }
  if (!head && !zone) return fallback(`окно head ${headId ?? '?'} здесь не найдено или свёрнуто`);
  const headDesktop = head?.desktop ?? null;
  const current = await currentDesktop(d);
  mark('child:desktop');
  const onHeadDesktop = desk => headDesktop == null || desk == null || desk === headDesktop;

  // Свои дети — из реестра, только живые терминалы со стола head.
  const own = [];
  if (headId) {
    for (const e of childrenOfHead(d.readChildren(), headId, d.now())) {
      if (e.sessionId === sessionId || e.windowId === w.id) continue;
      const cw = d.getWindow(e.windowId);
      if (!cw || !d.isTerminal(cw)) continue;
      const rect = boundsOf(cw);
      if (!rect) continue;
      if (!onHeadDesktop(sessionByWindow.get(e.windowId)?.desktop ?? e.desktop)) continue;
      own.push({ id: e.sessionId, w: cw, rect, loc: locateWindow(rect, layout) });
    }
  }
  const ownWindows = new Set(own.map(o => o.w.id));
  // Всё прочее со стола head — чужие, включая самого head.
  const foreign = [];
  for (const s of open) {
    if (ownWindows.has(s.windowId) || s.windowId === w.id) continue;
    if (!onHeadDesktop(s.desktop)) continue;
    const rect = s.windowId === head?.windowId ? head.rect : boundsOf(d.getWindow(s.windowId));
    if (rect) foreign.push({ rect, loc: locateWindow(rect, layout) });
  }
  const inZone = (loc, z) => loc.monitor === z.monitor && loc.zone === z.position;
  // Чем занята зона для free: чужие — по `zonesCovered` (развёрнутый head
  // занимает обе зоны монитора), свои вне зон — туда же, как чужие: их правило
  // стопки не переставляет, а место они закрывают.
  const blockers = [...foreign, ...own.filter(o => o.loc.zone == null)]
    .map(f => new Set(zonesCovered(f.rect, f.loc, layout.zones).map(z => zoneKey(z.monitor, z.position))));
  const blockedBy = z => blockers.filter(b => b.has(zoneKey(z.monitor, z.position))).length;
  const findZone = z => z && layout.zones.find(r => r.monitor === z.monitor && r.position === z.position);

  let target = null;
  let how = 'stack';
  let mode;
  if (zone) {
    mode = 'zone';
    target = findZone(zone);
    if (!target) return fallback(`зона ${zoneKey(zone.monitor, zone.position)} сейчас не разрешилась`);
  } else if (cfg.childPlacement === 'free') {
    mode = 'free';
    let candidates = freeCandidates({ headZones: cfg.headZones, headMonitor: head.loc.monitor, available: layout.zones });
    // Зону самого head режим free не делит, пока есть другие варианты.
    const others = candidates.filter(z => !inZone(head.loc, z));
    if (others.length) candidates = others;
    const occupancy = new Map(candidates.map(z => [zoneKey(z.monitor, z.position), {
      own: own.filter(o => inZone(o.loc, z)).length,
      foreign: blockedBy(z),
    }]));
    const picked = pickFreeZone({ candidates, occupancy });
    if (!picked) return fallback('свободной основной зоны нет');
    target = picked.zone;
    how = picked.how;
  } else {
    // deck выбирает зону так же, как stack, — вторую основную зону монитора
    // head; отличается только тем, что зона не делится (ниже).
    mode = cfg.childPlacement === 'deck' ? 'deck' : 'stack';
    const z = pickStackZone({ headLoc: head.loc, headZones: cfg.headZones });
    if (!z) return fallback(`монитор head (${head.loc.monitor ?? '?'}) не в claudeWt.headZones`);
    target = findZone(z);
    if (!target) return fallback(`зона ${zoneKey(z.monitor, z.position)} сейчас не разрешилась`);
  }

  // deck (Стас 12.11): ребёнок занимает зону целиком, братья не ужимаются и не
  // двигаются, новый оказывается сверху. С явной зоной — так же: «зона не
  // делится» — свойство режима, а не способа выбрать зону.
  if (cfg.childPlacement === 'deck' && how === 'stack') how = 'deck';

  const ownIn = own.filter(o => inZone(o.loc, target));
  let plan;
  let slot;
  let places;
  if (how === 'deck') {
    plan = { moves: [], pos: target.rect };
    slot = 1;
    places = 1;
  } else if (how === 'overlay') {
    const count = ownIn.length + blockedBy(target);
    plan = { moves: [], pos: overlayPos(target.rect, count) };
    slot = (count % MAX_SLOTS) + 1;
    places = MAX_SLOTS;
  } else {
    plan = stackPlan({ zone: target.rect, own: ownIn.map(o => ({ id: o.id, rect: o.rect })) });
    const k = ownIn.length;
    slot = k >= MAX_SLOTS ? (k % MAX_SLOTS) + 1 : k + 1;
    places = Math.min(k + 1, MAX_SLOTS);
  }

  // Автопостановщик и демон про эту расстановку не знают: без пометки окно
  // через секунду уехало бы по правилу из config.windows.
  d.markNoAutoplace(w.id);
  for (const move of plan.moves) {
    const brother = ownIn.find(o => o.id === move.id);
    try {
      await d.place({ w: brother.w, rule: { pos: move.pos }, isBulk: true });
    } catch (e) {
      log(`${tag}: брат ${move.id} не переставлен — ${e.message}`, 'warn');
    }
  }
  await d.place({ w, rule: { pos: plan.pos, ...(headDesktop ? { desktop: headDesktop } : {}) }, isBulk: true });
  mark('child:place');
  if (headId) d.recordChild({ sessionId, headId, windowId: w.id, desktop: headDesktop ?? current });

  let modeTail = mode;
  if (how === 'overlay') modeTail = `${mode}, поверх`;
  else if (how === 'deck' && mode !== 'deck') modeTail = `${mode}, deck`;
  log(`${tag}: зона ${zoneKey(target.monitor, target.position)} (${modeTail}), место ${slot} из ${places}, стол ${headDesktop ?? current ?? '?'}`);
  // Фокус — только если стол head известен совпадающим с текущим (или стола
  // нет вовсе). Текущий стол не узнался — без фокуса: focusTerminalWindow
  // зовёт GoToDesktopNumber и увёл бы человека на стол head.
  return { desktop: headDesktop, focus: headDesktop == null || headDesktop === current };
}

export { placeChildWindow };
