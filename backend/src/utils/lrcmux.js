import { hasJapanese } from './romaji.js';

const LRCMUX_BASE = 'https://api.lrcmux.dev';
const USER_AGENT = 'Music/1.0 (https://github.com/CATIAA/homelab-media-server)';

async function lrcmuxFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { 
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error('[lrcmux] HTTP error:', res.status, res.statusText, url);
      return null;
    }
    const data = await res.json();
    if (!data || !data.lines || data.lines.length === 0) {
      console.error('[lrcmux] No lyrics found');
      return null;
    }
    return data;
  } catch (err) {
    console.error('[lrcmux] Fetch error:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchLrcmux(artist, track, album, duration) {
  if (!artist || !track) return null;
  const params = new URLSearchParams();
  if (artist) params.set('artist', artist);
  if (track) params.set('title', track);
  if (album) params.set('album', album);
  if (duration) params.set('duration', String(Math.round(duration)));
  params.set('format', 'json');

  const url = `${LRCMUX_BASE}/get?${params}`;
  const data = await lrcmuxFetch(url);
  if (!data || !data.lines || data.lines.length === 0) return null;

  return {
    id: null,
    trackName: data.track?.title || track,
    artistName: data.track?.artist || artist,
    albumName: data.track?.album || album || '',
    duration: data.track?.duration || duration || 0,
    plainLyrics: data.lines?.map(l => l.text).join('\n') || null,
    syncedLyrics: data.lines?.map(l => {
      const ms = l.start || 0;
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const cs = Math.floor((ms % 1000) / 10);
      return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}]${l.text}`;
    }).join('\n') || null,
    instrumental: false,
    source: data.meta?.source?.name || 'lrcmux',
  };
}

export async function searchLrcmuxByQuery(query) {
  return null;
}
