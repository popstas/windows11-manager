/**
 * Раскладка группы «head + дети» по просьбе `claude-place` с `mode: "group"`.
 *
 * Иерархию знает пикер, а фокус — эта машина: пикер шлёт все группы и
 * подсвеченную строку, а группу выбирает менеджер — первую с `selected`,
 * иначе первую с сессией активного окна. Пока пикер скрыт, его снимок окон
 * отстаёт, а активное окно здесь известно точно.
 *
 * Head встаёт в первую зону пары своего монитора, дети стопкой во вторую
 * (`groupPlan`). Двигаются только окна группы. Ребёнок с другого стола едет
 * на стол head. Подъём и фокус — только если человек сейчас на столе head:
 * иначе `bringToTop()` утащил бы его туда.
 */
import { claudeWtSessions } from './view.js';
import { getWindowById, getActiveWindowId, focusWindowById } from '../windows.js';
import { placeWindow } from '../placement.js';
import { virtualDesktop } from '../virtual-desktop.js';
import { getClaudeWtConfig } from './index.js';
import { resolveHeadLayout } from './head-zones.js';
import { isMinimized } from '../windows-helpers.js';
import { pickFocusTarget } from '../claude-layout-helpers.js';
import { locateWindow, pickGroup, groupPlan } from './head-zones-helpers.js';

const DEFAULT_DEPS = {
  cfg: () => getClaudeWtConfig(),
  layout: opts => resolveHeadLayout(opts),
  sessions: opts => claudeWtSessions(opts),
  getWindow: id => getWindowById(id),
  activeId: () => getActiveWindowId(),
  desktopOf: id => virtualDesktop.GetWindowDesktopNumber(id),
  place: opts => placeWindow(opts),
  focus: id => focusWindowById(id),
};

const TAG = 'claude-place group';

function boundsOf(w) {
  try {
    const b = w?.getBounds?.();
    return b && !isMinimized(b) ? b : null;
  } catch {
    return null;
  }
}

async function currentDesktop(d, activeId) {
  if (!activeId) return null;
  try {
    const num = await d.desktopOf(activeId);
    return num === undefined || num === null || num === '' ? null : Number(num) + 1;
  } catch {
    return null;
  }
}

/** Пара зон монитора, обе разрешённые сейчас, или null. */
function pairRects(layout, headZones, monitor) {
  const pair = headZones?.[monitor];
  if (!pair) return null;
  const find = p => layout.zones.find(z => z.monitor === monitor && z.position === p)?.rect;
  const first = find(pair[0]);
  const second = find(pair[1]);
  return first && second ? { first, second } : null;
}

/**
 * @param {{ groups: string[][], selected: string|null, log: Function }} opts
 * @returns {Promise<{ ok: true, placed: number } | { ok: false, reason: string }>}
 */
async function arrangeGroup({ groups, selected, log = () => {} }, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  // Причины — без префикса: команда пишет их строкой `claude-place group: …`.
  if (!groups?.length) return { ok: false, reason: 'группы не переданы' };
  const activeBefore = d.activeId();
  const res = d.sessions({ brief: true });
  if (!res?.ok) return { ok: false, reason: res?.reason ?? 'список сессий не прочитался' };
  const open = res.sessions.filter(s => s.open && s.windowId);
  const activeSession = open.find(s => s.windowId === activeBefore)?.id ?? null;
  const group = pickGroup({ groups, selected, activeId: activeSession });
  if (!group) return { ok: false, reason: 'ни одна группа не содержит выбранную или активную сессию' };

  const [headId, ...kidIds] = group;
  const hs = open.find(s => s.id === headId);
  const headW = hs ? d.getWindow(hs.windowId) : null;
  const headRect = boundsOf(headW);
  if (!headRect) return { ok: false, reason: `окно head ${headId} здесь не открыто или свёрнуто` };

  const cfg = d.cfg();
  const layout = d.layout({ headZones: cfg.headZones, problems: cfg.headZonesProblems, log });
  if (!layout) return { ok: false, reason: 'основные зоны (claudeWt.headZones) не разрешились' };
  const monitor = locateWindow(headRect, layout).monitor;
  let rects = pairRects(layout, cfg.headZones, monitor);
  if (!rects) {
    const fallback = Object.keys(cfg.headZones).map(Number).sort((a, b) => a - b)
      .find(m => pairRects(layout, cfg.headZones, m));
    if (fallback === undefined) return { ok: false, reason: 'ни у одного монитора headZones нет обеих зон' };
    log(`${TAG}: монитор head (${monitor ?? '?'}) не в claudeWt.headZones — раскладываю на мониторе ${fallback}`, 'warn');
    rects = pairRects(layout, cfg.headZones, fallback);
  }

  const headDesktop = hs.desktop ?? null;
  const kids = [];
  for (const id of kidIds) {
    const s = open.find(x => x.id === id);
    if (!s) {
      log(`${TAG}: сессия ${id} здесь не открыта — пропущена`);
      continue;
    }
    const w = d.getWindow(s.windowId);
    if (!boundsOf(w)) {
      log(`${TAG}: окно сессии ${id} свёрнуто или исчезло — пропущено`);
      continue;
    }
    kids.push({ w, desktop: s.desktop ?? null });
  }
  const plan = groupPlan({ first: rects.first, second: rects.second, n: kids.length });
  // Текущий стол — до переносов: активное окно может быть ребёнком, который
  // сейчас уедет на стол head, и вопрос «где человек» после этого отвечал бы
  // столом head — подъём утащил бы человека туда.
  const current = await currentDesktop(d, activeBefore);

  let placed = 0;
  const put = async (w, rule) => {
    try {
      const r = await d.place({ w, rule, isBulk: true });
      if (r?.changes?.some(c => c.name === 'bounds')) placed += 1;
    } catch (e) {
      log(`${TAG}: ${w.id} — ${e.message}`, 'error');
    }
  };
  await put(headW, { pos: plan.head });
  for (let i = 0; i < kids.length; i += 1) {
    const { w, desktop } = kids[i];
    const move = headDesktop != null && desktop != null && desktop !== headDesktop;
    await put(w, { pos: plan.children[i], ...(move ? { desktop: headDesktop } : {}) });
  }

  // Стол не узнался — не поднимать: подъём окна с чужого стола уводит туда
  // оболочку, а угадывать за человека, где он, незачем.
  if (headDesktop == null || current === headDesktop) {
    const all = [headW, ...kids.map(k => k.w)];
    for (const w of all) {
      try {
        w.bringToTop();
      } catch (e) {
        log(`${TAG}: ${w.id} не поднялось — ${e.message}`, 'warn');
      }
    }
    const focusId = pickFocusTarget(all.map(w => w.id), activeBefore);
    if (focusId !== null && !d.focus(focusId)) log(`${TAG}: фокус не дошёл до окна ${focusId}`, 'warn');
  }
  log(`${TAG}: head ${hs.title ?? headId}, детей ${kids.length} из ${kidIds.length}`);
  return { ok: true, placed };
}

export { arrangeGroup };
