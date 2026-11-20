/**
 * Сессия по имени, а не по id. Без ввода-вывода.
 *
 * Имя приезжает из tasks.md в Obsidian: подпункт `- Сессия <имя>` кликается,
 * плагин tasks-mover шлёт `claude-session-open` с этим именем в поле `id`.
 * UUID в заметках не держат — имя из `/rename` человеку читать и узнавать
 * проще, а id сессии меняется при каждом `--fork-session`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Белый список для имени. Строже не по вкусу, а по дороге: id или имя
 * уходит в шаблон `claudeWt.launch.args` (`ccfzf --session {id} --kiosk`), и
 * дальше командной строкой через Windows Terminal, ssh и удалённый шелл. Там
 * кавычка, пробел, `;` (разделитель панелей у WT), `$`, обратная кавычка или
 * `&` — уже не часть имени, а синтаксис. Буквы любых алфавитов, цифры, `-_.`
 * и `└` — приставка дочерних сессий в именах head-session.
 */
const NAME_RE = /^[\p{L}\p{N}_.\-└]+$/u;
const NAME_MAX = 128;

function isSessionUuid(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

/** Причина отказа или `null`, если такое имя можно пустить в командную строку. */
function sessionNameProblem(name) {
  if (typeof name !== 'string' || !name) return 'empty session name';
  if (name.length > NAME_MAX) return `session name longer than ${NAME_MAX}`;
  if (!NAME_RE.test(name)) return 'session name has forbidden characters';
  // `--kiosk` или `-x` из разрешённых символов, но в `ccfzf --session {id}`
  // это уже не значение, а следующая опция.
  if (name.startsWith('-')) return 'session name has forbidden characters: leading -';
  return null;
}

/**
 * Сессия с этим заголовком. Тёзок бывает несколько — переоткрытая сессия,
 * пара «живая и протухшая». Порядок: окно на экране, потом самая свежая по
 * активности, потом по фокусу. `live` (процесс жив) в список трекера не
 * попадает — его знает только дамп ccfzf, — поэтому ступеньки «live» здесь
 * нет: открытое окно её и так покрывает.
 */
function pickSessionByTitle(sessions, title, isAlive = () => true) {
  const same = (sessions ?? []).filter(s => s?.title === title);
  if (!same.length) return null;
  const onScreen = (s) => (s.open && s.windowId && isAlive(s.windowId) ? 1 : 0);
  return [...same].sort((a, b) =>
    onScreen(b) - onScreen(a)
    || (b.lastActivity ?? 0) - (a.lastActivity ?? 0)
    || (b.focusedAt ?? 0) - (a.focusedAt ?? 0),
  )[0];
}

export { isSessionUuid, sessionNameProblem, pickSessionByTitle, NAME_MAX };
