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

/**
 * Build the spawn descriptor for a fresh Claude session in a project folder.
 * `{cwd}` and `{name}` in each arg are replaced with single-quote-safe text
 * (templates should wrap them in `'…'` themselves).
 */
function planLaunchNew({ launchNew, cwd, name, profile }) {
  const safeCwd = escapeForSingleQuoted(cwd ?? '');
  const safeName = escapeForSingleQuoted(name ?? '');
  const substituted = (launchNew.args ?? []).map(arg =>
    String(arg).replaceAll('{cwd}', safeCwd).replaceAll('{name}', safeName)
  );
  return {
    command: launchNew.command,
    args: applyWtProfile(substituted, profile),
  };
}

export { basenameOfCwd, pickOpenProjectSession, escapeForSingleQuoted, planLaunchNew };
