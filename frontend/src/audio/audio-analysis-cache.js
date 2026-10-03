import { getProcessor, resetProcessor } from './audio-processor.js';

const CACHE_KEY = 'audio_analysis_cache_v1';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed.version !== 'audio_analysis_cache_v1') return {};
    return parsed.tracks || {};
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    const payload = {
      version: 'audio_analysis_cache_v1',
      updatedAt: Date.now(),
      tracks: cache,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // quota exceeded
  }
}

export async function getTrackAnalysis(fileId) {
  const cache = loadCache();
  const entry = cache[fileId];
  if (entry && entry.version === getProcessor().version && entry.expiresAt > Date.now()) {
    return {
      globalPeak: entry.globalPeak,
      bandPeaks: new Float32Array(entry.bandPeaks),
      smoothedPeaks: new Float32Array(entry.smoothedPeaks),
      fromCache: true,
    };
  }
  return null;
}

export async function setTrackAnalysis(fileId, analysis) {
  const cache = loadCache();
  cache[fileId] = {
    version: getProcessor().version,
    createdAt: Date.now(),
    expiresAt: Date.now() + CACHE_TTL_MS,
    globalPeak: analysis.globalPeak,
    bandPeaks: Array.from(analysis.bandPeaks),
    smoothedPeaks: Array.from(analysis.smoothedPeaks),
  };
  saveCache(cache);
}

export function invalidateTrackAnalysis(fileId) {
  const cache = loadCache();
  delete cache[fileId];
  saveCache(cache);
}

export { resetProcessor };
