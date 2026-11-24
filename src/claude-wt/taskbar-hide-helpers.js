/**
 * Чистые решения «какие кнопки панели задач прятать» (без I/O): служба
 * (Task 4) собирает из них план DeleteTab/AddTab. Кнопку прячет погашенная
 * сессия, у которой нет сигнала человеку: вопрос или непросмотренный итог
 * кнопку возвращают — иначе их не увидеть.
 */
import { isSessionUuid } from './session-name-helpers.js';

/** Набор sessionId из тела запроса `{ sessions: [...] }`; прочее отброшено. */
function parseHideSet(body) {
  const out = new Set();
  const list = body && typeof body === 'object' ? body.sessions : null;
  if (!Array.isArray(list)) return out;
  for (const id of list) if (isSessionUuid(id)) out.add(id);
  return out;
}

/** Сессия зовёт человека: вопрос или непросмотренное «готово». */
function hasSignal({ agentState, agentSeen } = {}) {
  if (agentState === 'question') return true;
  return agentState === 'review' && !agentSeen;
}

/**
 * Следующее состояние явной отметки. `hide` живёт, пока сессия не оживёт
 * после паузы: увидели не-active, потом active — отметка снимается (null).
 */
function nextExplicit(entry, agentState) {
  if (!entry || entry.mode !== 'hide') return entry;
  if (agentState !== 'active') return entry.sawIdle ? entry : { ...entry, sawIdle: true };
  return entry.sawIdle ? null : entry;
}

/** Набор hwnd окон, кнопки которых должны быть спрятаны. */
function wantedHidden({ sessions, set, explicitOf, signalOf }) {
  const out = new Set();
  for (const { id, sessionId } of sessions) {
    if (signalOf(sessionId)) continue;
    const mode = explicitOf(sessionId)?.mode;
    if (mode === 'hide' || (!mode && set.has(sessionId))) out.add(id);
  }
  return out;
}

/**
 * Что сделать с кнопками: `remove` — спрятать, `add` — вернуть. Только окна,
 * что ещё есть (`present`). `reapply` — спрятать заново и уже спрятанные
 * (после перезапуска explorer кнопки возвращаются сами).
 */
function planTabs(hidden, wanted, present, reapply) {
  const byNum = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const remove = [...wanted].filter(h => present.has(h) && (reapply || !hidden.has(h))).sort(byNum);
  const add = [...hidden].filter(h => present.has(h) && !wanted.has(h)).sort(byNum);
  return { remove, add };
}

export { parseHideSet, hasSignal, nextExplicit, wantedHidden, planTabs };
