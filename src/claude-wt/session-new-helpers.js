/**
 * Разбор просьбы head-session открыть новую сессию (`POST /claude-wt/session-new`).
 *
 * Тело пишет чужой процесс по сети без авторизации, поэтому каждое поле
 * просеивается, а не читается на веру. Защита — белый список каталогов из
 * `claudeWt.projects`, точным совпадением: запустить агента с `ssh -A` в
 * произвольном каталоге отсюда нельзя.
 *
 * Чистая функция: ни конфига, ни генератора id она сама не берёт — их дают
 * вторым аргументом, иначе проверять пришлось бы настоящим конфигом.
 */

// Режимы `claude --permission-mode` (2.1.322). Чужое слово claude отвергнет
// уже на той стороне ssh, и окно закроется молча — лучше 400 здесь.
const PERMISSION_MODES = ['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `;` для wt.exe — разделитель панелей в любом месте командной строки;
// кавычки, `$`, `` ` `` и `\` ломают позиционные аргументы удалённого шелла;
// `{}` подхватила бы подстановка шаблона следующим проходом.
const UNSAFE = /[;"'`$\\{}]/;
const hasControlChar = v => [...v].some(ch => ch.charCodeAt(0) < 0x20);

// Пустое значение обёртке передаётся как `-`: пустой позиционный аргумент
// через wt.exe и ssh доезжает ненадёжно.
const EMPTY = '-';

const str = v => (typeof v === 'string' ? v.trim() : '');

function parseBody(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw ?? ''));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

const fail = (status, reason) => ({ ok: false, status, reason });

/**
 * @param {object|string} raw тело просьбы
 * @param {{ projects: Array<{cwd: string}>, newId: () => string }} opts
 * @returns {{ ok: true, vars: object } | { ok: false, status: number, reason: string }}
 */
function parseSessionNewRequest(raw, { projects = [], newId } = {}) {
  const body = parseBody(raw);
  if (!body) return fail(400, 'body must be a JSON object');

  const values = {
    cwd: str(body.cwd),
    name: str(body.name),
    promptFile: str(body.promptFile),
    sessionId: str(body.sessionId),
    permissionMode: str(body.permissionMode),
    head: str(body.head),
    headId: str(body.headId),
  };
  for (const key of ['cwd', 'name', 'promptFile']) {
    if (!values[key]) return fail(400, `${key} is required`);
  }
  for (const [key, value] of Object.entries(values)) {
    if (UNSAFE.test(value) || hasControlChar(value)) {
      return fail(400, `${key} has characters the launch command cannot carry`);
    }
  }
  if (!projects.some(p => p?.cwd === values.cwd)) {
    return fail(403, `cwd ${values.cwd} is not in claudeWt.projects`);
  }
  if (values.sessionId && !UUID.test(values.sessionId)) {
    return fail(400, 'sessionId must be a uuid');
  }
  // Правила обёртки `claude-wt-new`: имя и head claude прочёл бы как опцию,
  // headId — uuid. Там это exit 2 и молча закрытое окно, здесь — 400.
  for (const key of ['name', 'head']) {
    if (values[key].startsWith('-')) return fail(400, `${key} must not start with a dash`);
  }
  if (values.headId && !UUID.test(values.headId)) {
    return fail(400, 'headId must be a uuid');
  }
  if (values.permissionMode && !PERMISSION_MODES.includes(values.permissionMode)) {
    return fail(400, `permissionMode must be one of ${PERMISSION_MODES.join(', ')}`);
  }

  return {
    ok: true,
    vars: {
      cwd: values.cwd,
      name: values.name,
      sessionId: values.sessionId || newId(),
      promptFile: values.promptFile,
      permissionMode: values.permissionMode || EMPTY,
      head: values.head || EMPTY,
      headId: values.headId || EMPTY,
    },
  };
}

export { parseSessionNewRequest, PERMISSION_MODES };
