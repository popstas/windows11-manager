/** Pure helpers for session meta written on SessionStart. No external I/O. */

/**
 * Привести `<id>.meta.json` к тому, на что можно смотреть.
 *
 * Файл пишет хук на другой машине в момент SessionStart. Нужна только
 * отметка старта сессии — для сортировки oldest/newest в пикере. Всё
 * остальное (cwd, transcript, host) пикеру из метаданных не нужно: cwd уже
 * есть в слоте, а путь к транскрипту он не показывает.
 */
function normalizeMeta(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const started = Number.isFinite(raw.started) ? raw.started : 0;
  if (!started) return null;
  return { started };
}

export { normalizeMeta };
