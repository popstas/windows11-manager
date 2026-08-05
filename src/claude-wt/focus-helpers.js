/** Pure helpers for focusing a tracked Claude session by id. No I/O. */

/**
 * Decide what focusing session `id` needs, without touching Windows.
 *
 * The caller has one window handle to find and one title to find it by, so the
 * only thing worth deciding here is which title — and every way that can fail.
 * Refusals carry a reason: the picker shows it, and "nothing happened" would be
 * indistinguishable from a window that quietly refused the foreground.
 *
 * @param {Array<{id: string, title?: string}>} slots — as returned by claudeWtStatus()
 * @param {string} id
 * @returns {{ok: true, title: string} | {ok: false, reason: string}}
 */
function planFocus(slots, id) {
  if (typeof id !== 'string' || !id) return { ok: false, reason: 'id is required' };
  const slot = (Array.isArray(slots) ? slots : []).find(s => s?.id === id);
  if (!slot) return { ok: false, reason: `unknown session ${id}` };
  // A slot without a title is a slot the tracker never bound to a window:
  // normalizeState drops title-less slots, so this only happens on a state file
  // written by hand. Matching an empty title would grab an arbitrary terminal.
  if (typeof slot.title !== 'string' || !slot.title) {
    return { ok: false, reason: `session ${id} has no window title` };
  }
  return { ok: true, title: slot.title };
}

export { planFocus };
