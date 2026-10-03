import { existsSync, mkdirSync, readdirSync, lstatSync, opendir, stat, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import db, { musicStmts } from '../db.js';
import { hasEmbeddedCover, extractEmbeddedThumbnail, extractFrameThumbnail, generateImageThumbnail, generateAudioPlaceholder, THUMBNAIL_DIR, VAAPI_AVAILABLE, getThumbPath, THUMB_SIZES } from './thumbnailUtils.js';
import { getFileId, getRelPath } from '@homelab/media-engine';
import { resolveFileForEngine } from '@homelab/media-engine';
import { get } from './runtimeSettings.js';
import { registerSubsystem, setPaused } from './resourceManager.js';

mkdirSync(THUMBNAIL_DIR, { recursive: true });

for (const size of ['full', 'list']) {
  mkdirSync(join(THUMBNAIL_DIR, size), { recursive: true });
}

registerSubsystem('thumbnail', {
  memoryBudget: 2 * 1024 * 1024 * 1024,
  ioPriority: 'low',
  cpuPriority: 'low',
});

let queue = [];
let processing = false;
let scanRunning = false;
let paused = false;
let stopped = false;
let totalProcessed = 0;
let totalSkipped = 0;
let totalMissing = 0;
let startedAt = null;
let existingThumbs = new Set();
const activeProcs = new Set();

async function scanDirAsync(dir, base = THUMBNAIL_DIR) {
  let entries;
  try { entries = await opendir(dir); } catch { return; }
  for await (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = full.slice(base.length + 1);
    try {
      const fileStat = await stat(full);
      if (fileStat.isDirectory()) {
        await scanDirAsync(full, base);
      } else {
        existingThumbs.add(rel);
      }
    } catch {
      existingThumbs.add(rel);
    }
  }
}

async function buildThumbCacheAsync() {
  try {
    existingThumbs = new Set();
    await scanDirAsync(THUMBNAIL_DIR, THUMBNAIL_DIR);
  } catch { existingThumbs = new Set(); }
}

function buildThumbCache() {
  try {
    existingThumbs = new Set();
    const scanDir = (dir, base = THUMBNAIL_DIR) => {
      let entries;
      try { entries = readdirSync(dir); } catch { return; }
      for (const entry of entries) {
        const full = join(dir, entry);
        const rel = full.slice(base.length + 1);
        try {
          const s = lstatSync(full);
          if (s.isDirectory()) {
            scanDir(full, base);
          } else {
            existingThumbs.add(rel);
          }
        } catch {
          existingThumbs.add(rel);
        }
      }
    };
    scanDir(THUMBNAIL_DIR);
  } catch { existingThumbs = new Set(); }
}
buildThumbCache();

function getQueueStatus() {
  return {
    type: 'thumbnail', pending: queue.length, processing, scanRunning, paused, stopped,
    totalProcessed, totalSkipped, totalMissing, startedAt,
  };
}

function killActive() {
  for (const proc of activeProcs) {
    try { proc.kill('SIGTERM'); } catch {}
  }
  activeProcs.clear();
}

function pauseQueue() { paused = true; killActive(); }

function resumeQueue() { paused = false; drainQueue(); }

function clearQueue() { queue = []; }

function stopQueue() {
  stopped = true; paused = false; queue = [];
  killActive(); processing = false;
  console.log('[thumbnails] Queue stopped');
}

function startQueue() { stopped = false; paused = false; drainQueue(); }

function isQueueStopped() { return stopped; }

const BATCH_SIZE = 20;
const REFILL_DELAY_MS = 5000;

async function scanForMissing() {
  if (scanRunning) return;
  scanRunning = true;
  stopped = false;

  try {
    buildThumbCache();
    const files = db.prepare('SELECT id, name, type, dir_id, mtime, has_thumb FROM files').all();

    const toProcess = [];
    const engine = globalThis.mediaEngine;
    let cacheHits = 0, cacheMisses = 0, outdatedCount = 0;
    for (const f of files) {
      if (f.has_thumb === 2) {
        cacheHits++;
        continue;
      }

      const fullThumbKey = join('full', f.id + '.jpg');
      const thumbPath = join(THUMBNAIL_DIR, 'full', f.id + '.jpg');
      
      let needsThumb = false;
      if (!existingThumbs.has(fullThumbKey)) {
        cacheMisses++;
        needsThumb = true;
      } else if (existsSync(thumbPath)) {
        cacheHits++;
        try {
          const thumbMtime = statSync(thumbPath).mtimeMs;
          if (f.mtime > thumbMtime) {
            outdatedCount++;
            needsThumb = true;
          }
        } catch {}
      }
      
      if (needsThumb && engine) {
        try {
          const resolved = await resolveFileForEngine(f.id, engine.repository, engine.mediaRoots);
          if (resolved && !resolved.blocked && resolved.fullPath) {
            toProcess.push({ id: f.id, fullPath: resolved.fullPath, type: f.type });
          }
        } catch {}
      }
      
      if (toProcess.length >= BATCH_SIZE) break;
    }

    console.log(`[thumbnails] Cache: ${cacheHits} hits, ${cacheMisses} misses, ${outdatedCount} outdated, ${toProcess.length} to process`);
    totalMissing = toProcess.length;
    if (toProcess.length > 0 && !startedAt) startedAt = Date.now();
    queue.push(...toProcess);
    if (toProcess.length > 0) {
      console.log(`[thumbnails] Found ${toProcess.length} files to process, queue size: ${queue.length}`);
      drainQueue();
    } else {
      console.log('[thumbnails] All thumbnails up to date');
    }
  } finally {
    scanRunning = false;
  }
}

function spawnTracked(args) {
  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  activeProcs.add(proc);
  proc.on('close', () => activeProcs.delete(proc));
  proc.on('error', () => activeProcs.delete(proc));
  return proc;
}

function ffmpegRun(args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const proc = spawnTracked(args);
    let done = false;
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, timeoutMs);
    proc.on('close', (code) => { if (!done) { done = true; clearTimeout(timer); resolve(code === 0); } });
    proc.on('error', () => { if (!done) { done = true; clearTimeout(timer); resolve(false); } });
  });
}

async function processOne(item) {
  if (paused || stopped) return false;
  const quality = get('perf.thumbQuality', 10);
  const sizes = [
    { name: 'full', size: THUMB_SIZES.full },
    { name: 'list', size: THUMB_SIZES.list },
  ];

  let allOk = true;
  let hasCover = false;

  if (item.type === 'audio') {
    const coverInfo = await hasEmbeddedCover(item.fullPath);
    if (!coverInfo) {
      musicStmts.skipThumbStatus.run(item.id);
      return false;
    }
    hasCover = true;
  }

  for (const s of sizes) {
    const outPath = getThumbPath(item.id, s.name);
    const thumbDir = join(outPath, '..');
    mkdirSync(thumbDir, { recursive: true });
    const thumbFileName = join(THUMBNAIL_DIR, s.name, item.id + '.jpg');

    if (existsSync(outPath)) {
      continue;
    }

    if (!existsSync(item.fullPath)) {
      allOk = false;
      break;
    }

    let ok = false;
    if (item.type === 'image') {
      ok = await generateImageThumbnail(item.fullPath, outPath, quality, s.size);
    } else if (item.type === 'audio') {
      if (hasCover) ok = await extractEmbeddedThumbnail(item.fullPath, outPath);
    } else {
      const coverInfo = await hasEmbeddedCover(item.fullPath);
      if (coverInfo) ok = await extractEmbeddedThumbnail(item.fullPath, outPath);
      if (!ok) ok = await extractFrameThumbnail(item.fullPath, outPath, quality, s.size);
    }

    if (ok) {
      existingThumbs.add(join(s.name, item.id + '.jpg'));
    } else {
      allOk = false;
    }
  }

  if (allOk) {
    musicStmts.updateThumbStatus.run(item.id);
  } else {
    musicStmts.skipThumbStatus.run(item.id);
  }
  return allOk;
}

async function drainQueue() {
  if (processing || paused || stopped) return;

  processing = true;
  let batchProcessed = 0;
  let batchSkipped = 0;

  try {
    const concurrency = get('thumb.concurrent', 4);

    while (!stopped && !paused) {
      if (queue.length === 0) {
        await tryRefill();
        if (queue.length === 0) break;
      }

      const batch = queue.splice(0, concurrency);
      const results = await Promise.all(batch.map(processOne));
      for (const ok of results) {
        if (ok) batchProcessed++;
        else batchSkipped++;
      }
      totalProcessed += batchProcessed;
      totalSkipped += batchSkipped;
      batchProcessed = 0;
      batchSkipped = 0;

      if (totalProcessed > 0 && totalProcessed % 20 === 0) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const speed = totalProcessed / elapsed;
        console.log(`[thumbnails] Progress: ${totalProcessed} processed, ${queue.length} queued, ${speed.toFixed(1)} thumb/s`);
      }

      if (queue.length > 0 && !paused && !stopped) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    if (!paused && !stopped) {
      console.log('[thumbnails] Done. Generated:', totalProcessed, 'Skipped:', totalSkipped);
      startedAt = null;
    }
  } finally {
    processing = false;
  }
}

let lastRefillAt = 0;

async function tryRefill() {
  if (stopped || paused || scanRunning) return;

  const now = Date.now();
  if (now - lastRefillAt < REFILL_DELAY_MS) return;
  lastRefillAt = now;

  const remaining = db.prepare('SELECT COUNT(*) as cnt FROM files WHERE has_thumb = 0').get();
  totalMissing = remaining.cnt;
  if (remaining.cnt === 0) return;

  const files = db.prepare('SELECT id, name, type, dir_id FROM files WHERE has_thumb = 0').all();

  const missing = [];
  const engine2 = globalThis.mediaEngine;
  for (const f of files) {
    const fullThumbKey = join('full', f.id + '.jpg');
    if (!existingThumbs.has(fullThumbKey) && !queue.find(q => q.id === f.id)) {
      if (engine2) {
        try {
          const resolved = await resolveFileForEngine(f.id, engine2.repository, engine2.mediaRoots);
          if (resolved && !resolved.blocked && resolved.fullPath) {
            missing.push({ id: f.id, fullPath: resolved.fullPath, type: f.type });
          }
        } catch {}
      }
    }
    if (missing.length >= BATCH_SIZE) break;
  }

  if (missing.length > 0) {
    if (!startedAt) startedAt = Date.now();
    queue.push(...missing);
    console.log(`[thumbnails] Refilled ${missing.length} files, queue: ${queue.length}, remaining in DB: ${remaining.cnt}`);
  }
}

function addFile(fullPath, fileType) {
  const relPath = getRelPath(fullPath);
  const id = getFileId(relPath);
  const fullThumbKey = join('full', id + '.jpg');
  if (!existingThumbs.has(fullThumbKey) && !queue.find((v) => v.id === id)) {
    const type = fileType || getFileTypeFromDb(id);
    queue.push({ id, fullPath, type });
    drainQueue();
  }
}

function getFileTypeFromDb(id) {
  try { const row = db.prepare('SELECT type FROM files WHERE id = ?').get(id); return row ? row.type : null; } catch { return null; }
}

export { addFile, scanForMissing, drainQueue, getQueueStatus, pauseQueue, resumeQueue, clearQueue, stopQueue, startQueue, isQueueStopped, buildThumbCache, buildThumbCacheAsync, existingThumbs, VAAPI_AVAILABLE };
