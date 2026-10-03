import { join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { get } from '../utils/runtimeSettings.js';

const PROJECT_ROOT = join(import.meta.dirname, '..', '..', '..'); // /home/CATIAA/WEB/Music/
const BACKEND_ROOT = join(import.meta.dirname, '..', '..', '..'); // backend/

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

const PATHS = {
  get projectRoot() { return PROJECT_ROOT; },
  get appVersion() {
    try {
      const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
      if (pkg?.version) return pkg.version;
      if (pkg?.name) return pkg.name;
    } catch {}
    return null;
  },
  get backendVersion() {
    try {
      const pkg = JSON.parse(readFileSync(join(BACKEND_ROOT, 'package.json'), 'utf-8'));
      if (pkg?.version) return pkg.version;
      if (pkg?.name) return pkg.name;
    } catch {}
    return null;
  },
  get version() {
    return this.appVersion || this.backendVersion || '0.0.0';
  },

  get cacheRoot()            { return ensureDir(join(PROJECT_ROOT, 'cache')); },
  get playbackRemux()        { return ensureDir(join(this.cacheRoot, 'playback', 'remux')); },
  get playbackTranscode()    { return ensureDir(join(this.cacheRoot, 'playback', 'transcode')); },
  get playbackFaststart()    { return ensureDir(join(this.cacheRoot, 'playback', 'faststart')); },
  get playbackLru()          { return join(this.cacheRoot, 'playback', 'lru.json'); },
  get hls()                  { return ensureDir(join(this.cacheRoot, 'hls')); },
  get thumbnails()           { return ensureDir(join(this.cacheRoot, 'thumbnail')); },
  get videoCache()           { return ensureDir(join(this.cacheRoot, 'video')); },
  get metadata()             { return ensureDir(join(this.cacheRoot, 'metadata')); },
  get temp()                 { return ensureDir(join(this.cacheRoot, 'temp')); },
  get credentials()          { return join(PROJECT_ROOT, 'credentials'); },
  get cookiesTxt()           { return join(PROJECT_ROOT, 'homelab-media-server', 'cookies.txt'); },
  get gtwTxt()               { return join(this.credentials, 'gtw.txt'); },

  get logsRoot()             { return ensureDir(join(PROJECT_ROOT, 'logs')); },
  get logsPlayback()         { return ensureDir(join(this.logsRoot, 'playback')); },
  get logsBackend()          { return ensureDir(join(this.logsRoot, 'backend')); },
  get logsHls()              { return ensureDir(join(this.logsRoot, 'hls')); },
  get logsMaintenance()      { return ensureDir(join(this.logsRoot, 'maintenance')); },
  get logsSystem()           { return ensureDir(join(this.logsRoot, 'system')); },
  get logsApi()              { return ensureDir(join(this.logsRoot, 'api')); },
};

function kb(val) { return val * 1024; }
function mb(val) { return val * 1024 * 1024; }
function gb(val) { return val * 1024 * 1024 * 1024; }
function hours(h) { return h * 60 * 60 * 1000; }
function days(d) { return d * 24 * 60 * 60 * 1000; }

const SETTINGS = {
  get maxCacheSizeBytes()   { return get('playback.maxCacheSizeGB', 10) * 1024 * 1024 * 1024; },
  get maxCacheAgeMs()       { return get('playback.maxCacheAgeDays', 30) * 24 * 60 * 60 * 1000; },
  get cleanupIntervalMs()   { return get('playback.cleanupIntervalHours', 24) * 60 * 60 * 1000; },
  get probeTimeoutMs()      { return get('playback.probeTimeoutMs', 15000); },
  get lruEnabled()          { return get('playback.lruEnabled', true); },
  get logLevel() { return get('playback.logLevel', 'info'); },
  get hlsSegmentDuration() { return 3; },
  get shutdownTimeoutMs() { return get('playback.shutdownTimeoutMs', 30000); },
  get audioSync() { return get('playback.audioSync', true); },
  get hlsPreset() { return get('playback.hlsPreset', 'veryfast'); },
  get hlsCrf() { return get('playback.hlsCrf', 20); },
  get maxAvDriftMs() { return get('playback.maxAvDriftMs', 100); },
};

export { PATHS, SETTINGS };
Object.freeze(PATHS);
Object.freeze(SETTINGS);
export default Object.freeze({ ...PATHS, ...SETTINGS });
