const LRCLIB_BASE = 'https://lrclib.net/api';
const USER_AGENT = 'Music/1.0 (media-server)';

async function lrclibFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getLyrics(trackName, artistName, albumName, duration) {
  const params = new URLSearchParams({
    track_name: trackName,
    artist_name: artistName,
  });
  if (albumName) params.set('album_name', albumName);
  if (duration) params.set('duration', String(Math.round(duration)));
  
  const url = `${LRCLIB_BASE}/get?${params}`;
  const data = await lrclibFetch(url);
  if (!data) return null;
  
  return {
    id: data.id,
    trackName: data.trackName,
    artistName: data.artistName,
    albumName: data.albumName,
    duration: data.duration,
    plainLyrics: data.plainLyrics || null,
    syncedLyrics: data.syncedLyrics || null,
    instrumental: data.instrumental || false,
  };
}

export async function searchLyrics(query) {
  const params = new URLSearchParams({ q: query });
  const url = `${LRCLIB_BASE}/search?${params}`;
  const data = await lrclibFetch(url);
  if (!data || !Array.isArray(data)) return [];
  
  return data.slice(0, 10).map(item => ({
    id: item.id,
    trackName: item.trackName,
    artistName: item.artistName,
    albumName: item.albumName,
    duration: item.duration,
    plainLyrics: item.plainLyrics || null,
    syncedLyrics: item.syncedLyrics || null,
    instrumental: item.instrumental || false,
  }));
}

export async function searchLyricsByMetadata(trackName, artistName, albumName, duration) {
  // Try exact match first
  const exact = await getLyrics(trackName, artistName, albumName, duration);
  if (exact) return [exact];
  
  // Fallback to search
  const query = [trackName, artistName].filter(Boolean).join(' ');
  return searchLyrics(query);
}
