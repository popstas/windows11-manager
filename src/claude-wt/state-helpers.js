/** Pure helper functions for claude-wt state. No external I/O. */

const STATE_VERSION = 1;
const MAX_TITLES = 10;

function emptyState() {
  return { version: STATE_VERSION, slots: {}, lastLayout: [], updated: 0 };
}

/** Newest first, no duplicates, bounded — a session renamed all day must not grow the file. */
function rememberTitle(titles, title) {
  const list = Array.isArray(titles) ? titles : [];
  if (!title) return list;
  return [title, ...list.filter(t => t !== title)].slice(0, MAX_TITLES);
}

function isBounds(b) {
  return Boolean(b) && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(b[k]));
}

/** Update only the fields that were passed; everything else is carried over. */
function upsertSlot(slot, { title, cwd, bounds, desktop, focusedAt, now } = {}) {
  const base = slot ?? { titles: [], cwd: '', bounds: null, desktop: null, focusedAt: 0, lastSeen: 0 };
  return {
    titles: title ? rememberTitle(base.titles, title) : base.titles,
    cwd: cwd ?? base.cwd,
    bounds: bounds ?? base.bounds,
    desktop: desktop ?? base.desktop,
    // Когда окно сессии последний раз выходило на передний план. Единственный
    // сигнал «человек это увидел», который вообще есть: Windows по нему же
    // гасит подсветку кнопки на таскбаре.
    focusedAt: focusedAt ?? base.focusedAt ?? 0,
    lastSeen: now ?? base.lastSeen,
  };
}

function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== STATE_VERSION) return emptyState();
  const slots = {};
  for (const [id, slot] of Object.entries(raw.slots ?? {})) {
    if (!slot || !Array.isArray(slot.titles) || !slot.titles.length) continue;
    if (!isBounds(slot.bounds)) continue;
    slots[id] = {
      titles: slot.titles.filter(t => typeof t === 'string' && t).slice(0, MAX_TITLES),
      cwd: typeof slot.cwd === 'string' ? slot.cwd : '',
      bounds: slot.bounds,
      desktop: Number.isFinite(slot.desktop) ? slot.desktop : null,
      // Файлы, записанные до появления поля, просто не знают о фокусе — это
      // «не смотрели», ровно то, что означает ноль.
      focusedAt: Number.isFinite(slot.focusedAt) ? slot.focusedAt : 0,
      lastSeen: Number.isFinite(slot.lastSeen) ? slot.lastSeen : 0,
    };
  }
  const lastLayout = (Array.isArray(raw.lastLayout) ? raw.lastLayout : [])
    .filter(id => typeof id === 'string' && slots[id]);
  return {
    version: STATE_VERSION,
    slots,
    lastLayout,
    updated: Number.isFinite(raw.updated) ? raw.updated : 0,
  };
}

export { STATE_VERSION, emptyState, rememberTitle, upsertSlot, normalizeState, isBounds };
