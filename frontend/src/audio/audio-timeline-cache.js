const CACHE_KEY = 'audio_timeline_cache_v1';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed.version !== 'audio_timeline_cache_v1') return {};
    return parsed.tracks || {};
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    const payload = {
      version: 'audio_timeline_cache_v1',
      updatedAt: Date.now(),
      tracks: cache,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // quota exceeded
  }
}

export async function getTimeline(fileId) {
  const cache = loadCache();
  const entry = cache[fileId];
  if (entry && entry.version === 'audio-processor-v1' && entry.expiresAt > Date.now()) {
    return {
      timeline: new Float32Array(entry.timeline),
      duration: entry.duration,
      fromCache: true,
    };
  }
  return null;
}

export async function setTimeline(fileId, timeline, duration) {
  const cache = loadCache();
  cache[fileId] = {
    version: 'audio-processor-v1',
    createdAt: Date.now(),
    expiresAt: Date.now() + CACHE_TTL_MS,
    timeline: Array.from(timeline),
    duration,
  };
  saveCache(cache);
}

export function invalidateTimeline(fileId) {
  const cache = loadCache();
  delete cache[fileId];
  saveCache(cache);
}
