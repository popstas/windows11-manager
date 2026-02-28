function getGapBounds({ monBounds, gap }) {
  const gapSize = gap.gap;
  switch (gap.position) {
    case 'bottom':
      return {
        x: monBounds.x,
        y: monBounds.y + monBounds.height - gapSize,
        width: monBounds.width,
        height: gapSize,
      };
    case 'top':
      return {
        x: monBounds.x,
        y: monBounds.y,
        width: monBounds.width,
        height: gapSize,
      };
    case 'left':
      return {
        x: monBounds.x,
        y: monBounds.y,
        width: gapSize,
        height: monBounds.height,
      };
    case 'right':
      return {
        x: monBounds.x + monBounds.width - gapSize,
        y: monBounds.y,
        width: gapSize,
        height: monBounds.height,
      };
    default:
      return undefined;
  }
}

function getGapOverlap({ pos, monBounds, gap }) {
  const gapBounds = getGapBounds({ monBounds, gap });
  if (!gapBounds) return;

  const x1 = Math.max(pos.x, gapBounds.x);
  const y1 = Math.max(pos.y, gapBounds.y);
  const x2 = Math.min(pos.x + pos.width, gapBounds.x + gapBounds.width);
  const y2 = Math.min(pos.y + pos.height, gapBounds.y + gapBounds.height);

  if (x2 <= x1 || y2 <= y1) return;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function applyMonitorsOffset({ pos, offset }) {
  if (!offset) return;

  const left = Number(offset.left) || 0;
  const right = Number(offset.right) || 0;
  const top = Number(offset.top) || 0;
  const bottom = Number(offset.bottom) || 0;

  pos.x += left;
  pos.y += top;
  pos.width = Math.max(0, pos.width - left - right);
  pos.height = Math.max(0, pos.height - top - bottom);
}

function applyMonitorGaps({ pos, monBounds, monitorGaps }) {
  if (!monitorGaps) return;

  const gaps = Array.isArray(monitorGaps) ? monitorGaps : [monitorGaps];
  for (const gap of gaps) {
    if (!gap || typeof gap.gap !== 'number' || gap.gap <= 0) continue;
    const overlap = getGapOverlap({ pos, monBounds, gap });
    if (!overlap) continue;

    if (gap.position === 'bottom') {
      pos.height = Math.max(0, pos.height - overlap.height);
    } else if (gap.position === 'top') {
      pos.y += overlap.height;
      pos.height = Math.max(0, pos.height - overlap.height);
    } else if (gap.position === 'left') {
      pos.x += overlap.width;
      pos.width = Math.max(0, pos.width - overlap.width);
    } else if (gap.position === 'right') {
      pos.width = Math.max(0, pos.width - overlap.width);
    }
  }
}

function isBoundsMatch(oldPos, newPos) {
  for (let name in newPos) {
    if (newPos[name] === undefined) continue;
    const isExactlyPlaced = oldPos[name] === newPos[name];
    const isPixelPlaced = Math.abs(oldPos[name] - newPos[name]) < 2;
    if (!isExactlyPlaced && !isPixelPlaced) return false;
  }
  return true;
}

export { getGapBounds, getGapOverlap, isBoundsMatch, applyMonitorsOffset, applyMonitorGaps };
