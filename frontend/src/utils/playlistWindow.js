/**
 * Build a centered window into a playlist array.
 * Modal/carousel consume this window instead of the full 72k array.
 */
export function buildPlaylistWindow(items, selectedId, radius = 125) {
  if (!items || items.length === 0) {
    return { window: [], indexMap: new Map(), total: 0, currentIndex: -1 };
  }

  // Build index map O(n) once
  const indexMap = new Map();
  for (let i = 0; i < items.length; i++) {
    indexMap.set(items[i].id, i);
  }

  const currentIndex = indexMap.get(selectedId) ?? -1;
  if (currentIndex === -1) {
    return { window: items, indexMap, total: items.length, currentIndex: -1 };
  }

  const total = items.length;
  const half = Math.min(radius, Math.floor(total / 2));
  let start = Math.max(0, currentIndex - half);
  let end = Math.min(total, currentIndex + half + 1);
  // Expand toward the opposite edge when near start/end so the full array (or a
  // full 2*radius+1 window) is included instead of a truncated one.
  const windowLen = end - start;
  if (start === 0 && windowLen < half * 2 + 1) {
    end = Math.min(total, start + half * 2 + 1);
  } else if (end === total && windowLen < half * 2 + 1) {
    start = Math.max(0, end - half * 2 - 1);
  }

  return {
    window: items.slice(start, end),
    indexMap,
    total,
    currentIndex,
    windowCenter: currentIndex - start,
  };
}
