/**
 * Какую иконку поставить окну сессии claude. Без I/O.
 *
 * Решения Стаса 15.11: окно head — корона, окно сессии — иконка её проекта,
 * а без своей — иконка профиля wt проекта (как у профилей Windows Terminal;
 * карта профилей — только в живом конфиге). Иконку ставит служба по
 * hwnd (WM_SETICON) окнам и wt, и WezTerm: src/mqtt/window-icons.js.
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

const BUILTIN_HEAD_ICON = 'icons/crown.ico';

/**
 * Путь иконки для окна сессии; пустая строка — иконку не трогать.
 *
 * Профиль берётся как у wt (`profileForTerminal(cwd, 'wt')`): иконки повторяют
 * профили wt, и окно WezTerm того же проекта должно выглядеть так же.
 */
function iconFor({ sessionId, cwd }, { heads, cfg }) {
  const icons = cfg.windowIcons ?? {};
  if (sessionId && heads?.has(sessionId)) return icons.head || BUILTIN_HEAD_ICON;
  const project = (cfg.projects ?? []).find(p => p.cwd === cwd);
  if (project?.icon) return project.icon;
  const profile = profileForTerminal(cwd, 'wt', cfg);
  return (profile && icons.profiles?.[profile]) || '';
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
 * Что публиковать: иконка, которую служба окну ставит или поставила бы, по
 * sessionId, абсолютным путём. Окно без иконки — пустая строка.
 */
function publishedIcons(sessions, wanted, repoRoot) {
  const out = {};
  for (const s of sessions ?? []) {
    if (!s?.sessionId) continue;
    out[s.sessionId] = resolveIconPath(wanted.get(s.id) ?? '', repoRoot);
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

/**
 * Что поменять, чтобы из `applied` стало `wanted` (hwnd → путь, '' — без
 * иконки). Снимается только то, что ставили мы: чужое окно с пустым путём
 * никто не трогает. Закрытое окно (нет в `alive`) забывается без вызова.
 * Операция {id, path}; path '' — снять иконку.
 */
function planIcons(applied, wanted, alive) {
  const ops = [];
  const next = new Map();
  for (const [id, path] of wanted) {
    const prev = applied.get(id) ?? '';
    if (prev !== path) ops.push({ id, path });
    if (path) next.set(id, path);
  }
  for (const [id] of applied) {
    if (wanted.has(id) || !alive.has(id)) continue;
    ops.push({ id, path: '' });
  }
  return { ops, next };
}

/**
 * Иконки проектов для строк без окна: cwd → абсолютный путь.
 *
 * Читатель (ccfzf-picker) рисует иконку и у сессии из истории, и у строки
 * проекта — а окна там нет, и в записи окна её взять неоткуда. Решение то же,
 * что у окна не-head сессии этого каталога (`iconFor` без меток head): иначе
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
    const icon = resolveIconPath(iconFor({ sessionId: '', cwd: p.cwd }, { heads: null, cfg }), repoRoot);
    if (icon) out[p.cwd] = icon;
  }
  return out;
}

/**
 * Корона head абсолютным путём — для закрытой head-сессии в истории читателя.
 * Та же, что `iconFor` ставит окну head.
 */
function headIcon(cfg, repoRoot) {
  if (cfg.windowIcons?.enabled === false) return '';
  return resolveIconPath(cfg.windowIcons?.head || BUILTIN_HEAD_ICON, repoRoot);
}

export {
  REPO_ROOT, BUILTIN_HEAD_ICON, iconFor, resolveIconPath, iconsSidecarPath, publishedIcons, headsDirFor, planIcons,
  projectIcons, headIcon,
};
