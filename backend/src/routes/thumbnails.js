import { Router } from 'express';
import { existsSync, createReadStream, rmSync, mkdirSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { hasEmbeddedCover, extractEmbeddedThumbnail, extractFrameThumbnail, generateImageThumbnail, generateAudioPlaceholder, THUMBNAIL_DIR, getThumbPath, getSharedPlaceholderPath, THUMB_SIZES } from '../utils/thumbnailUtils.js';
import { get } from '../utils/runtimeSettings.js';
import { resolveFileForEngine } from '@homelab/media-engine';
import { musicStmts } from '../db.js';

mkdirSync(THUMBNAIL_DIR, { recursive: true });
for (const size of ['full', 'list']) {
  mkdirSync(join(THUMBNAIL_DIR, size), { recursive: true });
}

const router = Router();

const generating = new Map();
let activeGenerations = 0;
const generationQueue = [];

function getMaxConcurrent() {
  return get('thumb.concurrent', 3);
}

function processGenerationQueue() {
  const maxConcurrent = getMaxConcurrent();
  while (generationQueue.length > 0 && activeGenerations < maxConcurrent) {
    const next = generationQueue.shift();
    activeGenerations++;
    next().finally(() => {
      activeGenerations--;
      processGenerationQueue();
    });
  }
}

function runFfmpeg(args) {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stderr.on('data', () => {});
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

async function doGenerateThumbnail(file, outPath, size = 'full') {
  const quality = get('perf.thumbQuality', 10);
  const px = THUMB_SIZES[size];
  if (file.type === 'image') {
    return generateImageThumbnail(file.fullPath, outPath, quality, px);
  }

  if (file.type === 'audio') {
    const coverInfo = await hasEmbeddedCover(file.fullPath);
    if (coverInfo) {
      return extractEmbeddedThumbnail(file.fullPath, outPath);
    }
    return false;
  }

  const coverInfo = await hasEmbeddedCover(file.fullPath);
  if (coverInfo) {
    return extractEmbeddedThumbnail(file.fullPath, outPath);
  }
  return extractFrameThumbnail(file.fullPath, outPath, quality, px);
}

async function generateThumbnailSingle(file, size = 'full') {
  const thumbPath = getThumbPath(file.id, size);
  if (existsSync(thumbPath)) return thumbPath;

  if (generating.has(`${size}:${file.id}`)) {
    return generating.get(`${size}:${file.id}`);
  }

  const thumbDir = join(thumbPath, '..');
  mkdirSync(thumbDir, { recursive: true });

  const promise = doGenerateThumbnail(file, thumbPath, size);
  generating.set(`${size}:${file.id}`, promise);
  try {
    const result = await promise;
    if (result) {
      try {
        musicStmts.updateThumbStatus.run(file.id);
        const fullPath = getThumbPath(file.id, 'full');
        musicStmts.updateThumbCachePath.run(fullPath, file.id);
      } catch {}
    }
    return result ? thumbPath : null;
  } finally {
    generating.delete(`${size}:${file.id}`);
  }
}

function runWithinSlot(fn) {
  const maxConcurrent = getMaxConcurrent();
  if (activeGenerations < maxConcurrent) {
    activeGenerations++;
    const result = fn();
    if (result && typeof result.finally === 'function') {
      return result.finally(() => {
        activeGenerations--;
        processGenerationQueue();
      });
    }
    activeGenerations--;
    processGenerationQueue();
    return result;
  }

  return new Promise((resolve, reject) => {
    generationQueue.push(() => {
      const result = fn();
      if (result && typeof result.then === 'function') {
        return result.then(resolve, reject);
      }
      resolve(result);
      return Promise.resolve(result);
    });
  });
}

async function ensureThumbnailForFile(file, size = 'full') {
  const thumbPath = getThumbPath(file.id, size);
  if (existsSync(thumbPath)) return thumbPath;

  return runWithinSlot(() => generateThumbnailSingle(file, size));
}

async function getFolderPreviewFiles(folderId) {
  const engine = globalThis.mediaEngine;
  const previews = await engine.getPreviewFilesForFolder(folderId, 4);
  if (previews.length === 0) return [];
  const result = [];
  for (const f of previews) {
    const full = await resolveFileForEngine(f.id, engine.repository, engine.mediaRoots);
    if (full && !full.blocked) result.push(full);
  }
  return result;
}

async function generateDefaultFolderThumb(outPath) {
  return runFfmpeg([
    '-f', 'lavfi',
    '-i', 'color=c=#78350f:s=300x300:d=1',
    '-vf', 'drawtext=text=📁:fontsize=120:x=(w-text_w)/2:y=(h-text_h)/2',
    '-frames:v', '1',
    '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '6', '-y', outPath,
  ]);
}

async function generateFolderPreview(folderId) {
  const engine = globalThis.mediaEngine;
  const folder = await engine.getFolder(folderId);
  if (!folder) return false;

  const outPath = join(THUMBNAIL_DIR, `folder_${folderId}.jpg`);
  if (existsSync(outPath)) return true;

  const previewFiles = await getFolderPreviewFiles(folderId);

  if (previewFiles.length === 0) {
    return generateDefaultFolderThumb(outPath);
  }

  const tmpDir = join(THUMBNAIL_DIR, 'tmp_folder_preview');
  mkdirSync(tmpDir, { recursive: true });

  try {
    const thumbPaths = [];
    for (const file of previewFiles) {
      const tp = await ensureThumbnailForFile(file);
      if (tp) thumbPaths.push(tp);
    }

    if (thumbPaths.length === 0) {
      return generateDefaultFolderThumb(outPath);
    }

    const CELL = 150;
    const cols = Math.min(thumbPaths.length, 2);
    const rows = Math.ceil(thumbPaths.length / 2);

    if (thumbPaths.length === 1) {
      const args = [
        '-i', thumbPaths[0],
        '-vf', `scale=${CELL}:${CELL}:force_original_aspect_ratio=decrease,pad=${CELL}:${CELL}:(ow-iw)/2:(oh-ih)/2:color=black`,
        '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '7', '-y', outPath,
      ];
      return await runFfmpeg(args);
    }

    const inputs = [];
    const filterParts = [];
    for (let i = 0; i < thumbPaths.length; i++) {
      inputs.push('-i', thumbPaths[i]);
      filterParts.push(`[${i}:v]scale=${CELL}:${CELL}:force_original_aspect_ratio=decrease,pad=${CELL}:${CELL}:(ow-iw)/2:(oh-ih)/2:color=black[v${i}]`);
    }

    const padPositions = [];
    for (let i = 0; i < thumbPaths.length; i++) {
      padPositions.push(`${(i % 2) * CELL}:${Math.floor(i / 2) * CELL}`);
    }

    const inputsStr = thumbPaths.map((_, i) => `[v${i}]`).join('');
    const xstackFilter = `${filterParts.join(';')};${inputsStr}xstack=inputs=${thumbPaths.length}:layout=${padPositions.join('|')}`;

    const args = [...inputs, '-filter_complex', xstackFilter, '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '7', '-y', outPath];
    return await runFfmpeg(args);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function tryServe(path, res) {
  if (existsSync(path)) {
    res.set('Cache-Control', 'public, max-age=300');
    try {
      const fd = openSync(path, 'r');
      const buf = Buffer.alloc(12);
      readSync(fd, buf, 0, 12, 0);
      closeSync(fd);
      if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
        res.set('Content-Type', 'image/jpeg');
      } else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
        res.set('Content-Type', 'image/webp');
      } else {
        res.set('Content-Type', 'image/jpeg');
      }
    } catch {
      res.set('Content-Type', 'image/jpeg');
    }
    return createReadStream(path).pipe(res);
  }
  return null;
}

async function handleThumbnailRequest(req, res, size = 'full') {
  const { id } = req.params;
  const hashedPath = getThumbPath(id, size);

  const served = tryServe(hashedPath, res);
  if (served) return;

  const cacheKey = `${size}:${id}`;
  if (generating.has(cacheKey)) {
    try { await generating.get(cacheKey); } catch {}
    const served2 = tryServe(hashedPath, res);
    if (served2) return;
    return res.status(404).json({ error: 'Thumbnail generation failed' });
  }

  const engine = globalThis.mediaEngine;
  const file = await resolveFileForEngine(id, engine.repository, engine.mediaRoots);
  if (!file || file.blocked || !file.fullPath) {
    const placeholderPath = getSharedPlaceholderPath(size);
    const servedFallback = tryServe(placeholderPath, res);
    if (servedFallback) return;
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const thumbPath = await ensureThumbnailForFile(file, size);
    const served3 = tryServe(thumbPath || '', res) || tryServe(hashedPath, res);
    if (served3) return;
    const placeholderPath = getSharedPlaceholderPath(size);
    const servedFallback = tryServe(placeholderPath, res);
    if (servedFallback) return;
    return res.status(500).json({ error: 'Thumbnail generation failed' });
  } catch {
    const placeholderPath = getSharedPlaceholderPath(size);
    const servedFallback = tryServe(placeholderPath, res);
    if (servedFallback) return;
    return res.status(500).json({ error: 'Thumbnail generation failed' });
  }
}

router.get('/full/:id.jpg', (req, res) => handleThumbnailRequest(req, res, 'full'));
router.get('/list/:id.jpg', (req, res) => handleThumbnailRequest(req, res, 'list'));
router.get('/:id.jpg', (req, res) => handleThumbnailRequest(req, res, 'full'));

router.get('/folder/:id.jpg', async (req, res) => {
  const { id } = req.params;
  const outPath = join(THUMBNAIL_DIR, `folder_${id}.jpg`);

  if (existsSync(outPath)) {
    res.set('Cache-Control', 'public, max-age=300');
    res.set('Content-Type', 'image/jpeg');
    return createReadStream(outPath).pipe(res);
  }

  const key = `folder_${id}`;
  if (generating.has(key)) {
    try {
      await generating.get(key);
      if (existsSync(outPath)) {
        res.set('Cache-Control', 'public, max-age=300');
        res.set('Content-Type', 'image/jpeg');
        return createReadStream(outPath).pipe(res);
      }
    } catch {}
    return res.status(404).json({ error: 'Folder preview not available' });
  }

  try {
    const ok = await runWithinSlot(() => {
      const promise = generateFolderPreview(id);
      generating.set(key, promise);
      return promise;
    });
    if (ok && existsSync(outPath)) {
      res.set('Cache-Control', 'public, max-age=300');
      res.set('Content-Type', 'image/jpeg');
      return createReadStream(outPath).pipe(res);
    }
    return res.status(404).json({ error: 'Folder preview not available' });
  } catch {
    return res.status(500).json({ error: 'Folder preview generation failed' });
  } finally {
    generating.delete(key);
  }
});

export default router;
export { THUMBNAIL_DIR, ensureThumbnailForFile, runWithinSlot, generateThumbnailSingle };
