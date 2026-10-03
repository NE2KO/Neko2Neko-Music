import { Router } from 'express';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname } from 'node:path';
import { searchVideo, downloadVideo, getCachedVideoPath, getCacheInfo, clearCache, getDownloadProgress, deleteVideo, ensureSeekable } from '../utils/videoCache.js';
import { searchYouTube } from '../utils/youtube.js';
import { musicStmts } from '../db.js';

const router = Router();

router.post('/search', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'query required' });
    // Scored YouTube search (adaptive, negative evidence, threshold) — strict precision
    const results = await searchYouTube(query);
    // Map to frontend expected shape (keep score for UI)
    const mapped = results.map(r => ({
      id: r.videoId || r.release?.id,
      title: r.title || r.release?.title || '',
      channel: r.channelTitle || r.release?.artist || '',
      duration: r.duration || 0,
      thumbnail: r.cover?.thumbnails?.medium || r.cover?.image || `https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg`,
      score: r.score,
      scoreDebug: r.scoreDebug,
      viewCount: r.viewCount,
      source: r.source,
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/auto-detect/:id', async (req, res) => {
  try {
    const file = musicStmts.getFileWithPath.get(req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found' });

    const searchQuery = file.name.replace(/\.[^.]+$/, '');
    const results = await searchVideo(searchQuery, 5);
    res.json({ query: searchQuery, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/save-id/:id', async (req, res) => {
  try {
    const { youtubeId } = req.body;
    if (!youtubeId) return res.status(400).json({ error: 'youtubeId required' });

    const db = (await import('../db.js')).default;
    db.prepare('UPDATE files SET youtube_id = ? WHERE id = ?').run(youtubeId, req.params.id);
    res.json({ success: true, youtube_id: youtubeId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/download/:youtubeId', async (req, res) => {
  try {
    const cached = getCachedVideoPath(req.params.youtubeId);
    if (cached && !req.query.force) {
      return res.json({ status: 'cached', path: `/api/video-cache/stream/${req.params.youtubeId}` });
    }

    // Trigger download in background
    const format = req.body && req.body.format ? req.body.format : null;
    downloadVideo(req.params.youtubeId, (progress) => {
      // progress is updated in videoCache.js
    }, Boolean(req.query.force), format).then((path) => {
      // status cached already returned via JSON response; skip noisy console.log
    }).catch((err) => {
      console.error(`[videoCache] ${req.params.youtubeId}: ${err.message}`);
    });

    res.json({ status: 'downloading' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:youtubeId', async (req, res) => {
  try {
    const ok = await deleteVideo(req.params.youtubeId);
    res.json({ success: true, removed: ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/progress/:youtubeId', (req, res) => {
  const prog = getDownloadProgress(req.params.youtubeId);
  // While a download is actively running, progress is a numeric percentage.
  // A partial raw .mp4 already exists on disk at that point, so do NOT trust the
  // disk check here or we'd report "cached" before the download finishes.
  if (typeof prog === 'number') {
    res.json({ status: 'downloading', progress: prog });
    return;
  }
  if (prog === 'error') {
    res.json({ status: 'error', progress: 0 });
    return;
  }
  // prog is undefined/null (e.g. after a server restart cleared the in-memory
  // map) or 'done'. The physically-cached file is the source of truth and
  // survives restarts, so a cached video is no longer wrongly reported as
  // "downloading" after a restart.
  if (prog === 'done' || prog === 'cached' || getCachedVideoPath(req.params.youtubeId)) {
    res.json({ status: 'cached', progress: 100 });
  } else {
    res.json({ status: 'downloading', progress: 0 });
  }
});

router.get('/stream/:youtubeId', async (req, res) => {
  const youtubeId = req.params.youtubeId;

  // Serve whatever cached file exists IMMEDIATELY — don't block on
  // ensureSeekable() which can take 30+ seconds for a short-GOP re-encode.
  // The raw .mp4 is perfectly playable; the optimized copy (.seek/.sgop) will
  // be ready for NEXT request.
  const videoPath = getCachedVideoPath(youtubeId);
  if (!videoPath) {
    // No cached file at all. This shouldn't happen if the download completed,
    // but try ensureSeekable as a last resort (audio-only .m4a won't have a
    // video copy to build).
    try {
      await ensureSeekable(youtubeId);
    } catch (e) {
      console.error(`[videoCache] ensureSeekable ${youtubeId}: ${e.message}`);
    }
    const retryPath = getCachedVideoPath(youtubeId);
    if (!retryPath) return res.status(404).json({ error: 'Not cached' });
    return serveVideo(res, retryPath);
  }

  // Fire ensureSeekable in background for NEXT request — build the optimized
  // copy so subsequent plays serve the faststart / short-GOP file.
  ensureSeekable(youtubeId).catch(() => {});

  serveVideo(res, videoPath);
});

function serveVideo(res, videoPath) {
  const ext = extname(videoPath).toLowerCase();
  const mime = ext === '.mp4' ? 'video/mp4' : ext === '.m4a' ? 'audio/mp4' : 'video/webm';

  const fileInfo = statSync(videoPath);
  const fileSize = fileInfo.size;
  const range = res.req?.headers?.range || '';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const stream = createReadStream(videoPath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=86400',
    });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
    });
    createReadStream(videoPath).pipe(res);
  }
}

router.get('/status', async (req, res) => {
  try {
    const info = await getCacheInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/clear', async (req, res) => {
  try {
    await clearCache();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
