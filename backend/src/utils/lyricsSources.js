import { getLyrics, searchLyrics } from './lrclib.js';
import { searchLrcmux, searchLrcmuxByQuery } from './lrcmux.js';
import { searchGenius } from './genius.js';
import { searchNetEase, searchNetEaseByQuery } from './netease.js';
import { hasJapanese, generateRomajiLyrics } from './romaji.js';
import { searchPyjlyric } from './pyjlyric.js';

function dedup(results, seen) {
  return results.filter(r => {
    const key = `${r.trackName}|${r.artistName}|${r.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// === Search by structured metadata ===
export async function searchLyricsAllSources(trackName, artistName, albumName, duration) {
  const seen = new Set();
  const allResults = [];

  // Run all primary sources in parallel for speed.
  const query = [trackName, artistName].filter(Boolean).join(' ');
  const primarySources = await Promise.allSettled([
    getLyrics(trackName, artistName, albumName, duration),
    query ? searchLyrics(query) : Promise.resolve([]),
    searchLrcmux(artistName, trackName, albumName, duration).catch(() => null),
    query ? searchPyjlyric(query) : Promise.resolve([]),
    searchGenius(artistName, trackName).catch(() => null),
    searchNetEase(artistName, trackName, albumName, duration).catch(() => []),
  ]);

  // 1. LRCLIB exact match (most reliable)
  const lrclibExact = primarySources[0];
  if (lrclibExact.status === 'fulfilled' && lrclibExact.value) {
    allResults.push(lrclibExact.value);
  }

  // 2. LRCLIB search
  const lrclibSearch = primarySources[1];
  if (lrclibSearch.status === 'fulfilled') {
    allResults.push(...dedup(lrclibSearch.value || [], seen));
  }

  // 3. lrcmux
  const lrcmuxResult = primarySources[2];
  if (lrcmuxResult.status === 'fulfilled' && lrcmuxResult.value?.plainLyrics || lrcmuxResult.value?.syncedLyrics) {
    allResults.push(lrcmuxResult.value);
  }

  // 4. pyjlyric
  const pyjlyricResult = primarySources[3];
  if (pyjlyricResult.status === 'fulfilled') {
    allResults.push(...dedup(pyjlyricResult.value || [], seen));
  }

  // 5. Genius
  const geniusResult = primarySources[4];
  if (geniusResult.status === 'fulfilled' && geniusResult.value?.plainLyrics) {
    allResults.push(geniusResult.value);
  }

  // 6. NetEase
  const neteaseResult = primarySources[5];
  if (neteaseResult.status === 'fulfilled') {
    allResults.push(...dedup(neteaseResult.value || [], seen));
  }

  // 7. Try cleaned track name on LRCLIB + lrcmux (only if few results so far)
  if (allResults.length < 3) {
    const cleanedTrack = trackName
      .replace(/\bfeat\.?\s*.*/i, '')
      .replace(/\bft\.?\s*.*/i, '')
      .replace(/\bremix\b/gi, '')
      .replace(/\bversion\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleanedTrack && cleanedTrack !== trackName) {
      const cleanedSources = await Promise.allSettled([
        searchLyrics(cleanedTrack),
        searchLrcmux(artistName, cleanedTrack, albumName, duration).catch(() => null),
      ]);
      const cl1 = cleanedSources[0];
      if (cl1.status === 'fulfilled') allResults.push(...dedup(cl1.value || [], seen));
      const cl2 = cleanedSources[1];
      if (cl2.status === 'fulfilled' && cl2.value?.plainLyrics || cl2.value?.syncedLyrics) {
        allResults.push(cl2.value);
      }
    }
  }

  // 8. Try artist-only search (only if still few results)
  if (allResults.length < 3 && artistName) {
    try {
      const results = await searchLyrics(artistName);
      allResults.push(...dedup(results, seen));
    } catch (err) {
      console.error('[lyrics] LRCLIB artist-only error:', err.message);
    }
  }

  // Generate romaji for Japanese lyrics
  return Promise.all(allResults.map(async r => {
    const text = r.plainLyrics || r.syncedLyrics || '';
    if (hasJapanese(text)) {
      return { ...r, romajiLyrics: await generateRomajiLyrics(r.plainLyrics, r.syncedLyrics) };
    }
    return r;
  }));
}

// === Search by free-text query ===
export async function searchLyricsByQuery(query) {
  if (!query || !query.trim()) return [];

  const seen = new Set();
  let q = query.trim();
  const allResults = [];

  // Run all raw query sources in parallel for speed.
  const rawSources = await Promise.allSettled([
    searchLyrics(q).catch(() => []),
    searchLrcmuxByQuery(q).catch(() => null),
    searchPyjlyric(q).catch(() => []),
    searchNetEaseByQuery(q).catch(() => []),
  ]);

  // 1. LRCLIB raw query
  const lrclibRaw = rawSources[0];
  if (lrclibRaw.status === 'fulfilled' && lrclibRaw.value?.length > 0) {
    allResults.push(...dedup(lrclibRaw.value, seen));
  }

  // 2. lrcmux raw query
  const lrcmuxRaw = rawSources[1];
  if (lrcmuxRaw.status === 'fulfilled' && (lrcmuxRaw.value?.plainLyrics || lrcmuxRaw.value?.syncedLyrics)) {
    allResults.push(lrcmuxRaw.value);
  }

  // 3. pyjlyric
  const pyjRaw = rawSources[2];
  if (pyjRaw.status === 'fulfilled') {
    allResults.push(...dedup(pyjRaw.value || [], seen));
  }

  // 4. NetEase
  const neRaw = rawSources[3];
  if (neRaw.status === 'fulfilled') {
    allResults.push(...dedup(neRaw.value || [], seen));
  }

  // 5. Clean query: remove cover markers, special brackets, feat., remix, etc.
  let cleaned = q
    .replace(/^【[^】]*】\s*/g, '')
    .replace(/[⧸【】\[\]「」『』]/g, ' ')
    .replace(/\bfeat\.?\s*.*/i, '')
    .replace(/\bft\.?\s*.*/i, '')
    .replace(/\bremix\b/gi, '')
    .replace(/\bversion\b/gi, '')
    .replace(/\blive\b/gi, '')
    .replace(/\bacoustic\b/gi, '')
    .replace(/\bkaraoke\b/gi, '')
    .replace(/\bcover\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // If cleaned is different from raw, try LRCLIB + lrcmux + Genius in parallel
  if (cleaned && cleaned !== q) {
    const cleanedSources = await Promise.allSettled([
      searchLyrics(cleaned).catch(() => []),
      searchLrcmuxByQuery(cleaned).catch(() => null),
      searchGenius('', cleaned).catch(() => null),
    ]);

    const cl1 = cleanedSources[0];
    if (cl1.status === 'fulfilled') allResults.push(...dedup(cl1.value || [], seen));
    const cl2 = cleanedSources[1];
    if (cl2.status === 'fulfilled' && (cl2.value?.plainLyrics || cl2.value?.syncedLyrics)) {
      allResults.push(cl2.value);
    }
    const cl3 = cleanedSources[2];
    if (cl3.status === 'fulfilled' && cl3.value?.plainLyrics) {
      allResults.push(cl3.value);
    }
  }

  // 6. Try to parse as "Artist Track" (split at midpoint)
  const words = cleaned.split(/\s+/);
  if (words.length >= 2) {
    const mid = Math.ceil(words.length / 2);
    const artistGuess = words.slice(0, mid).join(' ');
    const trackGuess = words.slice(mid).join(' ');
    const revArtist = words.slice(mid).join(' ');
    const revTrack = words.slice(0, mid).join(' ');
    const lastTwo = words.length >= 3 ? words.slice(-2).join(' ') : null;
    const lastWord = words[words.length - 1];

    // Run all split-based searches in parallel
    const splitSources = await Promise.allSettled([
      getLyrics(trackGuess, artistGuess, '', null).catch(() => null),
      searchLyrics(`${trackGuess} ${artistGuess}`).catch(() => []),
      searchGenius(artistGuess, trackGuess).catch(() => null),
      getLyrics(revTrack, revArtist, '', null).catch(() => null),
      lastTwo ? searchLyrics(lastTwo).catch(() => []) : Promise.resolve([]),
      lastWord?.length > 2 ? searchLyrics(lastWord).catch(() => []) : Promise.resolve([]),
    ]);

    const s1 = splitSources[0];
    if (s1.status === 'fulfilled' && s1.value) allResults.push(s1.value);
    const s2 = splitSources[1];
    if (s2.status === 'fulfilled') allResults.push(...dedup(s2.value || [], seen));
    const s3 = splitSources[2];
    if (s3.status === 'fulfilled' && s3.value?.plainLyrics) allResults.push(s3.value);
    const s4 = splitSources[3];
    if (s4.status === 'fulfilled' && s4.value) allResults.push(s4.value);
    const s5 = splitSources[4];
    if (s5.status === 'fulfilled') allResults.push(...dedup(s5.value || [], seen));
    const s6 = splitSources[5];
    if (s6.status === 'fulfilled') allResults.push(...dedup(s6.value || [], seen));
  }

  // Generate romaji for Japanese lyrics
  return Promise.all(allResults.map(async r => {
    const text = r.plainLyrics || r.syncedLyrics || '';
    if (hasJapanese(text)) {
      return { ...r, romajiLyrics: await generateRomajiLyrics(r.plainLyrics, r.syncedLyrics) };
    }
    return r;
  }));
}

// === Combined: prefer free-text query when available, fallback to metadata ===
export async function searchLyricsCombined(trackName, artistName, albumName, duration, query) {
  // Phase 1: free-text query (most specific when user typed something)
  if (query && query.trim()) {
    const queryResults = await searchLyricsByQuery(query);
    if (queryResults.length > 0) return queryResults;
  }

  // Phase 2: metadata
  if (trackName) {
    const metaResults = await searchLyricsAllSources(trackName, artistName, albumName, duration);
    if (metaResults.length > 0) return metaResults;
  }

  return [];
}
