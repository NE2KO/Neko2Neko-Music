import { fetchPlaylists, fetchPlaylistById, fetchPlaylistPlay, scanPlaylists } from '../utils/api';

/**
 * Fetch all playlists from server
 */
export async function loadPlaylists() {
  try {
    const data = await fetchPlaylists();
    return data;
  } catch (err) {
    console.error('[playlistApi] Failed to load playlists:', err);
    throw err;
  }
}

/**
 * Fetch single playlist with tracks
 */
export async function loadPlaylist(id) {
  try {
    const data = await fetchPlaylistById(id);
    return data;
  } catch (err) {
    console.error('[playlistApi] Failed to load playlist:', err);
    throw err;
  }
}

/**
 * Get playback-ready queue from playlist
 */
export async function getPlaylistQueue(id) {
  try {
    const data = await fetchPlaylistPlay(id);
    return data;
  } catch (err) {
    console.error('[playlistApi] Failed to get playlist queue:', err);
    throw err;
  }
}

/**
 * Trigger playlist scan
 */
export async function refreshPlaylists() {
  try {
    const data = await scanPlaylists();
    return data;
  } catch (err) {
    console.error('[playlistApi] Failed to scan playlists:', err);
    throw err;
  }
}

/**
 * Create manual playlist from selected files
 */
export async function createManualPlaylist(title, fileIds) {
  try {
    const res = await fetch('/api/playlists/create/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, fileIds }),
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create manual playlist');
    }
    
    return await res.json();
  } catch (err) {
    console.error('[playlistApi] Failed to create manual playlist:', err);
    throw err;
  }
}

/**
 * Create empty playlist with title only
 */
export async function createEmptyPlaylist(title) {
  try {
    const res = await fetch('/api/playlists/create/empty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create playlist');
    }

    return await res.json();
  } catch (err) {
    console.error('[playlistApi] Failed to create empty playlist:', err);
    throw err;
  }
}

/**
 * Add tracks to an existing playlist
 */
export async function addTracksToPlaylist(playlistId, fileIds) {
  try {
    const res = await fetch(`/api/playlists/${playlistId}/tracks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileIds }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to add tracks');
    }

    return await res.json();
  } catch (err) {
    console.error('[playlistApi] Failed to add tracks:', err);
    throw err;
  }
}

/**
 * Create folder playlist from scanned directory
 */
export async function createFolderPlaylist(folderPath, title) {
  try {
    const res = await fetch('/api/playlists/create/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath, title }),
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create folder playlist');
    }
    
    return await res.json();
  } catch (err) {
    console.error('[playlistApi] Failed to create folder playlist:', err);
    throw err;
  }
}

/**
 * Import XSPF playlist file
 */
export async function importXSPFPlaylist(file) {
  try {
    const formData = new FormData();
    formData.append('playlist', file);
    
    const res = await fetch('/api/playlists/import', {
      method: 'POST',
      body: formData,
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to import playlist');
    }
    
    return await res.json();
  } catch (err) {
    console.error('[playlistApi] Failed to import XSPF:', err);
    throw err;
  }
}

/**
 * Search available audio tracks for adding to playlist
 */
export async function searchAvailableTracks(playlistId, { sortBy = 'name', sortOrder = 'asc', type = 'all', search = '', limit } = {}) {
  try {
    const params = new URLSearchParams();
    if (sortBy) params.set('sortBy', sortBy);
    if (sortOrder) params.set('sortOrder', sortOrder);
    if (type) params.set('type', type);
    if (search) params.set('search', search);
    if (limit) params.set('limit', String(limit));

    const res = await fetch(`/api/playlists/${playlistId}/available-tracks?${params}`);
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to search tracks');
    }
    return await res.json();
  } catch (err) {
    console.error('[playlistApi] Failed to search available tracks:', err);
    throw err;
  }
}

export async function bulkRemoveTracksFromPlaylist(playlistId, trackIds) {
  const res = await fetch(`/api/playlists/${playlistId}/tracks/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackIds }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to bulk delete tracks');
  }
  return await res.json();
}

/**
 * Remove a track from a playlist
 */
export async function removeTrackFromPlaylist(playlistId, trackId) {
  try {
    const res = await fetch(`/api/playlists/${playlistId}/tracks/${trackId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to remove track');
    }
    return await res.json();
  } catch (err) {
    console.error('[playlistApi] Failed to remove track:', err);
    throw err;
  }
}

/**
 * Get all favorited ("loved") audio files as track-shaped objects.
 */
export async function loadFavorites() {
  try {
    const res = await fetch('/api/files/favorites');
    if (!res.ok) throw new Error('Failed to load favorites');
    const data = await res.json();
    return data.files || [];
  } catch (err) {
    console.error('[playlistApi] Failed to load favorites:', err);
    throw err;
  }
}

/**
 * Upload a cover image for a playlist. Returns the stored image (base64 data URL).
 */
export async function uploadPlaylistCover(playlistId, file) {
  try {
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch(`/api/playlists/${playlistId}/image`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to upload cover');
    }
    const data = await res.json();
    return data.image;
  } catch (err) {
    console.error('[playlistApi] Failed to upload cover:', err);
    throw err;
  }
}

/**
 * Resolve the display src for a playlist cover.
 * - data: URLs (uploaded) are returned as-is.
 * - absolute http(s)/protocol-relative URLs (XSPF) are returned as-is.
 * - any other non-empty value is treated as a server-hosted image under
 *   /api/playlists/:id/image.
 */
export function playlistImageUrl(playlist) {
  const img = playlist?.image;
  // Uploaded covers are stored as base64 data URLs — return as-is.
  if (/^data:/i.test(img)) return img;
  // The list endpoint only returns has_image (boolean), not the payload. If the
  // playlist has an image flag but no inline payload, resolve it via the GET
  // endpoint so the cover appears immediately (no default flash).
  const id = playlist.id ?? playlist._id;
  if (id != null && (img || playlist.has_image)) {
    if (/^(https?:|\/\/)/i.test(img)) return img;
    return `/api/playlists/${id}/image`;
  }
  return img || null;
}