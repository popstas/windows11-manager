/** Pure helpers for opening a Claude project by cwd. No I/O. */

import { applyWtProfile } from './wt-profile-helpers.js';

/** Last path segment of a Linux cwd; used as `claude -n` display name. */
function basenameOfCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd) return '';
  const parts = cwd.replace(/\/+$/, '').split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

/**
 * Имя новой сессии: чьё главнее — каталога или просьбы.
 *
 * По умолчанию каталог: так называет сессию ccfzf (`claude -n <basename>`), и
 * по этому же имени `openClaudeProject` ищет уже открытое окно по заголовку —
 * присланное имя перебило бы поиск и открыло второй терминал.
 *
 * У просьбы «заведи ещё одну» (`reuseOpen: false`) поиска нет вовсе, а
 * basename каталога занят той сессией, рядом с которой просят открыть новую.
 * Уникальное имя считает пикер по списку занятых (`uniqueSessionName`) — здесь
 * такого списка нет, — поэтому там главнее оно.
 */
function sessionNameFor({ cwd, name, reuseOpen = true } = {}) {
  const base = basenameOfCwd(cwd);
  const asked = typeof name === 'string' ? name.trim() : '';
  return reuseOpen ? (base || asked) : (asked || base);
}

/**
 * Among open sessions whose cwd matches exactly, pick the one the user looked
 * at most recently (`focusedAt`), falling back to `lastActivity`.
 */
function pickOpenProjectSession(sessions, cwd) {
  if (typeof cwd !== 'string' || !cwd) return null;
  const open = (sessions ?? []).filter(s => s.open && s.cwd === cwd);
  if (!open.length) return null;
  return [...open].sort((a, b) => {
    const byFocus = (b.focusedAt ?? 0) - (a.focusedAt ?? 0);
    if (byFocus) return byFocus;
    return (b.lastActivity ?? 0) - (a.lastActivity ?? 0);
  })[0];
}

/** Escape a value for embedding inside a bash single-quoted string. */
function escapeForSingleQuoted(value) {
  return String(value).replace(/'/g, `'\\''`);
}

function normalizeProjects(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const p of raw) {
    if (!p || typeof p.name !== 'string' || !p.name || typeof p.cwd !== 'string' || !p.cwd) continue;
    const entry = { name: p.name, cwd: p.cwd };
    if (typeof p.hotkey === 'string' && p.hotkey.trim()) entry.hotkey = p.hotkey.trim();
    if (typeof p.profile === 'string') entry.profile = p.profile.trim();
    if (p.profiles && typeof p.profiles === 'object') {
      const profiles = {};
      for (const [term, value] of Object.entries(p.profiles)) {
        if (typeof value === 'string' && value.trim()) profiles[term] = value.trim();
      }
      if (Object.keys(profiles).length) entry.profiles = profiles;
    }
    out.push(entry);
  }
  return out;
}

function profileForCwd(cwd, cfg = {}) {
  const projects = Array.isArray(cfg.projects) ? cfg.projects : [];
  const hit = typeof cwd === 'string' && cwd
    ? projects.find(p => p.cwd === cwd)
    : undefined;
  if (hit) return hit.profile ?? (typeof cfg.profile === 'string' ? cfg.profile : '');
  return typeof cfg.profile === 'string' ? cfg.profile : '';
}

/**
 * Профиль для конкретного терминала.
 *
 * Профили — понятие не общее: у Windows Terminal они есть, у WezTerm нет
 * вовсе. Поэтому карта по имени терминала, а не одно поле: одно поле пришлось
 * бы либо подставлять всем подряд, либо угадывать, кому оно предназначалось.
 *
 * Старое плоское `profile` (и у проекта, и глобальное) читается как профиль
 * `wt`: конфиги написаны до реестра, и все они про Windows Terminal. Читай мы
 * его как «для любого терминала», первый же запуск WezTerm получил бы
 * аргументы, которых тот не понимает.
 */
function profileForTerminal(cwd, terminalName, cfg = {}) {
  const name = typeof terminalName === 'string' ? terminalName : '';
  const projects = Array.isArray(cfg.projects) ? cfg.projects : [];
  const hit = typeof cwd === 'string' && cwd ? projects.find(p => p.cwd === cwd) : undefined;
  const mapped = hit?.profiles?.[name];
  if (typeof mapped === 'string' && mapped) return mapped;
  if (name !== 'wt') return '';
  if (hit && typeof hit.profile === 'string' && hit.profile) return hit.profile;
  if (hit && hit.profiles) return '';
  return typeof cfg.profile === 'string' ? cfg.profile : '';
}

/**
 * Собрать описание запуска.
 *
 * Две дороги, и разводит их наличие `terminal`. С реестром команда
 * складывается: терминал, его аргументы, профильные аргументы, хвост из
 * `launch.args`. Без реестра — прежняя дорога старого конфига, где терминал и
 * хвост лежат в `launch` одним списком, а профиль вставляет `applyWtProfile`.
 *
 * Подстановка идёт по собранному списку, а не по хвосту: `{profile}` стоит в
 * профильных аргументах, `{id}`/`{cwd}`/`{name}` — в хвосте, и разделять два
 * прохода было бы двумя местами, где легко забыть про новую подстановку.
 */
function planWtLaunch({ launch, vars = {}, profile, terminal }) {
  const id = vars.id ?? '';
  const safeCwd = escapeForSingleQuoted(vars.cwd ?? '');
  const safeName = escapeForSingleQuoted(vars.name ?? '');
  const wanted = typeof profile === 'string' ? profile : '';
  const substitute = arg => String(arg)
    .replaceAll('{id}', id)
    .replaceAll('{cwd}', safeCwd)
    .replaceAll('{name}', safeName)
    .replaceAll('{profile}', wanted);
  const tail = launch?.args ?? [];
  if (!terminal?.command) {
    return { command: launch?.command, args: applyWtProfile(tail.map(substitute), profile) };
  }
  const profileArgs = wanted && Array.isArray(terminal.profileArgs) ? terminal.profileArgs : [];
  return {
    command: terminal.command,
    args: [...(terminal.args ?? []), ...profileArgs, ...tail].map(substitute),
  };
}

/**
 * Build the spawn descriptor for a fresh Claude session in a project folder.
 * `{cwd}` and `{name}` in each arg are replaced with single-quote-safe text
 * (templates should wrap them in `'…'` themselves).
 */
function planLaunchNew({ launchNew, cwd, name, profile, terminal }) {
  return planWtLaunch({ launch: launchNew, vars: { cwd, name }, profile, terminal });
}

export {
  basenameOfCwd,
  sessionNameFor,
  pickOpenProjectSession,
  escapeForSingleQuoted,
  normalizeProjects,
  profileForCwd,
  profileForTerminal,
  planWtLaunch,
  planLaunchNew,
};
