/** Pure helpers for opening a Claude project by cwd. No I/O. */

import { applyWtProfile } from './wt-profile-helpers.js';

/** Last path segment of a Linux cwd; used as `claude -n` display name. */
function basenameOfCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd) return '';
  const parts = cwd.replace(/\/+$/, '').split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
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

/** Build a WT spawn descriptor from a launch template. */
function planWtLaunch({ launch, vars = {}, profile }) {
  const id = vars.id ?? '';
  const safeCwd = escapeForSingleQuoted(vars.cwd ?? '');
  const safeName = escapeForSingleQuoted(vars.name ?? '');
  const substituted = (launch?.args ?? []).map(arg =>
    String(arg)
      .replaceAll('{id}', id)
      .replaceAll('{cwd}', safeCwd)
      .replaceAll('{name}', safeName)
  );
  return {
    command: launch.command,
    args: applyWtProfile(substituted, profile),
  };
}

/**
 * Build the spawn descriptor for a fresh Claude session in a project folder.
 * `{cwd}` and `{name}` in each arg are replaced with single-quote-safe text
 * (templates should wrap them in `'…'` themselves).
 */
function planLaunchNew({ launchNew, cwd, name, profile }) {
  return planWtLaunch({ launch: launchNew, vars: { cwd, name }, profile });
}

export {
  basenameOfCwd,
  pickOpenProjectSession,
  escapeForSingleQuoted,
  normalizeProjects,
  profileForCwd,
  planWtLaunch,
  planLaunchNew,
};
