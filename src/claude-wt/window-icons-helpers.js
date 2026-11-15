/**
 * Какую иконку поставить окну сессии claude. Без I/O.
 *
 * Решения Стаса 15.11: окно head — корона, окно сессии — иконка её проекта,
 * а без своей — иконка профиля wt проекта (как у профилей Windows Terminal:
 * popstas.ico, favicon ExpertizeMe, Home Assistant). Иконку ставит служба по
 * hwnd (WM_SETICON) окнам и wt, и WezTerm: src/mqtt/window-icons.js.
 */
import { profileForTerminal } from './project-helpers.js';

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

/** Относительный путь — от корня репозитория, где лежит каталог icons/. */
function resolveIconPath(iconPath, repoRoot) {
  if (!iconPath) return '';
  return ABSOLUTE.test(iconPath) ? iconPath : `${repoRoot}/${iconPath}`;
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

export { BUILTIN_HEAD_ICON, iconFor, resolveIconPath, headsDirFor, planIcons };
