// Pure helpers for building the playable queue and resolving the clicked track
// index. Kept framework-free so they can be unit-tested without React.

export function buildPlayableQueue(displayTracks) {
  if (!Array.isArray(displayTracks)) return [];
  const seen = new Set();
  return displayTracks
    .filter((t) => t && t.exists && (t.file_id || t.id))
    // Deduplicate by file_id (fall back to id when file_id is absent). In the
    // Loved playlist every track has id === file_id, so a backend that returns
    // the same file twice would otherwise create duplicate queue entries and
    // resolveClickedIndex (findIndex by id/file_id) would match the FIRST one
    // instead of the clicked track. Keep the first occurrence to preserve the
    // displayed order.
    .filter((t) => {
      const key = t.file_id != null ? t.file_id : t.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((t, i) => ({
      id: t.id != null ? t.id : undefined,
      file_id: t.file_id,
      track_index: i,
      display_name: t.display_name,
      artist: t.artist || '',
      album: t.album || '',
      duration: t.duration || 0,
      path: t.resolved_path || t.location || '',
      resolved_path: t.resolved_path,
      location: t.location,
      exists: !!t.exists && !!t.file_id,
      type: 'audio',
      ext: t.resolved_path ? t.resolved_path.split('.').pop()?.toLowerCase() || '' : '',
      size: t.size || 0,
      is_favorite: t.is_favorite || 0,
      youtube_id: t.youtube_id || null,
      video_offset: t.video_offset || 0,
    }));
}

// Resolve the clicked track's position within the playable subset by its
// stable identity (id, falling back to file_id). Returns -1 when the track is
// not in the playable subset (e.g. a missing/unresolved file) so callers can
// avoid silently falling back to the first track.
export function resolveClickedIndex(track, playableTracks) {
  if (!track || !Array.isArray(playableTracks)) return -1;
  return playableTracks.findIndex(
    (t) =>
      (t.id != null && t.id === track.id) ||
      (t.file_id != null && t.file_id === track.file_id)
  );
}
