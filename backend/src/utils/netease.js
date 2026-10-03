const NETEASE_BASE = 'https://music.163.com';
const NETEASE_UA = 'Mozilla/5.0 (compatible; Music/1.0)';

function toLRC(lines) {
  if (!lines || !lines.length) return null;
  return lines
    .filter(l => l.time !== undefined && l.text)
    .map(l => {
      const ms = l.time % 1000;
      const s = Math.floor(l.time / 1000) % 60;
      const m = Math.floor(l.time / 60000);
      return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(Math.floor(ms / 10)).padStart(2, '0')}]${l.text}`;
    })
    .join('\n');
}

async function neteaseSearch(query, limit = 10) {
  try {
    const url = `${NETEASE_BASE}/api/search/get/web`;
    const body = new URLSearchParams({ s: query, type: '1', limit: String(limit) });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': NETEASE_UA },
      body: body.toString(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.result?.songs || [];
  } catch {
    return [];
  }
}

async function neteaseLyric(songId) {
  try {
    const url = `${NETEASE_BASE}/api/song/lyric?id=${songId}&lv=1&tv=1`;
    const res = await fetch(url, { headers: { 'User-Agent': NETEASE_UA } });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.lrc?.lyric || null;
  } catch {
    return null;
  }
}

function parseNetEaseLRC(lrcText) {
  if (!lrcText) return { plainLyrics: null, syncedLyrics: null };
  const lines = [];
  const plainLines = [];
  const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/g;
  for (const match of lrcText.matchAll(/\[(\d{2}):(\d{2})\.(\d{2,3})\]([^\n]*)/g)) {
    const m = parseInt(match[1], 10);
    const s = parseInt(match[2], 10);
    const cs = match[3];
    const ms = cs.length === 2 ? parseInt(cs) * 10 : parseInt(cs);
    const text = match[4].trim();
    if (text) {
      lines.push({ time: m * 60000 + s * 1000 + ms, text });
      plainLines.push(text);
    }
  }
  return {
    plainLyrics: plainLines.join('\n') || null,
    syncedLyrics: lines.length > 0 ? toLRC(lines) : null,
  };
}

export async function searchNetEase(artist, track, album, duration) {
  const query = [track, artist].filter(Boolean).join(' ');
  if (!query) return [];

  const songs = await neteaseSearch(query, 10);
  const results = [];

  for (const song of songs.slice(0, 5)) {
    const lrc = await neteaseLyric(song.id);
    if (!lrc) continue;
    const parsed = parseNetEaseLRC(lrc);
    if (!parsed.plainLyrics && !parsed.syncedLyrics) continue;
    results.push({
      id: `netease-${song.id}`,
      trackName: song.name || track,
      artistName: (song.artists || []).map(a => a.name).join(', ') || artist,
      albumName: song.album?.name || album || null,
      duration: song.duration ? Math.round(song.duration / 1000) : duration,
      plainLyrics: parsed.plainLyrics,
      syncedLyrics: parsed.syncedLyrics,
      instrumental: false,
      source: 'NetEase',
    });
  }

  return results;
}

export async function searchNetEaseByQuery(query) {
  if (!query) return [];
  const songs = await neteaseSearch(query, 10);
  const results = [];

  for (const song of songs.slice(0, 5)) {
    const lrc = await neteaseLyric(song.id);
    if (!lrc) continue;
    const parsed = parseNetEaseLRC(lrc);
    if (!parsed.plainLyrics && !parsed.syncedLyrics) continue;
    results.push({
      id: `netease-${song.id}`,
      trackName: song.name || query,
      artistName: (song.artists || []).map(a => a.name).join(', '),
      albumName: song.album?.name || null,
      duration: song.duration ? Math.round(song.duration / 1000) : null,
      plainLyrics: parsed.plainLyrics,
      syncedLyrics: parsed.syncedLyrics,
      instrumental: false,
      source: 'NetEase',
    });
  }

  return results;
}
