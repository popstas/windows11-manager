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
 * окно выходит вперёд (FLASHW_TIMERNOFG).
 *
 * `unknown` сюда сейчас не доезжает: normalizeProgress его отбрасывает, и
 * такое окно получает сброс. Ветка оставлена, чтобы соответствие хуку было
 * записано целиком.
 */
function taskbarLook(agentState, seen = false) {
  switch (agentState) {
    case 'active': return { state: 'normal', value: 100, flash: false };
    case 'question': return { state: 'paused', value: 22, flash: true };
    case 'review': return { state: 'none', value: 0, flash: !seen };
    case 'idle': return { state: 'none', value: 0, flash: null };
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

/** Снять всё с перечисленных окон: на старте службы и на её остановке. */
function resetOps(ids) {
  return ids.map(id => ({ id, state: 'none', value: 0, flash: 'off' }));
}

export { TBPF, taskbarLook, isWeztermPath, planTaskbar, resetOps };
