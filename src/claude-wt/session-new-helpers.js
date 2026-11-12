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

import path from 'node:path';

// Режимы `claude --permission-mode` (2.1.322), которые маршрут пропускает.
// Чужое слово claude отвергнет уже на той стороне ssh, и окно закроется
// молча — лучше 400 здесь. bypassPermissions у claude есть, но отсюда
// запрещён (см. ниже).
const PERMISSION_MODES = ['acceptEdits', 'auto', 'manual', 'dontAsk', 'plan'];

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

const trimSlashes = p => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/**
 * `claudeWt.childCwdRoot`: корень каталогов детей head на стороне ssh
 * (pc-virt). Пусто, не строка, относительный путь или `/` — корня нет, и
 * второго прохода у session-new нет: корнем всей машины ключ не бывает.
 */
function normalizeChildCwdRoot(raw) {
  if (typeof raw !== 'string') return '';
  const text = raw.trim();
  if (!text.startsWith('/')) return '';
  const norm = trimSlashes(path.posix.normalize(text));
  return norm === '/' ? '' : norm;
}

/**
 * Каталог строго под корнем, после нормализации: `..` и `.` разрешаются,
 * двойные и хвостовые `/` снимаются. Сравнение — с `root + '/'`, иначе
 * `/home/popstas/projectsX` числился бы под `/home/popstas/projects`. Сам
 * корень не годится: ребёнку нужен подкаталог.
 *
 * Симлинков здесь не видно — менеджер на Windows сравнивает строки. Поэтому
 * корень повторно проверяет обёртка `claude-wt-new` по `pwd -P`.
 */
function childCwdUnderRoot(cwd, root) {
  if (typeof cwd !== 'string' || !cwd.startsWith('/')) return fail(400, 'cwd must be an absolute path');
  const norm = trimSlashes(path.posix.normalize(cwd));
  if (!norm.startsWith(`${root}/`)) return fail(403, `cwd ${norm} is not under claudeWt.childCwdRoot ${root}`);
  return { ok: true, path: norm };
}

/**
 * Зона окна ребёнка: `{monitor, position}`, целые числа, пара из
 * `claudeWt.headZones`. Строки не принимаются — их шлёт не человек, а
 * session-spawn, и `'1'` там означает ошибку на той стороне.
 *
 * Есть ли у зоны прямоугольник прямо сейчас (монитор может быть отключён),
 * здесь не решается: это видно только по живым мониторам, и такой отказ —
 * откат на прежнее место с warn, а не 400.
 */
function parseZone(raw, headZones) {
  if (raw === undefined || raw === null) return { zone: null };
  const known = Object.entries(headZones ?? {})
    .flatMap(([monitor, pair]) => pair.map(position => `${monitor}:${position}`));
  if (!known.length) return { error: 'zone given, but claudeWt.headZones is not set on this machine' };
  const ok = raw && typeof raw === 'object' && !Array.isArray(raw)
    && Number.isInteger(raw.monitor) && Number.isInteger(raw.position)
    && known.includes(`${raw.monitor}:${raw.position}`);
  if (!ok) return { error: `zone must be one of ${known.join(', ')}` };
  return { zone: { monitor: raw.monitor, position: raw.position } };
}

/**
 * @param {object|string} raw тело просьбы
 * @param {{ projects: Array<{cwd: string}>, newId: () => string,
 *   headZones?: Record<string,[number,number]>, childCwdRoot?: string,
 *   isLiveHead?: (headId: string) => boolean }} opts
 * @returns {{ ok: true, vars: object, zone: {monitor:number, position:number}|null, profileCwd: string }
 *   | { ok: false, status: number, reason: string }}
 */
/**
 * Второй проход (решение Стаса 12.11: право на spawn даёт проект head):
 * `cwd` не в списке, но строго под `childCwdRoot`; `headCwd` в списке или тоже
 * под корнем; у `headId` открыто окно на этой машине. Живость — последней: она
 * стоит чтения сессий.
 */
function rootPass(values, { childCwdRoot, inList, isLiveHead }) {
  const notListed = `cwd ${values.cwd} is not in claudeWt.projects`;
  if (!values.headId) return fail(403, notListed);
  if (!childCwdRoot) return fail(403, `${notListed}, and claudeWt.childCwdRoot is not set`);
  const child = childCwdUnderRoot(values.cwd, childCwdRoot);
  if (!child.ok) return child;
  if (!values.headCwd) return fail(403, `headCwd is required for a cwd outside claudeWt.projects`);
  if (!inList(values.headCwd) && !childCwdUnderRoot(values.headCwd, childCwdRoot).ok) {
    return fail(403, `headCwd ${values.headCwd} is neither in claudeWt.projects nor under claudeWt.childCwdRoot ${childCwdRoot}`);
  }
  if (!isLiveHead(values.headId)) return fail(403, `head ${values.headId} has no window on this machine`);
  return child;
}

function parseSessionNewRequest(raw, {
  projects = [], newId, headZones = {}, childCwdRoot = '', isLiveHead = () => false,
} = {}) {
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
    // Только для второго прохода и профиля: каталог head и проект, от
    // которого брать профиль терминала. В команду запуска не идут, но сито то
    // же — подсунутая строка не должна значить больше, чем путь.
    headCwd: str(body.headCwd),
    profileCwd: str(body.profileCwd),
  };
  for (const key of ['cwd', 'name', 'promptFile']) {
    if (!values[key]) return fail(400, `${key} is required`);
  }
  for (const [key, value] of Object.entries(values)) {
    if (UNSAFE.test(value) || hasControlChar(value)) {
      return fail(400, `${key} has characters the launch command cannot carry`);
    }
  }
  const inList = cwd => projects.some(p => p?.cwd === cwd);
  // Старый проход — точное совпадение со списком, как раньше: с headId или
  // без, с окном head здесь или без. Корень обёртке тогда не передаётся:
  // проект из списка может лежать вне него (или быть симлинком наружу), и
  // проверка обёртки отказала бы тому, что список разрешил.
  let cwd = values.cwd;
  let rootForWrapper = '';
  if (!inList(cwd)) {
    const root = rootPass(values, { childCwdRoot, inList, isLiveHead });
    if (!root.ok) return root;
    cwd = root.path;
    rootForWrapper = childCwdRoot;
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
  // Решение Стаса (11.11): маршрут без авторизации, и bypassPermissions через
  // него открыл бы агента без вопросов любому в сети. Такое — только руками.
  if (values.permissionMode === 'bypassPermissions') {
    return fail(400, 'permissionMode bypassPermissions is not allowed on this route');
  }
  if (values.permissionMode && !PERMISSION_MODES.includes(values.permissionMode)) {
    return fail(400, `permissionMode must be one of ${PERMISSION_MODES.join(', ')}`);
  }
  const { zone, error: zoneError } = parseZone(body.zone, headZones);
  if (zoneError) return fail(400, zoneError);

  return {
    ok: true,
    vars: {
      cwd,
      name: values.name,
      sessionId: values.sessionId || newId(),
      promptFile: values.promptFile,
      permissionMode: values.permissionMode || EMPTY,
      head: values.head || EMPTY,
      headId: values.headId || EMPTY,
      // Корень для обёртки (`CCFZF_CHILD_CWD_ROOT`): только когда cwd прошёл по
      // правилу корня, иначе пусто — проверки нет.
      childCwdRoot: rootForWrapper,
    },
    zone,
    // Каталог, по которому берётся профиль терминала: свой из списка, иначе
    // присланный из списка (проект head или выше по цепочке), иначе свой —
    // и тогда профиль глобальный.
    profileCwd: inList(cwd) ? cwd : (inList(values.profileCwd) ? values.profileCwd : cwd),
  };
}

export { parseSessionNewRequest, PERMISSION_MODES, normalizeChildCwdRoot, childCwdUnderRoot };
