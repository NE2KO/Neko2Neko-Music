const defaults = {
  'perf.thumbQuality': 10,
  'thumb.concurrent': 4,
  'scan.workers': 4,
  'scan.compareByHash': false,
  'playback.maxCacheSizeGB': 10,
  'playback.maxCacheAgeDays': 30,
  'playback.cleanupIntervalHours': 24,
  'playback.probeTimeoutMs': 15000,
  'playback.lruEnabled': true,
  'playback.logLevel': 'info',
  'playback.shutdownTimeoutMs': 30000,
  'playback.audioSync': true,
  'playback.hlsPreset': 'veryfast',
  'playback.hlsCrf': 20,
  'playback.maxAvDriftMs': 100,
};

export function get(key, fallback) {
  const raw = defaults[key];
  if (raw === undefined) return fallback;
  return raw;
}
