/**
 * Strip existing WT `-p` pairs from the option prefix and optionally reinject
 * a profile. Stops at the first positional (non-flag) token so inner commands
 * like `ssh -p 2222` keep their own `-p`. Pure.
 */
function applyWtProfile(args, profile) {
  const src = Array.isArray(args) ? args : [];
  const stripped = [];
  let i = 0;
  while (i < src.length) {
    const t = src[i];
    if (typeof t === 'string' && !t.startsWith('-')) break; // end of wt prefix
    if (t === '-p') {
      i += 1; // skip profile name
      if (i < src.length) i += 1;
      continue;
    }
    stripped.push(t);
    i += 1;
    // Value for a wt flag that takes one (`-w <n>`, `--window <n>`, …).
    if ((t === '-w' || t === '--window') && i < src.length) {
      stripped.push(src[i]);
      i += 1;
    }
  }
  while (i < src.length) {
    stripped.push(src[i]);
    i += 1;
  }

  const name = typeof profile === 'string' ? profile.trim() : '';
  if (!name) return stripped;

  let insertAt = 0;
  if (stripped[0] === '-w' && stripped.length >= 2) insertAt = 2;
  return [...stripped.slice(0, insertAt), '-p', name, ...stripped.slice(insertAt)];
}

export { applyWtProfile };
