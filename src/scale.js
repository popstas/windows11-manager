function adjustBoundsForScale({ bounds, oldScale, newScale, widthSpecified = true, heightSpecified = true }) {
  if (!bounds) return bounds;
  if (oldScale === undefined || newScale === undefined) return bounds;
  if (oldScale === newScale) return bounds;
  const scaleFix = oldScale / newScale;
  const res = { ...bounds };
  if (!widthSpecified && res.width !== undefined) res.width = Math.round(res.width * scaleFix);
  if (!heightSpecified && res.height !== undefined) res.height = Math.round(res.height * scaleFix);
  return res;
}

module.exports = { adjustBoundsForScale };
