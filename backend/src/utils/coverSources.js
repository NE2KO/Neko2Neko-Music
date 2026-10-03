import { searchCoverArt as searchMusicBrainz } from './musicbrainz.js';
import { searchYouTube } from './youtube.js';

const DEEZER_BASE = 'https://api.deezer.com';
const ITUNES_BASE = 'https://itunes.apple.com';
const USER_AGENT = 'Music/1.0 (media-server)';

// === Relevance scoring for cover art results ===
function tokenize(str) {
  return str.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(t => t.length >= 1);
}

// Loose artist-relationship check: true when two artist strings likely refer
// to the same act (handles K-pop romanization variance like Weeekly/WEEEKLY).
function artistsRelated(a, b) {
  const na = (a || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const nb = (b || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (!na || !nb) return true; // can't tell — don't penalize
  if (na.includes(nb) || nb.includes(na)) return true;
  for (let len = Math.min(na.length, nb.length); len >= 4; len--) {
    for (let i = 0; i + len <= na.length; i++) {
      if (nb.includes(na.substr(i, len))) return true;
    }
  }
  return false;
}

const NEGATIVE_KEYWORDS = ['remix','nightcore','sped up','slowed','instrumental','piano','reaction','live','acoustic','karaoke','version','feat','ft.'];

function scoreResult(result, artist, album, track) {
  const resultArtist = (result.release?.artist || '').toLowerCase();
  const resultTitle = (result.release?.title || '').toLowerCase();
  const hasArtist = !!(artist && artist.trim());
  const hasAlbum = !!(album && album.trim());
  const hasTrack = !!(track && track.trim());
  if (!hasArtist && !hasAlbum && !hasTrack) return 50;

  // Track always dominant, artist bonus but not at expense of track
  let wArtist = hasArtist ? 0.15 : 0;
  let wAlbum = hasAlbum ? 0.10 : 0;
  let wTrack = hasTrack ? 0.60 : 0;
  let wExact = hasArtist ? 0.15 : 0;
  if (!hasArtist && !hasAlbum && hasTrack) {
    wTrack = 0.80;
    wExact = 0.05;
  } else if (!hasArtist && hasTrack) {
    wTrack = 0.70;
    wExact = 0.05;
  }
  const totalW = wArtist + wAlbum + wTrack + wExact || 1;
  wArtist /= totalW; wAlbum /= totalW; wTrack /= totalW; wExact /= totalW;

  let score = 0;
  const qTrackTokens = hasTrack ? tokenize(track) : [];
  const qArtistTokens = hasArtist ? tokenize(artist) : [];
  const qAlbumTokens = hasAlbum ? tokenize(album) : [];

  // Track/title match (adaptive)
  if (hasTrack && resultTitle) {
    const tTokens = tokenize(resultTitle);
    const matched = qTrackTokens.filter(qt => tTokens.some(tt => tt.includes(qt) || qt.includes(tt))).length;
    const ratio = qTrackTokens.length ? matched / qTrackTokens.length : 0;
    score += ratio * wTrack * 100;
  } else if (hasTrack && !resultTitle) {
    // No title in result, don't penalize heavily, just no add
  }

  // Artist match (adaptive)
  if (hasArtist && resultArtist) {
    const aTokens = tokenize(resultArtist);
    const matched = qArtistTokens.filter(qt => aTokens.some(at => at.includes(qt) || qt.includes(at))).length;
    const ratio = qArtistTokens.length ? matched / qArtistTokens.length : 0;
    score += ratio * wArtist * 100;
  }

  // Album match (adaptive)
  if (hasAlbum && resultTitle) {
    const alTokens = tokenize(album);
    const tTokens = tokenize(resultTitle);
    const matched = alTokens.filter(qt => tTokens.some(tt => tt.includes(qt) || qt.includes(tt))).length;
    const ratio = alTokens.length ? matched / alTokens.length : 0;
    score += ratio * wAlbum * 100;
  }

  // Exact artist bonus (adaptive wExact)
  if (hasArtist && resultArtist) {
    const aNorm = artist.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const rNorm = resultArtist.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (aNorm === rNorm || rNorm.includes(aNorm) || aNorm.includes(rNorm)) {
      score += wExact * 100;
    }
  }

  // Penalize if artist clearly unrelated (different group's same title)
  if (hasArtist && resultArtist && !artistsRelated(artist, resultArtist)) {
    score = score * 0.3;
  }

  // Negative evidence: candidate contains remix/cover etc. but query doesn't
  const lowerResultTitle = resultTitle;
  const lowerQueryTrack = (track || '').toLowerCase();
  for (const neg of NEGATIVE_KEYWORDS) {
    if (lowerResultTitle.includes(neg) && !lowerQueryTrack.includes(neg)) {
      score = score * 0.6; // penalize 40%
      break;
    }
  }

  return Math.min(100, Math.round(score));
}

function scoreAndSort(results, artist, album, track) {
  return results
    .map(r => ({ ...r, score: scoreResult(r, artist, album, track) }))
    .sort((a, b) => b.score - a.score);
}

// === Deezer: structured search ===
async function deezerSearch(artist, album, track) {
  try {
    const parts = [];
    if (track) parts.push(`track:"${track}"`);
    if (artist) parts.push(`artist:"${artist}"`);
    if (album) parts.push(`album:"${album}"`);
    if (parts.length === 0) return [];
    const query = parts.join(' ');
    return deezerFetch(query);
  } catch { return []; }
}

// === Deezer: free-text query search ===
async function deezerSearchQuery(query) {
  try {
    if (!query) return [];
    return deezerFetch(query);
  } catch { return []; }
}

async function deezerFetch(query) {
  const url = `${DEEZER_BASE}/search?q=${encodeURIComponent(query)}&limit=15&order=RANKING`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return [];
  const data = await res.json();
  if (!data?.data) return [];
  const seen = new Set();
  return data.data.filter(d => {
    if (!d.album?.cover) return false;
    const key = d.album.cover;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(d => ({
    source: 'Deezer',
    release: {
      id: String(d.album.id),
      title: d.album.title,
      artist: d.artist?.name || '',
    },
    cover: {
      id: String(d.id),
      image: d.album.cover_xl || d.album.cover_big || d.album.cover_medium || d.album.cover,
      thumbnails: {
        '250': d.album.cover_small,
        '500': d.album.cover_medium,
        '1200': d.album.cover_xl || d.album.cover_big,
      },
    },
  }));
}

// === iTunes: structured search ===
async function itunesSearch(artist, album, track) {
  try {
    const terms = [track, artist, album].filter(Boolean).join(' ');
    if (!terms) return [];
    return itunesFetch(terms);
  } catch { return []; }
}

// === iTunes: free-text query search ===
async function itunesSearchQuery(query) {
  try {
    if (!query) return [];
    return itunesFetch(query);
  } catch { return []; }
}

async function itunesFetch(term) {
  const url = `${ITUNES_BASE}/search?term=${encodeURIComponent(term)}&limit=25&entity=song`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return [];
  const data = await res.json();
  if (!data?.results) return [];
  const seen = new Set();
  return data.results.filter(r => {
    if (!r.artworkUrl100) return false;
    const key = r.artworkUrl100.replace(/\/\d+x\d+bb\.jpg$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(r => {
    const base = r.artworkUrl100.replace(/100x100bb/, '1200x1200bb');
    return {
      source: 'iTunes',
      release: {
        id: String(r.trackId),
        title: r.collectionName || r.trackName,
        artist: r.artistName,
      },
      cover: {
        id: String(r.trackId),
        image: base,
        thumbnails: {
          '100': r.artworkUrl100,
          '1200': base,
        },
      },
    };
  });
}

// === MusicBrainz: free-text query search ===
async function musicbrainzSearchQuery(query) {
  try {
    if (!query) return [];
    const results = await searchMusicBrainz('', '', query);
    return results.map(r => ({ ...r, source: 'MusicBrainz' }));
  } catch { return []; }
}

// === Query variation generator ===
function cleanQuery(query) {
  return query
    .replace(/\([\s\S]*?\)/g, ' ')       // remove (parentheses)
    .replace(/[[\]「」『』⧸]/g, ' ')      // remove brackets
    .replace(/[_\-–—|/]/g, ' ')          // remove underscores / dashes / separators
    .replace(/\bfeat\.?\s*.*/i, '')       // remove feat. and everything after
    .replace(/\bft\.?\s*.*/i, '')         // remove ft. and everything after
    .replace(/\bremix\b/gi, '')           // remove remix
    .replace(/\bversion\b/gi, '')         // remove version
    .replace(/\blive\b/gi, '')            // remove live
    .replace(/\bacoustic\b/gi, '')        // remove acoustic
    .replace(/\bkaraoke\b/gi, '')         // remove karaoke
    .replace(/\bcover\b/gi, '')           // remove cover
    .replace(/\s+/g, ' ')
    .trim();
}

function generateQueryVariations(query) {
  const raw = query.trim();
  const cleaned = cleanQuery(query);
  const variations = [];
  if (raw) variations.push(raw);
  if (cleaned && cleaned !== raw) variations.push(cleaned);
  const words = cleaned.split(/\s+/).filter(Boolean);

  // Add "OST" suffix for game/anime music
  if (!/ost/i.test(cleaned)) {
    variations.push(cleaned + ' OST');
  }

  // Try artist+track and track+artist combos
  if (words.length >= 4) {
    variations.push(words.slice(-3).join(' '));
    variations.push(words.slice(0, 3).join(' '));
    variations.push(words.slice(-2).join(' '));
  } else if (words.length === 3) {
    variations.push(words.slice(-2).join(' '));
    variations.push(words.slice(0, 2).join(' '));
  }

  // Try just the last significant word (often the track name)
  if (words.length >= 2) {
    const last = words[words.length - 1];
    if (last.length > 2) variations.push(last);
  }

  // Remove duplicates
  return [...new Set(variations)];
}

// === Search cover by free-text query (with variations) ===
async function searchCoverByQuery(query) {
  if (!query || !query.trim()) return [];

  const variations = generateQueryVariations(query);
  const allResults = [];
  const seenUrls = new Set();

  function pushResults(results) {
    for (const r of results) {
      const url = r.cover?.image;
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        allResults.push(r);
      }
    }
  }

  // Run Deezer + iTunes + YouTube + MusicBrainz in parallel for first variation.
  const firstVar = variations[0];
  const querySources = await Promise.allSettled([
    deezerSearchQuery(firstVar).catch(() => []),
    itunesSearchQuery(firstVar).catch(() => []),
    searchYouTube(firstVar).catch(() => []),
    musicbrainzSearchQuery(firstVar).catch(() => []),
  ]);
  for (const r of querySources) {
    if (r.status === 'fulfilled') pushResults(r.value);
  }

  // If still need more results, try remaining variations (sequentially, early exit)
  if (allResults.length < 12 && variations.length > 1) {
    for (let i = 1; i < variations.length; i++) {
      const dz = await deezerSearchQuery(variations[i]);
      pushResults(dz);
      if (allResults.length >= 12) break;
      const it = await itunesSearchQuery(variations[i]);
      pushResults(it);
      if (allResults.length >= 12) break;
    }
  }

  return scoreAndSort(allResults, '', '', variations[0]);
}

// === Combined search: merge structured metadata search + free-text query ===
export async function searchCoverAllSources(artist, album, track, query) {
  // Clean the structured terms so Deezer/iTunes/MusicBrainz match correctly
  // (e.g. "Weeekly(위클리)" -> "Weeekly", "Weeekly _ After School" -> "Weeekly After School").
  const cleanA = cleanQuery(artist || '');
  const cleanT = cleanQuery(track || '');
  const cleanAl = cleanQuery(album || '');
  const hasMeta = cleanA || cleanT || cleanAl;
  const hasQuery = query && query.trim();

  const results = [];
  const seenUrls = new Set();
  const pushResults = (arr) => {
    for (const r of (arr || [])) {
      const url = r.cover?.image;
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        results.push(r);
      }
    }
  };

  // Structured metadata search (most accurate when artist/track are known).
  // Include YouTube with artist+track for Japanese titles like Tententengokujigokugoku
  if (hasMeta) {
    const structuredQuery = [cleanA, cleanT].filter(Boolean).join(' ').trim();
    const structuredSources = await Promise.allSettled([
      searchMusicBrainz(cleanA, cleanAl, cleanT).then(r => r.map(x => ({ ...x, source: 'MusicBrainz' }))).catch(() => []),
      deezerSearch(cleanA, cleanAl, cleanT).catch(() => []),
      itunesSearch(cleanA, cleanAl, cleanT).catch(() => []),
      (structuredQuery ? searchYouTube(structuredQuery).catch(() => []) : Promise.resolve([])),
    ]);
    for (const r of structuredSources) {
      if (r.status === 'fulfilled') pushResults(r.value);
    }

    // If still few results, try a cleaned track name (strip feat/remix/etc).
    if (results.length < 5 && cleanT) {
      const cleanedTrack = cleanT
        .replace(/\bfeat\.?\s*.*/i, '')
        .replace(/\bft\.?\s*.*/i, '')
        .replace(/\bremix\b/gi, '')
        .replace(/\bversion\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanedTrack && cleanedTrack !== cleanT) {
        const cleanedSources = await Promise.allSettled([
          deezerSearch(cleanA, '', cleanedTrack).catch(() => []),
          itunesSearch(cleanA, '', cleanedTrack).catch(() => []),
        ]);
        for (const r of cleanedSources) {
          if (r.status === 'fulfilled') pushResults(r.value);
        }
      }
    }
  }

  // Free-text query search (broad: Deezer + iTunes + YouTube + MusicBrainz).
  if (hasQuery) {
    pushResults(await searchCoverByQuery(query));
  }

  if (results.length > 0) {
    // Use full query for scoring when available, otherwise cleanT
    // For Tententengokujigokugoku case, track alone gives 0 but full query with artist gives 67 — need to score with best of track / query
    const scoreTrack = hasQuery ? cleanQuery(query) : cleanT;
    const scoreArtist = hasQuery && cleanA ? cleanA : cleanA;
    // Also try scoring with full query as track for YouTube results that need artist
    const scored = scoreAndSort(results.slice(0, 30), scoreArtist, cleanAl, scoreTrack);
    // If free query exists, also score with query as track for comparison and keep best
    if (hasQuery && hasMeta) {
      const altScored = scoreAndSort(results.slice(0, 30), cleanA, cleanAl, cleanQuery(query));
      // Merge best scores: keep max per URL
      const bestByUrl = new Map();
      for (const r of [...scored, ...altScored]) {
        const url = r.cover?.image;
        const existing = bestByUrl.get(url);
        if (!existing || r.score > existing.score) bestByUrl.set(url, r);
      }
      return [...bestByUrl.values()].sort((a,b)=>b.score-a.score);
    }
    return scored;
  }

  // Last resort: YouTube with best fallback — prefer artist+track, then track, then query
  const lastResortCandidates = [];
  if (hasQuery) lastResortCandidates.push(query);
  const artistTrack = [cleanA, cleanT].filter(Boolean).join(' ').trim();
  if (artistTrack && !lastResortCandidates.includes(artistTrack)) lastResortCandidates.push(artistTrack);
  if (cleanT && !lastResortCandidates.includes(cleanT)) lastResortCandidates.push(cleanT);
  if (cleanA && !lastResortCandidates.includes(cleanA)) lastResortCandidates.push(cleanA);
  for (const cand of lastResortCandidates) {
    try {
      const ytResults = await searchYouTube(cand);
      if (ytResults.length) {
        const scoreT = hasQuery ? cleanQuery(query) : cleanT;
        return scoreAndSort(ytResults, cleanA, cleanAl, scoreT);
      }
    } catch {}
  }
  return [];
}
