/**
 * Перенос уже открытого окна сессии в зону FancyZones: `claude-place` с
 * `mode: "zone"`, тело `{mode, id, zone: {monitor, position}}`.
 *
 * Просит его CLI агента (`claude-wt window place <session> --zone m:p`), и
 * ответ ему нужен точный: `{ok:true, placed, zone}` или `{ok:false, reason}`.
 * `placed: 0` значит только «окно уже стояло там» — свёрнутое, слишком
 * узкое и пропавшее окно отвечают отказом с причиной, а не нулём.
 *
 * Чем отличается от зоны ребёнка в `session-new` (`child-place.js`):
 * - зона не обязана быть в `claudeWt.headZones` — достаточно, чтобы она была в
 *   раскладке FancyZones подключённого монитора (`resolveZone`);
 * - братья и head не двигаются, стопки нет: окно занимает зону целиком;
 * - стол окна не меняется, подъёма и фокуса нет: ввод остаётся у человека, а
 *   подъём окна с чужого стола увёл бы туда оболочку.
 *
 * Причина `no window` — дословная: CLI переводит её в код 2.
 */
import { claudeWtSessions } from './view.js';
import { getWindowById } from '../windows.js';
import { placeWindow } from '../placement.js';
import { markNoAutoplace } from '../no-autoplace.js';
import { isMinimized } from '../windows-helpers.js';
import { resolveZone } from './head-zones.js';
import { zoneKey } from './head-zones-helpers.js';

const DEFAULT_DEPS = {
  sessions: opts => claudeWtSessions(opts),
  getWindow: id => getWindowById(id),
  resolveZone: zone => resolveZone(zone),
  place: opts => placeWindow(opts),
  markNoAutoplace: id => markNoAutoplace(id),
};

const TAG = 'claude-place zone';

/**
 * @param {{ id: string|null, zone: {monitor:number, position:number}|null, log?: Function }} opts
 * @returns {Promise<{ok: true, placed: number, zone: string} | {ok: false, reason: string}>}
 */
async function placeSessionInZone({ id, zone, log = () => {} }, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  if (!id) return { ok: false, reason: 'no id: zone mode needs the session id' };
  if (!zone) return { ok: false, reason: 'no zone: need {monitor, position}, integers from 1' };
  const key = zoneKey(zone.monitor, zone.position);

  const res = d.sessions({ brief: true });
  if (!res?.ok) return { ok: false, reason: res?.reason ?? 'sessions could not be read' };
  const s = res.sessions.find(x => x.id === id && x.open && x.windowId);
  const w = s ? d.getWindow(s.windowId) : null;
  if (!w) return { ok: false, reason: 'no window' };
  let bounds;
  try {
    bounds = w.getBounds();
  } catch {
    return { ok: false, reason: 'no window' }; // процесс окна умер между перечислением и этой строкой
  }
  if (isMinimized(bounds)) return { ok: false, reason: 'window is minimized' };

  const z = d.resolveZone(zone);
  if (z.error) return { ok: false, reason: z.error };

  // Демон при первой привязке окна тащит его в запомненные границы, а
  // автопостановщик — по правилу из config.windows. Окну, открытому меньше
  // минуты назад, это ещё грозит: пометка его бережёт.
  d.markNoAutoplace(w.id);
  let r;
  try {
    r = await d.place({ w, rule: { pos: z.rect }, isBulk: true });
  } catch (e) {
    return { ok: false, reason: `window was not moved: ${e.message}` };
  }
  // placeWindow() отвечает false окну шириной меньше 250 px и не двигает его.
  if (!r) return { ok: false, reason: 'window is too narrow to place' };
  if (r.skipped?.some(c => c.name === 'bounds')) return { ok: false, reason: 'window is minimized' };
  const placed = r.changes?.some(c => c.name === 'bounds') ? 1 : 0;
  log(`${TAG}: ${s.title ?? id} → зона ${key}${placed ? '' : ' (уже там)'}`);
  return { ok: true, placed, zone: key };
}

export { placeSessionInZone };
