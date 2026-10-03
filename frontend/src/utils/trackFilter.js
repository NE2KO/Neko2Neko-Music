export function safeParseTrackFilter() {
  try {
    const raw = localStorage.getItem('trackFilterType');
    if (!raw) return 'all';
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'string') return 'all';
    return parsed;
  } catch {
    return 'all';
  }
}

export function safeParseTrackSearchQuery() {
  try {
    return localStorage.getItem('trackSearchQuery') || '';
  } catch {
    return '';
  }
}

export function applyTrackFilter(queue, filterType) {
  if (!queue || !Array.isArray(queue) || queue.length === 0) return queue;
  if (!filterType || filterType === 'all') return queue;
  return queue.filter(t => {
    if (filterType === 'is_favorite') return t.is_favorite === 1;
    const ext = (t.resolved_path || '').split('.').pop()?.toLowerCase();
    if (filterType === 'flac') return ext === 'flac';
    if (filterType === 'mp3') return ext === 'mp3';
    if (filterType === 'm4a') return ext === 'm4a';
    if (filterType === 'opus') return ext === 'opus';
    if (filterType === 'aac') return ext === 'aac';
    if (filterType === 'wav') return ext === 'wav';
    return true;
  });
}

export function applyTrackSearch(queue, query) {
  if (!queue || !Array.isArray(queue) || queue.length === 0) return queue;
  const q = (query || '').trim().toLowerCase();
  if (!q) return queue;
  return queue.filter(t => {
    const name = (t.display_name || t.title || t.name || '').toLowerCase();
    const artist = (t.artist || '').toLowerCase();
    return name.includes(q) || artist.includes(q);
  });
}