/** Strip existing -p pairs and optionally reinject a WT profile. Pure. */
function applyWtProfile(args, profile) {
  const src = Array.isArray(args) ? args : [];
  const stripped = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '-p') {
      i += 1; // skip profile name
      continue;
    }
    stripped.push(src[i]);
  }
  const name = typeof profile === 'string' ? profile.trim() : '';
  if (!name) return stripped;

  let insertAt = 0;
  if (stripped[0] === '-w' && stripped.length >= 2) insertAt = 2;
  return [...stripped.slice(0, insertAt), '-p', name, ...stripped.slice(insertAt)];
}

export { applyWtProfile };
