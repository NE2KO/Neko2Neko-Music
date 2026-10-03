const GENIUS_BASE = 'https://genius.com';

async function geniusFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Music/1.0)',
        'Accept': 'text/html',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchGenius(artist, track) {
  if (!track) return null;
  
  const query = encodeURIComponent(`${artist} ${track}`.trim());
  const url = `https://genius.com/search?q=${query}`;
  const html = await geniusFetch(url);
  if (!html) return null;
  
  // Parse search results from HTML
  const match = html.match(/<a[^>]*href="([^"]*genius.com[^"]*lyrics[^"]*)"[^>]*>/i);
  if (!match) return null;
  
  const lyricsUrl = match[1];
  const lyricsHtml = await geniusFetch(lyricsUrl);
  if (!lyricsHtml) return null;
  
  // Extract lyrics from page
  const lyricsMatch = lyricsHtml.match(/<div[^>]*class="lyrics"[^>]*>([\s\S]*?)<\/div>/i);
  if (!lyricsMatch) return null;
  
  const plainLyrics = lyricsMatch[1]
    .replace(/<[^>]*>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/\n\s*\n/g, '\n')
    .trim();
  
  if (!plainLyrics) return null;
  
  return {
    id: null,
    trackName: track,
    artistName: artist || '',
    albumName: '',
    duration: null,
    plainLyrics,
    syncedLyrics: null,
    instrumental: false,
    source: 'Genius',
  };
}