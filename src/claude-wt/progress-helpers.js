/** Pure helper functions for agent progress state. No external I/O. */

// Состояния, которые пишет хук wt-progress.sh на стороне агента. Всё
// остальное (включая его собственный `unknown`) для картинки — не состояние:
// рисовать по нему кружок было бы враньём, а не осторожностью.
const AGENT_STATES = ['active', 'question', 'review', 'idle'];

/**
 * Привести запись хука к тому, на что можно смотреть.
 *
 * Файл пишет чужой процесс на другой машине, поэтому доверия к форме нет:
 * незнакомое состояние и нечисловое время отбрасываются молча, а запись без
 * обоих полей превращается в `null` — «данных нет» отличается от «данные
 * говорят idle», и в списке это разные кружки.
 */
function normalizeProgress(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const state = AGENT_STATES.includes(raw.state) ? raw.state : null;
  const updated = Number.isFinite(raw.updated) ? raw.updated : 0;
  if (!state && !updated) return null;
  return {
    state,
    updated,
    event: typeof raw.event === 'string' ? raw.event : '',
    message: typeof raw.message === 'string' ? raw.message : '',
  };
}

/**
 * Когда сессия последний раз подавала признаки жизни, в epoch-секундах.
 *
 * Хук знает это точнее: он срабатывает на события самого агента, тогда как
 * `lastSeen` слота — это «трекер видел окно», то есть отметка обновляется,
 * даже когда в окне ничего не происходит. Но хук может быть не установлен или
 * ещё не сработать, и тогда слот — единственное, что есть.
 */
function lastActivityAt(slot, progress) {
  const fromHook = progress?.updated ?? 0;
  const fromSlot = Number.isFinite(slot?.lastSeen) ? slot.lastSeen : 0;
  return Math.max(fromHook, fromSlot) || null;
}

/**
 * Видел ли человек то состояние, в котором сейчас находится сессия.
 *
 * Окно, вышедшее на передний план после последней записи агента, — это
 * «посмотрел». Тот же признак использует сам Windows: подсветка кнопки на
 * таскбаре гаснет при переходе на окно, а не по таймеру.
 *
 * Сравнение нестрогое: обе метки в секундах, и переход в ту же секунду, что и
 * запись состояния, — это всё-таки переход после неё.
 *
 * Без данных агента вопрос не имеет смысла: показывать нечего, а значит и
 * увидеть было нечего.
 */
function seenSinceUpdate(slot, progress) {
  const updated = progress?.updated ?? 0;
  if (!updated) return false;
  const focusedAt = Number.isFinite(slot?.focusedAt) ? slot.focusedAt : 0;
  return focusedAt >= updated;
}

export { AGENT_STATES, normalizeProgress, lastActivityAt, seenSinceUpdate };
