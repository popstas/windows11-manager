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
    // Первая строка последнего ответа агента, одной строкой и без разметки.
    // Считает её хук, а не мы: транскрипты бывают на мегабайты и лежат на
    // сетевом диске, а у него тот же файл под рукой локально.
    //
    // Длина не ограничена ничем, кроме страховки в двести знаков: у каждого,
    // кто это показывает, своя ширина, и обрезает он сам — многоточием по
    // месту, а не вслепую на стороне хука.
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    // На чём сессия остановилась в прошлый раз. В отличие от `summary`, не
    // стирается у работающей: та отвечает «что говорит сейчас», и у неё
    // честный ответ — ничего, а этот вопрос всё равно кто-нибудь задаст.
    lastSummary: typeof raw.lastSummary === 'string' ? raw.lastSummary : '',
    // Последний запрос человека, одной строкой. Считает хук из транскрипта
    // рядом со сводкой ответа. Не стирается у работающей: вопрос уже задан,
    // и пикер показывает его под карточкой вместе с ответом.
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    // Сколько сессия стоила и насколько забит её контекст. Хуку этого не дают
    // — в его stdin нет ни токенов, ни денег; числа приходят от перехватчика
    // статуслайна и попадают в тот же файл (claude-wt-statusline.sh).
    //
    // Уже округлены на той стороне: доллары до доллара, проценты до процента.
    // Ноль здесь — «данных нет»: у сессии без перехватчика полей не будет
    // вовсе, а показывать «$0 0%» значило бы утверждать, что она бесплатна.
    costUsd: Number.isFinite(raw.costUsd) ? raw.costUsd : 0,
    contextPct: Number.isFinite(raw.contextPct) ? raw.contextPct : 0,
  };
}

/**
 * Что сессия говорит о себе одной строкой.
 *
 * Свежая сводка, а у работающей её нет: `summary` отвечает за текущий ход, а он
 * ещё идёт. Тогда берётся последняя известная — «на чём остановилась» полезнее
 * пустоты, и спрашивают ровно это.
 *
 * Считается здесь, чтобы строка была одна на всех читателей: пикер склеивал
 * `summary || lastSummary` у себя, а панель openHASP брала голый `summary` — и у
 * работающей сессии её строка на плате оставалась пустой (`-`), хотя в пикере
 * текст был.
 */
function sessionDescription(progress) {
  const summary = typeof progress?.summary === 'string' ? progress.summary.trim() : '';
  if (summary) return summary;
  return typeof progress?.lastSummary === 'string' ? progress.lastSummary.trim() : '';
}

/**
 * Когда сессия последний раз подавала признаки жизни, в epoch-секундах.
 *
 * Хук знает это точнее: он срабатывает на события самого агента. `lastSeen`
 * слота — «трекер видел окно», и у открытых сессий он обновляется каждую
 * секунду, даже когда в окне ничего не происходит. Берём хук, если он есть;
 * слот — только запасной вариант, пока хук не установлен или ещё не сработал.
 */
function lastActivityAt(slot, progress) {
  const fromHook = progress?.updated ?? 0;
  if (fromHook) return fromHook;
  const fromSlot = Number.isFinite(slot?.lastSeen) ? slot.lastSeen : 0;
  return fromSlot || null;
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

export {
  AGENT_STATES, normalizeProgress, sessionDescription, lastActivityAt, seenSinceUpdate,
};
