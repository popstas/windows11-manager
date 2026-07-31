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

/** The form both the window title and the dump title are compared in. */
function stripTitleDecoration(title) {
  if (typeof title !== 'string') return '';
  return title.replace(DECORATION, '').trim();
}

export { stripTitleDecoration };
