/**
 * Какую иконку поставить окну сессии claude. Без I/O.
 *
 * Решения Стаса 15.11: окно сессии — иконка её проекта, а без своей — иконка
 * профиля wt проекта (как у профилей Windows Terminal; карта профилей — только
 * в живом конфиге). Иконку ставит служба по hwnd (WM_SETICON) окнам и wt, и
 * WezTerm: src/mqtt/window-icons.js.
 *
 * Корона head (решение Стаса 16.11) — не вместо иконки, а значком в правом
 * нижнем углу кнопки на панели задач (ITaskbarList3::SetOverlayIcon), главная
 * иконка у head та же, что у обычной сессии его проекта. Прежнее поведение —
 * корона вместо иконки — остаётся режимом `windowIcons.headMode: icon`.
 * Значок виден только на кнопке панели задач (не в заголовке и не в Alt+Tab)
 * и только при включённых в Windows значках на кнопках панели задач.
 */
import { fileURLToPath } from 'node:url';
import { profileForTerminal } from './project-helpers.js';

// Корень репозитория — от него разрешаются относительные пути иконок
// (`icons/crown.ico`). Один на службу (src/mqtt/window-icons.js) и демон
// (иконки проектов в файле окон): разойдись они, одна корона приехала бы
// читателю двумя путями. Буква диска — заглавной: fileURLToPath отдаёт её
// такой, какой её назвал запустивший процесс (`c:\projects\...` у трея), а
// путь уезжает в файл окон.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
  .replace(/[\\/]+$/, '')
  .replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`);

// Корона в 16 px читается (кадр 16x16 есть в файле), поэтому значку
// отдельный файл не нужен: служба грузит из того же .ico маленький кадр.
const BUILTIN_HEAD_ICON = 'icons/crown.ico';

// Как окну head показывать корону: значком поверх иконки проекта (умолчание)
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
  const project = (cfg.projects ?? []).find(p => p.cwd === cwd);
  if (project?.icon) return project.icon;
  const profile = profileForTerminal(cwd, 'wt', cfg);
  return (profile && cfg.windowIcons?.profiles?.[profile]) || '';
}

/**
 * Что поставить окну сессии: `{icon, overlay}` — главная иконка (WM_SETICON)
 * и значок на кнопке панели задач; пустая строка — не трогать / без значка.
 * Значок бывает только у head в режиме `badge`.
 */
function iconFor({ sessionId, cwd }, { heads, cfg }) {
  const isHead = Boolean(sessionId && heads?.has(sessionId));
  if (!isHead) return { icon: projectIconFor(cwd, cfg), overlay: '' };
  const crown = cfg.windowIcons?.head || BUILTIN_HEAD_ICON;
  if (headModeOf(cfg) === 'icon') return { icon: crown, overlay: '' };
  return { icon: projectIconFor(cwd, cfg), overlay: crown };
}

const ABSOLUTE = /^(?:[a-zA-Z]:[\\/]|[\\/])/;

/**
 * Относительный путь — от корня репозитория, где лежит каталог icons/.
 * Разделитель — тот, что у корня: путь уходит наружу (файл окон, пикер), и
 * смесь вида `C:\repo/icons/crown.ico` Windows хоть и примет, но сравнивать
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
 * из `iconFor`. Решение Стаса 16.11: в пикере у head иконка проекта, корона —
 * только значком на панели задач; в режиме icon иконка окна head и есть
 * корона, и читатель видит её, как раньше.
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
 * Корона head абсолютным путём — для закрытой head-сессии в истории читателя.
 * Только в режиме icon, где корона и есть иконка окна head; в режиме
 * badge пусто — читатель берёт иконку проекта по каталогу, как у окна.
 */
function headIcon(cfg, repoRoot) {
  if (cfg.windowIcons?.enabled === false) return '';
  if (headModeOf(cfg) !== 'icon') return '';
  return resolveIconPath(cfg.windowIcons?.head || BUILTIN_HEAD_ICON, repoRoot);
}

export {
  REPO_ROOT, BUILTIN_HEAD_ICON, HEAD_MODES, headModeOf, iconFor, resolveIconPath, iconsSidecarPath,
  publishedIcons, headsDirFor, planIcons, projectIcons, headIcon,
};
