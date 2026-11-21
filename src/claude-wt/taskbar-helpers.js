/**
 * Кнопка окна WezTerm на панели задач по состоянию агента. Без I/O.
 *
 * Windows Terminal рисует это сам: хук ~/.claude/hooks/wt-progress.sh шлёт
 * ConEmu OSC 9;4, wt выводит его на кнопку и мигает ей на звонке. WezTerm
 * (20240203 и даже nightly) OSC 9;4 на панель задач не выводит, а на звонок
 * только пищит, поэтому для его окон то же самое делает служба
 * windows11-manager (src/mqtt/taskbar.js) по hwnd. Окна wt не трогаются:
 * у кнопки был бы второй хозяин.
 */

// TBPFLAG из ITaskbarList3::SetProgressState.
const TBPF = { none: 0, indeterminate: 1, normal: 2, error: 4, paused: 8 };

const NONE = { state: 'none', value: 0, flash: false };

/**
 * Состояние агента → вид кнопки. Значения те же, что у хука: 9;4;1;100 на
 * работе, 9;4;4;22 и звонок на вопросе, 9;4;0;0 на остальном, 9;4;3;0 на
 * незнакомом событии.
 *
 * `review` (ход закончен) без полосы, но с миганием, пока окно не выходило
 * вперёд (`seen`): в wt оранжевую кнопку давал звонок Claude Code на конец хода
 * (`preferredNotifChannel: terminal_bell`) при `bellStyle: taskbar`, а WezTerm
 * на звонок кнопкой не мигает. Просмотренное не мигает: иначе каждый
 * перезапуск службы зажигал бы давно прочитанные окна.
 *
 * `idle` мигание не трогает (`flash: null` — «как было»): через минуту после
 * конца хода хук переводит сессию в idle уведомлением «waiting for your
 * input», хотя на окно никто не смотрел, и выключать на этом мигание значило
 * бы гасить оранжевый, который в wt держался до фокуса. Гаснет он сам, когда
 * окно выходит вперёд.
 *
 * `mark` — отметка человека из ccfzf-picker, действующая, пока хук не написал
 * новое (`markHolds`). `seen` (Shift+клик «Mark seen») гасит свет в любом
 * состоянии, `unread` («Mark unread») зажигает его у review и idle, даже
 * просмотренных (Стас 16.11: «синхронизация на оба состояния»). Полосу отметки
 * не трогают: она про то, что агент делает, а не про то, видел ли человек.
 * Раньше «отпущено» было только сравнением с `seen`, и idle с его `null` его
 * перекрывал: Shift+клик через минуту после конца хода кнопку не гасил.
 *
 * `shell` — ход закончен, а фоновая команда агента ещё идёт (признак из дампа
 * ccfzf). У `review` и `idle` он даёт зелёную полосу на 2% (Стас 16.11:
 * «зелёная 2%»): видно, что в окне что-то крутится, но не так громко, как
 * работа на 100. Мигание при этом считается как без него — оранжевый review,
 * seen и unread живут по своим правилам. У `active` и `question` признак
 * ничего не меняет: агент, который работает или спрашивает, `shell` не пишет.
 *
 * `unknown` сюда сейчас не доезжает: normalizeProgress его отбрасывает, и
 * такое окно получает сброс. Ветка оставлена, чтобы соответствие хуку было
 * записано целиком.
 */
const SHELL_VALUE = 2;

function taskbarLook(agentState, seen = false, mark = null, shell = false) {
  const byMark = fallback => (mark === 'seen' ? false : mark === 'unread' ? true : fallback);
  const bar = shell ? { state: 'normal', value: SHELL_VALUE } : { state: 'none', value: 0 };
  switch (agentState) {
    case 'active': return { state: 'normal', value: 100, flash: false };
    case 'question': return { state: 'paused', value: 22, flash: byMark(true) };
    case 'review': return { ...bar, flash: byMark(!seen) };
    case 'idle': return { ...bar, flash: byMark(null) };
    case 'unknown': return { state: 'indeterminate', value: 0, flash: false };
    default: return { ...NONE };
  }
}

function isWeztermPath(path) {
  const name = String(path ?? '').split(/[\\/]/).pop() ?? '';
  return name.toLowerCase() === 'wezterm-gui.exe';
}

const sameLook = (a, b) => a.state === b.state && a.value === b.value && a.flash === b.flash;
const isNone = look => look.state === 'none' && !look.flash;

/**
 * Что поменять на кнопках, чтобы из `applied` стало `wanted`.
 *
 * `applied` и `wanted` — hwnd → вид. `alive` — hwnd, которые сейчас на экране:
 * окну, которое закрыли, звать нечего, а живому окну без сессии закраску надо
 * снять. Мигание включается только на переходе в вопрос: включённое
 * FLASHW_TIMERNOFG гаснет само, когда человек выводит окно вперёд, и включать
 * его заново на каждом тике значило бы мигать уже прочитанным.
 *
 * Вид с `flash: null` берёт мигание у прежнего вида окна (см. `idle`).
 *
 * Операция: {id, state, value, flash: 'on' | 'off' | null}. В `next` остаются
 * только окна с непустым видом.
 */
function planTaskbar(applied, wanted, alive) {
  const ops = [];
  const next = new Map();
  for (const [id, raw] of wanted) {
    const prev = applied.get(id) ?? NONE;
    const look = raw.flash === null ? { ...raw, flash: prev.flash } : raw;
    if (!sameLook(prev, look)) {
      const flash = prev.flash === look.flash ? null : (look.flash ? 'on' : 'off');
      ops.push({ id, state: look.state, value: look.value, flash });
    }
    if (!isNone(look)) next.set(id, look);
  }
  for (const [id, prev] of applied) {
    if (wanted.has(id) || !alive.has(id)) continue;
    ops.push({ id, state: 'none', value: 0, flash: prev.flash ? 'off' : null });
  }
  return { ops, next };
}

/**
 * Действует ли отметка человека (`{kind: 'seen'|'unread', at}`, `at` — секунда
 * просьбы): пока хук не написал новое состояние. Запись хука без времени
 * (`updated` 0) считается старше любой отметки.
 */
function markHolds(mark, updated) {
  if (!mark || !Number.isFinite(mark.at) || mark.at <= 0) return false;
  return mark.at >= (Number.isFinite(updated) ? updated : 0);
}

/**
 * Выбросить отметки, которые уже ничего не значат: хук написал свежее, либо
 * сессии нет среди окон на экране. Карта иначе росла бы всю жизнь службы.
 */
function pruneMarks(marks, agents) {
  const updatedBySession = new Map(agents.map(a => [a.sessionId, a.agentUpdated ?? 0]));
  const next = new Map();
  for (const [id, mark] of marks) {
    if (updatedBySession.has(id) && markHolds(mark, updatedBySession.get(id))) next.set(id, mark);
  }
  return next;
}

/** Снять всё с перечисленных окон: на старте службы и на её остановке. */
function resetOps(ids) {
  return ids.map(id => ({ id, state: 'none', value: 0, flash: 'off' }));
}

/*
 * Мигание перед остыванием кеша промпта (спека ccfzf-picker
 * docs/superpowers/specs/2026-11-21-cache-warn-design.md).
 *
 * Кеш живёт час от последнего ответа ассистента (`cacheAt`, считает ccfzf по
 * хвосту транскрипта и знает только пикер). Пикер присылает набор
 * `{warnMin, sessions: [{id, cacheAt}]}`, а сроки отсчитывает служба: скрытый
 * пикер опрашивает раз в 1–8 минут, и опоздавший набор должен мигать сразу,
 * если порог уже позади, а кеш ещё жив.
 *
 * Мигание — слой поверх вида planTaskbar, а не второй хозяин полосы. Фаза
 * «вкл» — жёлтая полная (`paused 100`), фаза «выкл» и конец мигания —
 * полоса последнего применённого вида:
 *
 *   question          жёлтая 22% (+ оранжевое FlashWindowEx)  → выкл: жёлтая 22%
 *   review            без полосы                              → выкл: без полосы
 *   review/idle+shell зелёная 2%                              → выкл: зелёная 2%
 *   idle              без полосы                              → выкл: без полосы
 *
 * FlashWindowEx слой не трогает: оно всегда оранжевое, жёлтым мигает только
 * полоса (Стас 21.11, по живой пробе на окне srb-post-vnz).
 */

// Те же числа, что у cacheRemainingSec в ccfzf-picker (session-glyph.js):
// вызов, ушедший в последние пять секунд, кеш уже не застанет.
const CACHE_TTL_SEC = 3600;
const CACHE_SAFETY_SEC = 5;
// Конец хода пишет `updated` через доли секунды после метки кеша; состояние
// новее этого запаса — уже следующий ход.
const NEW_TURN_MARGIN_SEC = 30;
const BLINK_MS = 750;
// 60 и больше — мигала бы каждая ждущая сессия весь час.
const MAX_WARN_MIN = 59;

/**
 * Мигать ли кнопке сессии сейчас.
 *
 * `agent` — состояние окна сессии у службы (`{agentState, agentUpdated}`),
 * `null` — окна нет, мигать нечем. Новый ход гасит мигание, даже если набор
 * пикера ещё не обновился: `active` прямо, а законченный ход — по `updated`
 * новее метки. `idle` новым ходом не считается: уведомление «жду ввода»
 * двигает `updated` через минуту после хода без всякого вызова API.
 */
function cacheWarnDue(warn, warnSec, nowSec, agent) {
  if (!agent || !(warnSec > 0)) return false;
  const at = Number(warn?.cacheAt) || 0;
  if (!at) return false;
  const end = at + CACHE_TTL_SEC - CACHE_SAFETY_SEC;
  if (nowSec < end - warnSec || nowSec >= end) return false;
  if (agent.agentState === 'active') return false;
  const updated = Number(agent.agentUpdated) || 0;
  if (agent.agentState !== 'idle' && updated > at + NEW_TURN_MARGIN_SEC) return false;
  return true;
}

/** Полоса кадра мигания: `on` — жёлтая полная, иначе полоса вида `look`. */
function blinkBar(look, on) {
  if (on) return { state: 'paused', value: 100 };
  return look ? { state: look.state, value: look.value } : { state: 'none', value: 0 };
}

/**
 * Ключ снятия мигания. Снимает его фокус или «Mark seen» до следующего ответа
 * агента: у того другая метка кеша, а значит, и другой ключ. Повтор того же
 * набора раз в пять минут снятое не зажигает.
 */
function cacheWarnKey(sessionId, cacheAt) {
  return `${sessionId}:${cacheAt}`;
}

/**
 * Тело просьбы `claude-cache-warn` → `{warnSec, warns}`. Кривое тело и
 * `warnMin` вне 0…59 выключают мигание: набор заменяется целиком, и на
 * непонятное ответ — погасить, а не держать прошлое.
 */
function parseCacheWarn(body) {
  const off = { warnSec: 0, warns: new Map() };
  let src = body;
  if (typeof body === 'string') {
    try { src = JSON.parse(body || '{}'); } catch { return off; }
  }
  if (!src || typeof src !== 'object') return off;
  const min = Number(src.warnMin);
  if (!Number.isInteger(min) || min < 0 || min > MAX_WARN_MIN) return off;
  const warns = new Map();
  for (const s of Array.isArray(src.sessions) ? src.sessions : []) {
    const at = Number(s?.cacheAt);
    if (typeof s?.id === 'string' && s.id && Number.isFinite(at) && at > 0) warns.set(s.id, { cacheAt: at });
  }
  return { warnSec: min * 60, warns };
}

export {
  TBPF, taskbarLook, isWeztermPath, planTaskbar, resetOps, markHolds, pruneMarks,
  CACHE_TTL_SEC, CACHE_SAFETY_SEC, NEW_TURN_MARGIN_SEC, BLINK_MS,
  cacheWarnDue, blinkBar, cacheWarnKey, parseCacheWarn,
};
