import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessSync, constants, existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { spawnSync } from 'node:child_process';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import filesRouter from './routes/files.js';
import fileRouter from './routes/file.js';
import thumbnailRouter, { THUMBNAIL_DIR } from './routes/thumbnails.js';
import playlistsRouter from './routes/playlists.js';
import metadataRouter from './routes/metadata.js';
import listeningRouter from './routes/listening.js';
import videoCacheRouter from './routes/videoCache.js';
import servicesRouter, { registerAllServices } from './routes/services.js';
import { requireService } from './middleware/serviceGuard.js';
import { createGateway } from './gateway/index.js';
import { addSseClient, broadcastStats, broadcastFolderUpdate } from './utils/sseManager.js';
import { startMaintenanceScheduler, stopMaintenanceScheduler } from './utils/maintenance.js';
import { get } from './utils/runtimeSettings.js';
import { createLogger } from './utils/logger.js';
import { scanForMissing } from './utils/thumbnailQueue.js';
import { mediaEngine, mediaScanner, db, musicStmts, MEDIA_ROOT, MUSIC_ROOT, SCAN_ROOTS, THUMBNAIL_DIR as CTX_THUMBNAIL_DIR, PATHS } from './context.js';
import { startDbGateway } from './gateway/db/index.js';
import { setupMusicFTS } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const log = createLogger('system');

process.on('unhandledRejection', (reason) => {
  log.error({ msg: 'Unhandled rejection', error: reason?.message || reason });
});

const app = express();
const PORT = process.env.PORT || 4000;

for (const vaultRoot of MEDIA_ROOT) {
  const linkPath = join(vaultRoot, MUSIC_ROOT[0]?.split('/').pop() || 'Music');
  try {
    const st = lstatSync(linkPath);
    if (st.isSymbolicLink()) {
      const target = readlinkSync(linkPath);
      console.warn(`[server] Legacy symlink detected: ${linkPath} -> ${target}. Music now scanned via MUSIC_ROOT=${MUSIC_ROOT.join(':')}; consider removing the symlink.`);
    }
  } catch {}
}

app.use(cors());
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  next();
});

const mediaGateway = createGateway({ engine: mediaEngine, webId: process.env.MEDIA_WEB_ID || 'music' });
app.use('/api/media', mediaGateway.router);

app.use((req, res, next) => {
  req.app.locals.gateway = mediaGateway;
  next();
});

globalThis.mediaEngine = mediaEngine;
globalThis.mediaScanner = mediaScanner;
globalThis.db = db;
globalThis.stmts = musicStmts;
globalThis.MEDIA_ROOT = MEDIA_ROOT;
globalThis.MUSIC_ROOT = MUSIC_ROOT;
globalThis.SCAN_ROOTS = SCAN_ROOTS;
globalThis.THUMBNAIL_DIR = CTX_THUMBNAIL_DIR;
globalThis.PATHS = PATHS;

app.use('/api/files', requireService('music'), filesRouter);
app.use('/api/search', requireService('music'), filesRouter);
app.use('/file', requireService('music'), fileRouter);
app.use('/thumbnails', requireService('music'), thumbnailRouter);
app.use('/api/services', servicesRouter);
app.use('/api/playlists', playlistsRouter);
app.use('/api/playlists/scan', requireService('playlists'));
app.use('/api/playlists/:id/refresh', requireService('playlists'));
app.use('/api/metadata', requireService('music'), metadataRouter);
app.use('/api/video-cache', videoCacheRouter);
app.use('/api/listening', listeningRouter);
app.use('/api/updates', addSseClient);

app.get('/api/folders/:id', async (req, res) => {
  try {
    const folder = await mediaEngine.getFolder(req.params.id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    res.json({ id: folder.id, path: folder.path, parent_id: folder.parentId ?? folder.parent_id, depth: folder.depth, file_count: folder.fileCount ?? folder.file_count, total_size: folder.totalSize ?? folder.total_size });
  } catch (err) {
    console.error('[/api/folders/:id] Error:', err);
    res.status(500).json({ error: 'Failed to fetch folder' });
  }
});

app.get('/api/debug', async (req, res) => {
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    server: 'Music Vault',
    system: {
      uptime: `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m`,
      memory: {
        rss: `${(memUsage.rss/1024/1024).toFixed(1)} MB`,
        heapUsed: `${(memUsage.heapUsed/1024/1024).toFixed(1)} MB`,
        heapTotal: `${(memUsage.heapTotal/1024/1024).toFixed(1)} MB`,
      },
      pid: process.pid,
      platform: process.platform,
      nodeVersion: process.version
    },
  });
});

app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store, must-revalidate, max-age=0');
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/ready', async (req, res) => {
  res.set('Cache-Control', 'no-store, must-revalidate, max-age=0');
  try {
    let database = false;
    try {
      db.prepare('SELECT 1').get();
      database = true;
    } catch {}
    res.json({
      state: database ? 'ready' : 'warming_up',
      http: true,
      database,
    });
  } catch (err) {
    res.json({
      state: 'warming_up',
      http: true,
      database: false,
    });
  }
});

app.get(/.*\.map$/, (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(join(__dirname, '../../frontend/dist', req.path));
});

app.use(express.static(join(__dirname, '../../frontend/dist'), {
  maxAge: 31536000000,
  immutable: true,
  index: false,
}));

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(join(__dirname, '../../frontend/dist/index.html'));
});

async function validateStartup() {
  const criticalFailures = [];
  const warnings = [];

  let sqliteOk = false;
  try { db.prepare('SELECT 1').get(); sqliteOk = true; }
  catch (e) { criticalFailures.push({ check: 'sqlite', error: e.message }); }

  if (!sqliteOk) criticalFailures.push({ check: 'sqlite', error: 'database unreachable' });

  let dbGatewayOk = false;
  try {
    const dbGateway = await startDbGateway();
    dbGatewayOk = !!dbGateway && !!dbGateway.music;
    if (!dbGatewayOk) criticalFailures.push({ check: 'dbGateway', error: 'db gateway not ready' });
  } catch (err) {
    criticalFailures.push({ check: 'dbGateway', error: err.message });
  }

  for (const dir of [PATHS.cacheRoot, PATHS.logsRoot, PATHS.thumbnails]) {
    try { accessSync(dir, constants.W_OK); } catch (e) {
      criticalFailures.push({ check: 'directory_writable', path: dir, error: e.code });
    }
  }

  try {
    const r = spawnSync('which', ['ffmpeg'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    if (r.error || r.status !== 0) warnings.push('ffmpeg not found in PATH');
  } catch { warnings.push('ffmpeg not found in PATH'); }

  try {
    const r = spawnSync('which', ['ffprobe'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    if (r.error || r.status !== 0) warnings.push('ffprobe not found in PATH');
  } catch { warnings.push('ffprobe not found in PATH'); }

  for (const w of warnings) log.warn({ msg: 'startup warning', warning: w });
  for (const f of criticalFailures) log.error({ msg: 'startup critical failure', ...f });

  if (criticalFailures.length > 0) {
    log.error({ msg: 'Critical startup failures detected — aborting', count: criticalFailures.length });
    process.exit(1);
  }

  log.info({ msg: 'Startup validation passed', warnings: warnings.length });
}

function loadTlsCredentials() {
  const keyPath = process.env.TLS_KEY || join(process.cwd(), 'certs', 'key.pem');
  const certPath = process.env.TLS_CERT || join(process.cwd(), 'certs', 'cert.pem');
  if (existsSync(keyPath) && existsSync(certPath)) {
    try {
      return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
    } catch (e) {
      log.warn({ msg: 'TLS cert read failed, falling back to HTTP', error: e.message });
    }
  }
  return null;
}

async function startServer() {
  const tlsCredentials = loadTlsCredentials();
  const server = tlsCredentials ? createHttpsServer(tlsCredentials, app) : createHttpServer(app);

  app.set('trust proxy', 1);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Running: ${tlsCredentials ? 'https' : 'http'}://0.0.0.0:${PORT}`);
    console.log(`[server] Media roots: ${SCAN_ROOTS.join(', ')} (vault=${MEDIA_ROOT.join(', ')} music=${MUSIC_ROOT.join(', ')})`);

    registerAllServices();

    setTimeout(() => {
      console.log('[server] Running FTS setup...');
      setupMusicFTS().catch(e => console.error('[server] FTS setup failed:', e.message));
    }, 1000);

    mediaScanner.startWatcher();
    startMaintenanceScheduler();

    setTimeout(async () => {
      try {
        const { optimizeAllCached } = await import('./utils/videoCache.js');
        await optimizeAllCached();
      } catch (err) {
        console.error('[server] Cached video optimize failed:', err.message);
      }
      }, 8000);

    setTimeout(async () => {
      const { existsSync, readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const SCAN_TS_FILE = join(process.cwd(), 'data', '.last-scan-time');
      const MAX_STALE_MS = 24 * 60 * 60 * 1000;

      const hasRecentScan = existsSync(SCAN_TS_FILE)
        ? (() => {
            try {
              const ms = BigInt(readFileSync(SCAN_TS_FILE, 'utf8').trim());
              return (Date.now() - Number(ms)) < MAX_STALE_MS;
            } catch { return false; }
          })()
        : false;

      if (hasRecentScan) {
        console.log('[server] Skipping initial scan: DB is fresh');
      } else {
        console.log('[server] Starting initial scan via MediaScanner (cold or stale DB)...');
        try {
          const result = await mediaScanner.scan();
          if (result) console.log('[server] Initial sync:', result);
        } catch (err) {
          console.error('[server] Initial scan failed:', err);
        }
      }

        console.log('[server] Enriching durations after startup...');
        try {
          await mediaScanner.enrichDurations();
          console.log('[server] Duration enrichment complete');
        } catch (err) {
          console.error('[server] Duration enrichment failed:', err.message);
        }

        console.log('[server] Running initial thumbnail scan...');
        try {
          await scanForMissing();
        } catch (err) {
          console.error('[server] Initial thumbnail scan failed:', err.message);
        }

        console.log('[server] Thumbnail service ready');
        const thumbStats = mediaEngine.getThumbnailStats();
        if (thumbStats) {
          console.log('[server] Thumbnail stats:', thumbStats);
        }
    }, 20000);
  });
}

async function handleShutdown(signal) {
  log.info({ msg: `Received ${signal} — shutting down gracefully` });

  log.info({ msg: 'Stopping watcher...' });
  try { mediaScanner.stopWatcher(); } catch (e) { log.warn({ msg: 'watcher stop failed', error: e.message }); }

  log.info({ msg: 'Stopping maintenance...' });
  try { stopMaintenanceScheduler(); } catch (e) { log.warn({ msg: 'maintenance stop failed', error: e.message }); }

  server.close(() => {
    log.info({ msg: 'HTTP server closed' });
    process.exit(0);
  });

  setTimeout(() => {
    log.error({ msg: 'Force exiting after shutdown timeout' });
    process.exit(1);
  }, 15000);
}

validateStartup();
startServer().catch(err => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

export { app, mediaEngine, mediaScanner, db, MEDIA_ROOT, MUSIC_ROOT, SCAN_ROOTS };
