import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

// ──────────────────────────────────────────────────────────────
//  CACHE
// ──────────────────────────────────────────────────────────────
const CACHE_DIR = join(PROJECT_ROOT, 'metadata_cache', 'youtube');
const SEARCH_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours
const MAX_CACHE_ENTRIES = 200;

async function ensureCacheDir() {
  try { await mkdir(CACHE_DIR, { recursive: true }); } catch {}
}

function cacheKey(query) {
  // Unicode-safe: keep letters, numbers, spaces only
  const norm = query.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  // Use hex encoding for the full normalized query to avoid filesystem encoding issues
  return Buffer.from(norm.slice(0, 100), 'utf-8').toString('hex');
}

async function cacheGet(key) {
  try {
    const path = join(CACHE_DIR, `${key}.json`);
    const raw = await readFile(path, 'utf-8');
    const entry = JSON.parse(raw);
    if (entry && entry.ts && Date.now() - entry.ts < SEARCH_CACHE_TTL) {
      return entry.data;
    }
  } catch {}
  return null;
}

async function cacheSet(key, data) {
  try {
    await ensureCacheDir();
    const path = join(CACHE_DIR, `${key}.json`);
    await writeFile(path, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
  evictStale().catch(() => {});
}

async function evictStale() {
  try {
    const dir = await readdir(CACHE_DIR);
    if (dir.length <= MAX_CACHE_ENTRIES) return;
    const entries = [];
    for (const f of dir) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(CACHE_DIR, f), 'utf-8');
        const e = JSON.parse(raw);
        entries.push({ file: f, ts: e.ts || 0 });
      } catch {}
    }
    entries.sort((a, b) => b.ts - a.ts);
    for (const e of entries.slice(MAX_CACHE_ENTRIES)) {
      try { await rm(join(CACHE_DIR, e.file)); } catch {}
    }
  } catch {}
}

// ──────────────────────────────────────────────────────────────
//  QUERY NORMALIZER  (FIXED — preserves Unicode)
// ──────────────────────────────────────────────────────────────
function normalizeQuery(raw) {
  // Step 1: remove only clearly non-title symbols (brackets, icons, etc.)
  // Keep: ALL letters (Latin, Japanese, etc.), numbers, spaces, hyphens, slashes
  let q = raw.replace(/[【】⧸〰・◉⟡★☆♪♫♬✿❀🌸]/g, ' ');
  // Step 2: remove anything that isn't a letter, number, space, hyphen, or slash
  q = q.replace(/[^\p{L}\p{N}\s/-]/gu, ' ');
  // Step 3: collapse whitespace
  q = q.replace(/\s+/g, ' ').trim();
  return q;
}

function generateQueryVariations(query) {
  // Keep full title first, cleaned second, then add contextual keywords
  const raw = query.trim();
  const cleaned = normalizeQuery(query);
  const variations = [];
  if (raw) variations.push(raw);
  if (cleaned && cleaned !== raw) variations.push(cleaned);
  if (!/\bcover\b/i.test(raw)) variations.push(raw + ' cover');
  if (!/\bost\b/i.test(raw)) variations.push(raw + ' OST');
  if (!/\blive\b/i.test(raw)) variations.push(raw + ' live');
  return [...new Set(variations)];
}

// ──────────────────────────────────────────────────────────────
//  SIMILARITY ENGINE
// ──────────────────────────────────────────────────────────────

function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1;
  const len1 = s1.length, len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const matchDist = Math.floor(Math.max(len1, len2) / 2) - 1;
  const matches1 = new Array(len1).fill(false);
  const matches2 = new Array(len2).fill(false);
  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(len2, i + matchDist + 1);
    for (let j = start; j < end; j++) {
      if (matches2[j]) continue;
      if (s1[i] !== s2[j]) continue;
      matches1[i] = true;
      matches2[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!matches1[i]) continue;
    while (!matches2[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
  // Winkler prefix bonus
  let prefix = 0;
  const maxPrefix = Math.min(4, len1, len2);
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function levenshtein(a, b) {
  const an = a.length, bn = b.length;
  const matrix = [];
  for (let i = 0; i <= an; i++) { matrix[i] = [i]; }
  for (let j = 0; j <= bn; j++) { matrix[0][j] = j; }
  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[an][bn];
}

function tokenize(str) {
  // Split on non-letter boundaries, keep only meaningful tokens, strip cover-like noise for comparison
  return str.toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(cover|remix|nightcore|sped|slowed|instrumental|piano|reaction|live|acoustic|karaoke|version|feat|ft)\b/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

function tokenSimilarity(query, title) {
  const qTokens = tokenize(query);
  const tTokens = tokenize(title);
  if (qTokens.length === 0 || tTokens.length === 0) return 0;
  let matchScore = 0;
  for (const qt of qTokens) {
    let best = 0;
    for (const tt of tTokens) {
      const jw = jaroWinkler(qt.toLowerCase(), tt.toLowerCase());
      if (jw > best) best = jw;
      // Exact substring match bonus
      if (tt.toLowerCase().includes(qt.toLowerCase()) || qt.toLowerCase().includes(tt.toLowerCase())) {
        best = Math.max(best, 0.95);
      }
    }
    matchScore += best;
  }
  const avg = matchScore / qTokens.length;
  // Apply relevance bonus based on how many query tokens found a match
  const matchedTokens = qTokens.filter(qt =>
    tTokens.some(tt => tt.toLowerCase().includes(qt.toLowerCase()) || qt.toLowerCase().includes(tt.toLowerCase()))
  ).length;
  const coverage = matchedTokens / qTokens.length;
  return avg * 0.6 + coverage * 0.4;
}

function calculateSimilarity(query, title) {
  const q = query.toLowerCase().trim();
  const t = title.toLowerCase().trim();
  if (q.length === 0 || t.length === 0) return 0;

  // 1. Jaro-Winkler on full strings
  const jw = jaroWinkler(q, t);

  // 2. Levenshtein-based normalized similarity
  const lev = levenshtein(q, t);
  const levNorm = 1 - lev / Math.max(q.length, t.length, 1);

  // 3. Token-level similarity
  const tok = tokenSimilarity(query, title);

  // 4. Weighted combination
  const combined = jw * 0.25 + levNorm * 0.15 + tok * 0.6;

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, combined));
}

// ──────────────────────────────────────────────────────────────
//  SCORING
// ──────────────────────────────────────────────────────────────
const NEGATIVE_VIDEO_KEYWORDS = ['remix','nightcore','sped up','slowed','instrumental','piano','reaction','live','acoustic','karaoke','version','feat','ft.'];

function scoreVideo(video, query, normalizedQuery) {
  const title = video.title || '';
  const channel = (video.channel || video.uploader || '').toLowerCase();
  const qTokens = tokenize(normalizedQuery);
  const hasArtist = qTokens.length > 2; // heuristic: query has artist if >2 tokens
  const hasDuration = !!(video.duration && video.duration > 0);
  // Adaptive weights: missing artist/duration don't penalize, redistribute to title
  let wTitle = 0.55;
  let wChannel = hasArtist ? 0.15 : 0;
  let wDuration = hasDuration ? 0.10 : 0;
  let wContext = 0.10;
  const totalW = wTitle + wChannel + wDuration + wContext || 1;
  wTitle /= totalW; wChannel /= totalW; wDuration /= totalW; wContext /= totalW;

  let debugParts = [];

  const titleSimRaw = calculateSimilarity(query, title);
  debugParts.push(`titleSim(raw)=${(titleSimRaw * 100).toFixed(1)}%`);
  const titleSimNorm = calculateSimilarity(normalizedQuery, title);
  debugParts.push(`titleSim(norm)=${(titleSimNorm * 100).toFixed(1)}%`);
  const titleScore = Math.max(titleSimRaw, titleSimNorm);

  let channelScore = 0;
  const artistWords = qTokens.filter(w => w.length > 2);
  if (artistWords.length > 0 && channel.length > 0) {
    const matchCount = artistWords.filter(w => channel.includes(w)).length;
    channelScore = (matchCount / artistWords.length);
    debugParts.push(`channel=${(channelScore * 100).toFixed(1)}%`);
  }

  let durScore = 0;
  if (hasDuration) {
    if (video.duration > 30 && video.duration < 600) {
      durScore = 1;
      debugParts.push('dur=bonus');
    } else if (video.duration >= 600) {
      durScore = -0.5;
      debugParts.push('dur=penalty');
    }
  }

  // Negative evidence: candidate contains remix/cover etc. but query doesn't
  let negativePenalty = 0;
  const lowerTitle = title.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();
  for (const neg of NEGATIVE_VIDEO_KEYWORDS) {
    if (lowerTitle.includes(neg) && !lowerQuery.includes(neg)) {
      negativePenalty = 0.4;
      debugParts.push(`neg=${neg}`);
      break;
    }
  }

  let contextScore = 0;
  if (lowerQuery.includes('ost') && lowerTitle.includes('ost')) contextScore = 1;

  let finalScore = titleScore * wTitle + channelScore * wChannel + durScore * wDuration * 0.5 + contextScore * wContext;
  finalScore = Math.max(0, finalScore - negativePenalty * 0.3);
  if (titleScore > 0.8 && channelScore > 0.5) finalScore += 0.05;
  debugParts.push(`final=${(finalScore * 100).toFixed(1)}%`);

  return { score: Math.max(0, Math.min(1, finalScore)), debug: debugParts.join(' | ') };
}

// ──────────────────────────────────────────────────────────────
//  BEST THUMBNAIL
// ──────────────────────────────────────────────────────────────
function pickBestThumbnail(video, videoId) {
  const thumbnails = video.thumbnails;
  if (!thumbnails || thumbnails.length === 0) return null;
  const sorted = [...thumbnails].sort((a, b) => ((b.height || 0) * (b.width || 0)) - ((a.height || 0) * (a.width || 0)));
  const best = sorted[0];
  const med = sorted.find(t => t.height >= 180 && t.height <= 360) || sorted[Math.min(1, sorted.length - 1)] || best;
  return {
    id: videoId,
    image: best.url,
    thumbnails: {
      'default': (sorted.find(t => t.height <= 90) || best).url,
      'medium': med.url,
      'high': (sorted.find(t => t.height >= 360 && t.height <= 720) || best).url,
      'maxres': best.url,
    },
  };
}

function formatResult(video, score, debug) {
  const thumb = pickBestThumbnail(video, video.id);
  if (!thumb) return null;
  return {
    source: 'YouTube',
    videoId: video.id,
    title: video.title,
    channelTitle: video.channel || video.uploader || '',
    duration: video.duration || 0,
    viewCount: video.view_count || 0,
    score: Math.round(score * 100),
    scoreDebug: debug,
    cover: thumb,
    release: {
      id: video.id,
      title: video.title,
      artist: video.channel || video.uploader || '',
    },
  };
}

// ──────────────────────────────────────────────────────────────
//  yt-dlp SEARCH
// ──────────────────────────────────────────────────────────────
function ytDlpSearch(query, count = 8) {
  return new Promise((resolve) => {
    const args = [
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      '--no-call-home',
      '--ignore-errors',
      `ytsearch${count}:${query}`,
    ];
    const chunks = [];
    const errChunks = [];
    const child = execFile('/usr/bin/yt-dlp', args, { maxBuffer: 2 * 1024 * 1024, timeout: 20000 });
    child.stdout.on('data', d => chunks.push(d));
    child.stderr.on('data', d => errChunks.push(d));
    child.on('error', () => resolve([]));
    child.on('close', (code) => {
      if (code !== 0 && chunks.length === 0) { resolve([]); return; }
      const output = chunks.join('').trim();
      if (!output) { resolve([]); return; }
      const results = output.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      resolve(results);
    });
  });
}

// ──────────────────────────────────────────────────────────────
//  MAIN EXPORT
// ──────────────────────────────────────────────────────────────
const MIN_CONFIDENCE = 0.50; // 50% — adaptive, benchmark showed correct 57% for Tententengokujigokugoku Mint cover would be rejected at 60

export async function searchYouTube(rawQuery) {
  // ── DEBUG LOG: Raw Query ──
  console.log('═══════════════════════════════════════════');
  console.log('[youtube] RAW QUERY:', JSON.stringify(rawQuery));

  try {
    if (!rawQuery || !rawQuery.trim()) {
      console.log('[youtube] Empty query — returning []');
      return [];
    }

    // 1. NORMALIZE
    const normalized = normalizeQuery(rawQuery);
    console.log('[youtube] NORMALIZED:', JSON.stringify(normalized));
    if (!normalized) {
      console.log('[youtube] Normalized to empty — returning []');
      return [];
    }

    // 2. GENERATE VARIATIONS
    const variations = generateQueryVariations(normalized);
    console.log('[youtube] VARIATIONS:', variations);

    // 3. CHECK CACHE
    const cKey = cacheKey(normalized);
    const cached = await cacheGet(cKey);
    if (cached) {
      console.log('[youtube] CACHE HIT — key:', cKey);
      console.log('[youtube] CACHED RESULTS:', cached.length);
      console.log('═══════════════════════════════════════════');
      return cached;
    }
    console.log('[youtube] CACHE MISS — key:', cKey);

    // 4. EXECUTE SEARCH (use the first variation — no word-dropping)
    const searchQuery = variations[0];
    console.log('[youtube] EXTRACTOR QUERY:', JSON.stringify(searchQuery));

    const rawVideos = await ytDlpSearch(searchQuery, 10);
    console.log('[youtube] RAW RESULT COUNT:', rawVideos.length);
    if (rawVideos.length > 0) {
      console.log('[youtube] RAW TITLES:');
      rawVideos.slice(0, 5).forEach((v, i) => {
        console.log(`  ${i + 1}. ${v.title} (ch: ${v.channel || v.uploader || '?'}, dur: ${v.duration || '?'}s)`);
      });
    }

    if (rawVideos.length === 0) {
      // Try next variation (still no word-dropping, just adding keywords)
      for (let i = 1; i < variations.length; i++) {
        console.log('[youtube] Trying variation:', variations[i]);
        const more = await ytDlpSearch(variations[i], 6);
        rawVideos.push(...more);
        if (rawVideos.length >= 5) break;
      }
      console.log('[youtube] AFTER VARIATIONS total:', rawVideos.length);
    }

    if (rawVideos.length === 0) {
      console.log('[youtube] No results from any variation');
      await cacheSet(cKey, []);
      console.log('═══════════════════════════════════════════');
      return [];
    }

    // 5. SCORE & FILTER
    const scored = rawVideos
      .map(v => {
        const result = scoreVideo(v, rawQuery, normalized);
        return { video: v, score: result.score, debug: result.debug };
      })
      .sort((a, b) => b.score - a.score);

    console.log('[youtube] ALL SCORES:');
    scored.slice(0, 8).forEach((s, i) => {
      const status = s.score >= MIN_CONFIDENCE ? 'ACCEPT' : 'REJECT';
      console.log(`  ${i + 1}. [${status}] ${(s.score * 100).toFixed(1)}% | ${s.debug} | ${s.video.title}`);
    });

    const accepted = scored.filter(s => s.score >= MIN_CONFIDENCE);
    console.log('[youtube] ACCEPTED:', accepted.length, `/ ${scored.length}`);

    if (accepted.length === 0) {
      console.log('[youtube] No results above 60% threshold — returning []');
      await cacheSet(cKey, []);
      console.log('═══════════════════════════════════════════');
      return [];
    }

    // 6. DEDUP & FORMAT
    const seen = new Set();
    const results = [];
    for (const s of accepted) {
      if (seen.has(s.video.id)) continue;
      seen.add(s.video.id);
      const formatted = formatResult(s.video, s.score, s.debug);
      if (formatted) results.push(formatted);
      if (results.length >= 5) break;
    }

    console.log('[youtube] FINAL RESULTS:', results.length);
    results.forEach((r, i) => {
      console.log(`  ${i + 1}. [score=${r.score}] ${r.title} | ${r.channelTitle} | scoreDebug=${r.scoreDebug}`);
    });

    // 7. CACHE
    await cacheSet(cKey, results);

    console.log('═══════════════════════════════════════════');
    return results;
  } catch (err) {
    console.log('[youtube] SEARCH ERROR (non-fatal):', err.message);
    console.log('═══════════════════════════════════════════');
    return [];
  }
}
