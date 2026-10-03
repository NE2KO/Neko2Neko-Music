import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS, SETTINGS } from '../config/paths.js';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_LOG_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_LOG_FILES = 30;

const logDirMap = {
  playback: () => PATHS.logsPlayback,
  hls: () => PATHS.logsHls,
  backend: () => PATHS.logsBackend,
  maintenance: () => PATHS.logsMaintenance,
  system: () => PATHS.logsSystem,
  api: () => PATHS.logsApi,
  database: () => mkdirSync(join(PATHS.logsRoot, 'database'), { recursive: true }),
  scanner: () => mkdirSync(join(PATHS.logsRoot, 'scanner'), { recursive: true }),
  metrics: () => mkdirSync(join(PATHS.logsRoot, 'metrics'), { recursive: true }),
  websocket: () => mkdirSync(join(PATHS.logsRoot, 'websocket'), { recursive: true }),
  auth: () => mkdirSync(join(PATHS.logsRoot, 'auth'), { recursive: true }),
  scheduler: () => mkdirSync(join(PATHS.logsRoot, 'scheduler'), { recursive: true }),
};

function getLogDir(category) {
  const fn = logDirMap[category];
  if (fn) return fn();
  return mkdirSync(join(PATHS.logsRoot, category), { recursive: true });
}

function rotateIfNeeded(logDir) {
  try {
    const files = readdirSync(logDir)
      .filter(f => f.endsWith('.log'))
      .sort();
    if (files.length > MAX_LOG_FILES) {
      for (let i = 0; i < files.length - MAX_LOG_FILES; i++) {
        try { unlinkSync(join(logDir, files[i])); } catch {}
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    const logFile = join(logDir, `${today}.log`);
    try {
      const st = statSync(logFile);
      if (st.size > MAX_LOG_SIZE_BYTES) {
        const rotated = logFile.replace('.log', `-${Date.now()}.log`);
        renameSync(logFile, rotated);
      }
    } catch {}
  } catch {}
}

function writeLog(logDir, entry) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const logFile = join(logDir, `${today}.log`);
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(logFile, line, { flag: 'a', encoding: 'utf-8' });
    rotateIfNeeded(logDir);
  } catch {}
}

export function createLogger(category) {
  const logDir = getLogDir(category);
  const minLevelIdx = LEVELS[SETTINGS.logLevel] ?? 1;

  function log(level, data) {
    if ((LEVELS[level] ?? 0) < minLevelIdx) return;
    const entry = {
      ts: new Date().toISOString(),
      lvl: level,
      cat: category,
      ...data,
    };
    writeLog(logDir, entry);
  }

  return {
    debug: (data) => log('debug', data),
    info:  (data) => log('info', data),
    warn:  (data) => log('warn', data),
    error: (data) => log('error', data),
  };
}

export function logDecision(logger, file, decision) {
  logger.info({
    event: 'decision',
    id: file.id,
    name: file.name?.slice(0, 80),
    ext: file.ext,
    action: decision.action,
    reason: decision.reason,
    cacheHit: decision.cacheHit,
    probeMs: decision.probeMs,
    totalMs: decision.totalMs || (Date.now() - (decision._t0 || Date.now())),
  });
}

export function logRemux(logger, file, durationMs, cached) {
  logger.info({
    event: 'remux',
    id: file.id,
    name: file.name?.slice(0, 80),
    durationMs,
    cached,
  });
}

export function logCleanup(logger, result) {
  logger.info({
    event: 'cleanup',
    removedFiles: result.removedFiles,
    freedBytes: result.freedBytes,
    freedMB: +(result.freedBytes / 1024 / 1024).toFixed(1),
    durationMs: result.durationMs,
    errors: result.errors || 0,
  });
}

export function logIntegrity(logger, filePath, reason) {
  logger.warn({ event: 'integrity_fail', path: filePath, reason });
}

export function logError(logger, context, error) {
  logger.error({ event: 'error', context, message: error?.message || String(error) });
}
