// Pure route parser for hash-based navigation. Kept framework-free (no React,
// no direct sessionStorage access) so it can be unit-tested in plain Node.

// The "Loved" section is a virtual (favorites) playlist, not a server-side one.
// It must never be passed to the playlist API (which would 404). Keep this in
// sync with the `id: 'loved'` used in PlaylistView's `selectLoved`.
export const LOVED_PLAYLIST_ID = 'loved';

export function parseHash(hash, storage) {
  const store = storage || { getItem: () => null };
  const cleaned = (hash || '').replace(/^#+/, '').trim();

  // Check storage for saved view (persisted across reloads)
  if (!cleaned || cleaned === '/') {
    const savedView = store.getItem('view') || 'media';
    if (savedView === 'monitoring') {
      const savedSub = store.getItem('monitoringSubPath') || '';
      return { type: 'monitoring', subPath: savedSub };
    }
    if (savedView === 'downloader') return { type: 'downloader' };
    if (savedView === 'adb') return { type: 'adb' };
    if (savedView === 'playlists') return { type: 'playlists' };
    if (savedView === 'audio') return { type: 'audio' };
    if (savedView === 'scrcpy') return { type: 'scrcpy' };
    return { type: 'root', view: 'media' };
  }

  const parts = cleaned.split('/').filter(Boolean);
  if (parts[0] === 'monitoring') return { type: 'monitoring', subPath: parts[1] || '' };
  if (parts[0] === 'downloader') return { type: 'downloader' };
  if (parts[0] === 'adb') return { type: 'adb' };
  if (parts[0] === 'scrcpy') return { type: 'scrcpy' };
  if (parts[0] === 'whatsapp') return { type: 'whatsapp' };
  if (parts[0] === 'sendqueue') {
    // #/sendqueue
    // #/sendqueue/<group>/<status>            (group = wa|telegram)
    // #/sendqueue/<group>/<status>/<qid>      (open item in player)
    if (parts[1] && parts[2]) {
      return { type: 'sendqueue', group: parts[1], status: parts[2], qid: parts[3] || null };
    }
    return { type: 'sendqueue' };
  }
  if (parts[0] === 'music') {
    if (parts[1] === 'playlists') {
      if (parts[2] && parts[3] === 'track' && parts[4]) {
        return { type: 'audio', playlistId: parts[2], trackFileId: parts[4] };
      }
      if (parts[2]) {
        return { type: 'playlist-detail', playlistId: parts[2] };
      }
      return { type: 'playlists' };
    }
    if (parts[1] === 'player') {
      return { type: 'audio' };
    }
    if (parts[1] === 'single' && parts[2]) {
      return { type: 'audio', fileId: parts[2] };
    }
    return { type: 'root', view: 'media' };
  }
  if (parts[0] === 'playlists') {
    if (parts[1]) {
      return { type: 'playlist-detail', playlistId: parts[1] };
    }
    return { type: 'playlists' };
  }
  if (parts[0] === 'audio') {
    // #/audio/playlist/<id>/track/<fileId>  -> trackId is the file id at parts[4]
    if (parts[1] === 'playlist' && parts[2] && parts[3] === 'track' && parts[4] !== undefined) {
      return { type: 'audio', playlistId: parts[2], trackFileId: parts[4] };
    }
    if (parts[1] === 'single' && parts[2]) {
      return { type: 'audio', fileId: parts[2] };
    }
    const tab = parts[1] || 'nowplaying';
    return { type: 'audio', tab };
  }
  if (parts[0] === 'vault' && parts[1] === 'audio') {
    return { type: 'vault-audio', fileId: parts[2] || null };
  }
  if (parts[0] === 'media' && parts[1] === 'v' && parts[2]) {
    return { type: 'root-file', fileId: parts[2] };
  }
  if (parts[0] === 'media') return { type: 'root', view: 'media' };
  if (parts[0] === 'f' && parts[1]) {
    const folderId = parts[1];
    if (parts[2] === 'v' && parts[3]) {
      if (folderId === 'root') return { type: 'root-file', fileId: parts[3] };
      return { type: 'file', folderId, fileId: parts[3] };
    }
    return { type: 'folder', folderId };
  }
  return { type: 'root', view: 'media' };
}
