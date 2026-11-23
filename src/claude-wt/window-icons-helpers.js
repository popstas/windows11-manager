/**
 * Какую иконку поставить окну сессии claude. Без I/O.
 *
 * Решения Стаса 15.11: окно сессии — иконка её проекта, а без своей — иконка
 * профиля wt проекта (как у профилей Windows Terminal; карта профилей — только
 * в живом конфиге). Иконку ставит служба по hwnd (WM_SETICON) окнам и wt, и
 * WezTerm: src/mqtt/window-icons.js.
 *
 * Значок head (решение Стаса 16.11) — не вместо иконки, а в правом нижнем
 * углу кнопки на панели задач (ITaskbarList3::SetOverlayIcon), главная иконка
 * у head та же, что у обычной сессии его проекта. Прежнее поведение — значок
 * head вместо иконки — остаётся режимом `windowIcons.headMode: icon`.
 * Встроенный значок — оргсхема в синем круге (решение Стаса 17.11, сменила
 * корону: та плохо читалась поверх части иконок проектов).
 * Значок виден только на кнопке панели задач (не в заголовке и не в Alt+Tab)
 * и только при включённых в Windows значках на кнопках панели задач.
 *
 * Значок проекта по заголовку (решение Стаса 23.11): `claudeWt.projects[].badges`
 * — список `{match, icon}`, `match` — регэксп по заголовку окна, срабатывает
 * первое совпавшее правило. Сессии однотипны, и отличать их нужно внутри
 * проекта, не трогая его иконку, — поэтому слот тот же, что у head, а head
 * в режиме `badge` его не уступает. Проект — по точному cwd, как у иконки.
 */
import { fileURLToPath } from 'node:url';
import { profileForTerminal } from './project-helpers.js';

// Корень репозитория — от него разрешаются относительные пути иконок
// (`icons/head-badge.ico`). Один на службу (src/mqtt/window-icons.js) и демон
// (иконки проектов в файле окон): разойдись они, один значок head приехал бы
// читателю двумя путями. Буква диска — заглавной: fileURLToPath отдаёт её
// такой, какой её назвал запустивший процесс (`c:\projects\...` у трея), а
// путь уезжает в файл окон.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
  .replace(/[\\/]+$/, '')
  .replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`);

// Один файл на оба режима: кадры 16/20/24 — значок на кнопке панели задач
// (служба грузит маленький кадр, SM_CXSMICON), 32–256 — иконка окна в режиме
// icon. Генератор — icons/head-badge.py.
const BUILTIN_HEAD_ICON = 'icons/head-badge.ico';

// Как окну head показывать значок head: поверх иконки проекта (умолчание)
// или вместо неё.
const HEAD_MODES = ['badge', 'icon'];

function headModeOf(cfg) {
  const mode = cfg.windowIcons?.headMode;
  return HEAD_MODES.includes(mode) ? mode : 'badge';
}

/**
 * Иконка проекта по каталогу; пустая строка — иконку не трогать.
 *
 * Профиль берётся как у wt (`profileForTerminal(cwd, 'wt')`): иконки повторяют
 * профили wt, и окно WezTerm того же проекта должно выглядеть так же.
 */
function projectIconFor(cwd, cfg) {
  const project = projectFor(cwd, cfg);
  if (project?.icon) return project.icon;
  const profile = profileForTerminal(cwd, 'wt', cfg);
  return (profile && cfg.windowIcons?.profiles?.[profile]) || '';
}

// Проект сессии — по точному cwd. Один поиск на иконку и значок: разойдись
// они, подкаталог проекта получал бы значок без иконки или наоборот.
function projectFor(cwd, cfg) {
  return (cfg.projects ?? []).find(p => p.cwd === cwd);
}

// Скомпилированные регэкспы правил; `null` — кривой. Тик службы раз в секунду
// гонял бы `new RegExp` на каждое окно, а строк в конфиге — единицы.
const patternCache = new Map();

function compiled(match) {
  if (!patternCache.has(match)) {
    let re = null;
    try { re = new RegExp(match); } catch { /* кривой регэксп — правило пропускается */ }
    patternCache.set(match, re);
  }
  return patternCache.get(match);
}

/**
 * Значок первого правила проекта, чей регэксп совпал с заголовком; пустая
 * строка — значка нет. Правило с кривым регэкспом пропускается.
 */
function badgeFor(title, project) {
  if (!title || !project?.badges) return '';
  for (const { match, icon } of project.badges) {
    if (compiled(match)?.test(title)) return icon;
  }
  return '';
}

/** Регэкспы из `badges`, которые не компилируются, — для предупреждения в журнал. */
function badPatterns(cfg) {
  const bad = [];
  for (const p of cfg.projects ?? []) {
    for (const { match } of p.badges ?? []) if (!compiled(match)) bad.push(match);
  }
  return bad;
}

/**
 * Что поставить окну сессии: `{icon, overlay}` — главная иконка (WM_SETICON)
 * и значок на кнопке панели задач; пустая строка — не трогать / без значка.
 * Значок — head в режиме `badge`, иначе первое совпавшее правило `badges`
 * проекта по заголовку окна.
 */
function iconFor({ sessionId, cwd, title }, { heads, cfg }) {
  const isHead = Boolean(sessionId && heads?.has(sessionId));
  const badge = () => badgeFor(title, projectFor(cwd, cfg));
  if (!isHead) return { icon: projectIconFor(cwd, cfg), overlay: badge() };
  const headBadge = cfg.windowIcons?.head || BUILTIN_HEAD_ICON;
  if (headModeOf(cfg) === 'icon') return { icon: headBadge, overlay: badge() };
  return { icon: projectIconFor(cwd, cfg), overlay: headBadge };
}

const ABSOLUTE = /^(?:[a-zA-Z]:[\\/]|[\\/])/;

/**
 * Относительный путь — от корня репозитория, где лежит каталог icons/.
 * Разделитель — тот, что у корня: путь уходит наружу (файл окон, пикер), и
 * смесь вида `C:\repo/icons/head-badge.ico` Windows хоть и примет, но сравнивать
 * её с путями из конфига и читать глазами неудобно.
 */
function resolveIconPath(iconPath, repoRoot) {
  if (!iconPath) return '';
  if (ABSOLUTE.test(iconPath)) return iconPath;
  const sep = repoRoot.includes('\\') ? '\\' : '/';
  const root = repoRoot.replace(/[\\/]+$/, '');
  return `${root}${sep}${iconPath.replace(/[\\/]+/g, sep)}`;
}

/**
 * Файл, которым служба (она знает роль окна и его иконку) делится с демоном
 * (он пишет файл окон для пикера): sessionId → абсолютный путь иконки. Лежит
 * рядом с файлом состояния, на локальном диске — демон читает его по mtime
 * на каждом тике, и сетевого опроса в цикле нет.
 */
function iconsSidecarPath(statePath) {
  const file = statePath ?? '';
  const slash = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  if (slash < 0) return '';
  return `${file.slice(0, slash)}/window-icons.json`;
}

/**
 * Что публиковать: главная иконка окна (не значок) по sessionId, абсолютным
 * путём. Окно без иконки — пустая строка. `wanted` — hwnd → `{icon, overlay}`
 * из `iconFor`. Решение Стаса 16.11: в пикере у head иконка проекта, значок
 * head — только на панели задач; в режиме icon иконка окна head и есть
 * значок head, и читатель видит его, как раньше.
 */
function publishedIcons(sessions, wanted, repoRoot) {
  const out = {};
  for (const s of sessions ?? []) {
    if (!s?.sessionId) continue;
    out[s.sessionId] = resolveIconPath(wanted.get(s.id)?.icon ?? '', repoRoot);
  }
  return out;
}

/**
 * Каталог меток head. Метку пишет head-mark.mjs из скилла head-session в
 * ~/.ccfzf/heads/<sessionId>.json на стороне ssh; с Windows он виден рядом с
 * sessionsFile (`V:/.ccfzf.sessions.json` → `V:/.ccfzf/heads`).
 */
function headsDirFor(cfg) {
  const explicit = cfg.windowIcons?.headsDir;
  if (explicit) return explicit;
  const file = cfg.sessionsFile ?? '';
  const slash = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  if (slash < 0) return '';
  return `${file.slice(0, slash)}/.ccfzf/heads`;
}

const KINDS = ['icon', 'overlay'];

/**
 * Что поменять, чтобы из `applied` стало `wanted` (hwnd → `{icon, overlay}`,
 * '' — без иконки / без значка). Иконка и значок планируются порознь: смена
 * одного не трогает другой. Снимается только то, что ставили мы: чужое окно с
 * пустым путём никто не трогает. Закрытое окно (нет в `alive`) забывается без
 * вызова. Операция {id, kind, path}; kind 'icon' | 'overlay', path '' — снять.
 */
function planIcons(applied, wanted, alive) {
  const ops = [];
  const next = new Map();
  for (const [id, look] of wanted) {
    const prev = applied.get(id) ?? {};
    const kept = {};
    for (const kind of KINDS) {
      const path = look?.[kind] ?? '';
      if ((prev[kind] ?? '') !== path) ops.push({ id, kind, path });
      if (path) kept[kind] = path;
    }
    if (Object.keys(kept).length) next.set(id, kept);
  }
  for (const [id, prev] of applied) {
    if (wanted.has(id) || !alive.has(id)) continue;
    for (const kind of KINDS) if (prev[kind]) ops.push({ id, kind, path: '' });
  }
  return { ops, next };
}

/**
 * Иконки проектов для строк без окна: cwd → абсолютный путь.
 *
 * Читатель (ccfzf-picker) рисует иконку и у сессии из истории, и у строки
 * проекта — а окна там нет, и в записи окна её взять неоткуда. Решение то же,
 * что у окна не-head сессии этого каталога (`projectIconFor`): иначе
 * одна и та же сессия выглядела бы в списке по-разному с окном и без него.
 * Проект без иконки в карту не попадает.
 */
function projectIcons(cfg, repoRoot) {
  const out = {};
  // Выключены иконки окнам — нет и строкам без окна: служба тогда тоже
  // публикует пустоту (`{}` в window-icons.json).
  if (cfg.windowIcons?.enabled === false) return out;
  for (const p of cfg.projects ?? []) {
    if (typeof p?.cwd !== 'string' || !p.cwd) continue;
    const icon = resolveIconPath(projectIconFor(p.cwd, cfg), repoRoot);
    if (icon) out[p.cwd] = icon;
  }
  return out;
}

/**
 * Значок head абсолютным путём — для закрытой head-сессии в истории читателя.
 * Только в режиме icon, где значок head и есть иконка окна; в режиме
 * badge пусто — читатель берёт иконку проекта по каталогу, как у окна.
 */
function headIcon(cfg, repoRoot) {
  if (cfg.windowIcons?.enabled === false) return '';
  if (headModeOf(cfg) !== 'icon') return '';
  return resolveIconPath(cfg.windowIcons?.head || BUILTIN_HEAD_ICON, repoRoot);
}

export {
  REPO_ROOT, BUILTIN_HEAD_ICON, HEAD_MODES, headModeOf, iconFor, resolveIconPath, iconsSidecarPath,
  publishedIcons, headsDirFor, planIcons, projectIcons, headIcon, badgeFor, badPatterns,
};
