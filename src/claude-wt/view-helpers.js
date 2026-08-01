/** Pure helpers for the session picker view. No external I/O. */
import { lastActivityAt } from './progress-helpers.js';

/**
 * Monitor number for a window, taken from its centre point.
 *
 * The top-left corner lands on the neighbouring monitor for any window that
 * straddles a seam, and outside every monitor for one left at coordinates from
 * a display that is gone. The centre is right in both cases.
 *
 * `mons` is the getMons() array: index 0 is a placeholder, so the index of a
 * monitor is the number used in placement rules.
 */
function monitorNumberForBounds(mons, bounds) {
  if (!bounds) return null;
  const x = bounds.x + Math.floor(bounds.width / 2);
  const y = bounds.y + Math.floor(bounds.height / 2);
  for (let i = 1; i < (mons?.length ?? 0); i++) {
    const b = mons[i]?.bounds;
    if (!b) continue;
    if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) return i;
  }
  return null;
}

function buildSessionList({ slots, openMap, mons, progress = {} }) {
  return Object.entries(slots ?? {}).map(([id, slot]) => {
    const bounds = slot.bounds ?? null;
    const monitor = monitorNumberForBounds(mons, bounds);
    const agent = progress[id] ?? null;
    return {
      id,
      title: slot.titles?.[0] ?? '',
      cwd: slot.cwd ?? '',
      bounds,
      desktop: slot.desktop ?? null,
      monitor,
      monitorBounds: monitor === null ? null : (mons[monitor]?.bounds ?? null),
      open: openMap.has(id),
      windowId: openMap.get(id) ?? null,
      // Что делает агент внутри окна: active | question | review | idle, либо
      // null, когда хук состояний не установлен или ещё не сработал.
      agentState: agent?.state ?? null,
      // Событие хука, из которого состояние получилось (tool-start, attention,
      // stop…). Состояние — это вывод, событие — исходник; в подсказке видно,
      // почему кружок такой.
      agentEvent: agent?.event ?? '',
      // Текст уведомления. Осмыслен только у attention: «Claude needs your
      // permission» против «Claude is waiting for your input» — единственное,
      // что отличает жёлтый кружок от серого.
      agentMessage: agent?.message ?? '',
      // Epoch-секунды. Пикер показывает возраст относительно now, поэтому
      // отдаём метку времени, а не отформатированную строку: форматирование
      // на секунду устаревает быстрее, чем долетает.
      lastActivity: lastActivityAt(slot, agent),
    };
  });
}

export { monitorNumberForBounds, buildSessionList };
