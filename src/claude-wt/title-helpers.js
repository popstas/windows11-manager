/** Pure helpers for terminal window titles. No external I/O. */

// A leading symbol run followed by whitespace: Claude Code prefixes the
// terminal title with a status glyph while it is working ("✳ Check branch
// commit count"), and the ccfzf dump stores the bare summary. Matched by
// Unicode symbol category rather than by a fixed character, because the glyph
// is a status indicator and may change between Claude Code versions.
//
// Only symbols (\p{S}) are stripped, never punctuation: a session title that
// genuinely opens with a quote or a dash must survive intact, or the two sides
// of the comparison would stop lining up.
const DECORATION = /^\p{S}+\s+/u;

// Приставка zellij: внутри него заголовок окна терминала — «<сессия> | <панель>»
// (снято 2026-10-23: «popstas | ✳ budva-day-5»), и окно не совпадало ни с одной
// сессией дампа. Снимается до глифа, потому что глиф стоит уже после неё.
// Имя сессии zellij — одно слово без пробелов, поэтому и приставка — одно
// слово: «Some App | thing» остаётся целым, это заголовок чужого окна.
const ZELLIJ_PREFIX = /^[^\s|]+ \| /u;

/** The form both the window title and the dump title are compared in. */
function stripTitleDecoration(title) {
  if (typeof title !== 'string') return '';
  return title.trim().replace(ZELLIJ_PREFIX, '').replace(DECORATION, '').trim();
}

export { stripTitleDecoration };
