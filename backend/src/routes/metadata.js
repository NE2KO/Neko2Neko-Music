import { Router } from 'express';
import { readMetadata, extractCover, embedCover } from '../utils/metadataWriter.js';
import { searchCoverAllSources } from '../utils/coverSources.js';
import { searchLyricsCombined } from '../utils/lyricsSources.js';
import { parseLRC, buildLRC } from '../utils/lrcParser.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { resolveFileForEngine } from '@homelab/media-engine';
import Busboy from 'busboy';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

// GET /api/metadata/cover-art/search — search multiple sources for cover art
router.get('/cover-art/search', async (req, res) => {
  try {
    const { artist, album, track, q } = req.query;
    if (!artist && !album && !track && !q) return res.status(400).json({ error: 'artist, album, track, or q required' });

    const results = await searchCoverAllSources(artist || '', album || '', track || '', q || '');
    res.json(results);
  } catch (err) {
    console.error('[metadata] cover-art search error:', err);
    res.status(500).json({ error: 'Failed to search cover art' });
  }
});

// GET /api/metadata/lyrics/search — search multiple sources for lyrics
router.get('/lyrics/search', async (req, res) => {
  try {
    const { track, artist, album, duration, q } = req.query;
    if (!track && !q) return res.status(400).json({ error: 'track or q required' });

    const results = await searchLyricsCombined(
      track || '',
      artist || '',
      album || '',
      duration ? parseFloat(duration) : null,
      q || ''
    );
    res.json(results);
  } catch (err) {
    console.error('[metadata] lyrics search error:', err);
    res.status(500).json({ error: 'Failed to search lyrics' });
  }
});

// GET /api/metadata/:id — read metadata from file + DB
router.get('/:id', async (req, res) => {
  try {
    const engine = globalThis.mediaEngine;
    const resolved = await engine.resolve(req.params.id);
    if (!resolved || resolved.blocked) return res.status(404).json({ error: 'File not found' });
    const meta = await engine.getFileMetadata(req.params.id);
    if (!meta) return res.status(404).json({ error: 'File not found' });

    const internal = await resolveFileForEngine(req.params.id, engine.repository, engine.mediaRoots);
    if (!internal) return res.status(404).json({ error: 'File not found' });
    const filePath = internal.fullPath;
    
    // Read embedded metadata
    let embedded = null;
    try {
      embedded = await readMetadata(filePath);
    } catch (err) {
      // File might not be accessible
    }

    // Get DB overrides via engine metadata
    const dbMeta = {
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      genre: meta.genre,
      lyrics: meta.lyrics,
      lyrics_synced: meta.lyricsSynced ?? meta.lyrics_synced,
      cover_source: meta.coverSource ?? meta.cover_source,
      youtube_id: meta.youtube_id ?? meta.youtubeId,
      video_offset: meta.video_offset ?? meta.videoOffset,
    };

    // Merge: DB overrides embedded
    const metadata = {
      id: resolved.id,
      name: resolved.name,
      type: resolved.type,
      ext: resolved.ext,
      duration: resolved.duration,
      ...embedded,
      ...Object.fromEntries(Object.entries(dbMeta).filter(([_, v]) => v != null && v !== '')),
    };

    res.json(metadata);
  } catch (err) {
    console.error('[metadata] GET error:', err);
    res.status(500).json({ error: 'Failed to read metadata' });
  }
});

// PUT /api/metadata/:id — update metadata
router.put('/:id', async (req, res) => {
  try {
    const engine = globalThis.mediaEngine;
    const resolved = await engine.resolve(req.params.id);
    if (!resolved || resolved.blocked) return res.status(404).json({ error: 'File not found' });

    const { title, artist, album, genre, youtube_id, video_offset } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (artist !== undefined) updates.artist = artist;
    if (album !== undefined) updates.album = album;
    if (genre !== undefined) updates.genre = genre;
    if (youtube_id !== undefined) updates.youtube_id = youtube_id;
    if (video_offset !== undefined) updates.video_offset = video_offset;

    if (Object.keys(updates).length > 0) {
      await engine.updateMetadata(req.params.id, updates);
    }

    const internal = await resolveFileForEngine(req.params.id, engine.repository, engine.mediaRoots);
    // Try to write to file
    try {
      await writeMetadata(internal?.fullPath, { title, artist, album, genre });
    } catch (err) {
      console.warn('[metadata] Could not write to file:', err.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[metadata] PUT error:', err);
    res.status(500).json({ error: 'Failed to update metadata' });
  }
});

// PUT /api/metadata/:id/cover — embed cover art from URL or base64 data
router.put('/:id/cover', async (req, res) => {
  try {
    const engine = globalThis.mediaEngine;
    const resolved = await engine.resolve(req.params.id);
    if (!resolved || resolved.blocked) return res.status(404).json({ error: 'File not found' });

    const internal = await resolveFileForEngine(req.params.id, engine.repository, engine.mediaRoots);
    if (!internal) return res.status(404).json({ error: 'File not found' });

    const { imageUrl, imageData, source } = req.body;
    if (!imageUrl && !imageData) return res.status(400).json({ error: 'imageUrl or imageData required' });

    let buffer;
    let contentType = 'image/jpeg';

    if (imageData) {
      // Decode base64 image data
      const matches = imageData.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!matches) return res.status(400).json({ error: 'Invalid imageData format' });
      contentType = matches[1];
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      // Fetch image from URL
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) return res.status(400).json({ error: 'Failed to fetch image' });
      buffer = Buffer.from(await imgRes.arrayBuffer());
      contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    }

    // Embed into file
    await embedCover(internal.fullPath, buffer, contentType);

    // Update DB via engine
    await engine.updateMetadata(req.params.id, { cover_source: source || 'external' });

    // Regenerate thumbnail — save directly from buffer
    try {
      const { THUMBNAIL_DIR } = await import('../routes/thumbnails.js');
      const { mkdirSync } = await import('node:fs');
      mkdirSync(THUMBNAIL_DIR, { recursive: true });
      const thumbPath = join(THUMBNAIL_DIR, `${resolved.id}.jpg`);
      await writeFile(thumbPath, buffer);
    } catch (err) {
      console.warn('[metadata] Could not save thumbnail:', err.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[metadata] PUT cover error:', err);
    res.status(500).json({ error: 'Failed to embed cover art' });
  }
});

// PUT /api/metadata/:id/cover/upload — upload cover as multipart (from CropTool)
router.put('/:id/cover/upload', async (req, res) => {
  try {
    const engine = globalThis.mediaEngine;
    // Need to check existence early — but busboy is streaming, so defer file check until finish
    // Do a quick resolve to validate id exists
    const preview = await engine.resolve(req.params.id);
    if (!preview || preview.blocked) return res.status(404).json({ error: 'File not found' });

    let busboy;
    try {
      busboy = Busboy({ headers: req.headers, limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
    } catch {
      return res.status(400).json({ error: 'Invalid multipart request' });
    }

    const chunks = [];
    let contentType = 'image/jpeg';

    busboy.on('file', (fieldname, stream, info) => {
      contentType = info.mimeType || 'image/jpeg';
      stream.on('data', (chunk) => chunks.push(chunk));
    });

    busboy.on('finish', async () => {
      try {
        const buffer = Buffer.concat(chunks);

        const resolved = await engine.resolve(req.params.id);
        if (!resolved || resolved.blocked) return res.status(404).json({ error: 'File not found' });

        const internal = await resolveFileForEngine(req.params.id, engine.repository, engine.mediaRoots);
        if (!internal) return res.status(404).json({ error: 'File not found' });

        await embedCover(internal.fullPath, buffer, contentType);

        await engine.updateMetadata(req.params.id, { cover_source: 'youtube-cropped' });

        // Save thumbnail
        try {
          const { THUMBNAIL_DIR } = await import('../routes/thumbnails.js');
          const { mkdirSync } = await import('node:fs');
          mkdirSync(THUMBNAIL_DIR, { recursive: true });
          const thumbPath = join(THUMBNAIL_DIR, `${resolved.id}.jpg`);
          await writeFile(thumbPath, buffer);
        } catch (err) {
          console.warn('[metadata] Could not save thumbnail:', err.message);
        }

        res.json({ success: true });
      } catch (err) {
        console.error('[metadata] cover upload error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to embed cover art' });
      }
    });

    busboy.on('error', (err) => {
      console.error('[metadata] busboy error:', err.message);
      if (!res.headersSent) res.status(400).json({ error: 'Upload failed' });
    });

    req.pipe(busboy);
  } catch (err) {
    console.error('[metadata] cover upload setup error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to process upload' });
  }
});

// GET /api/metadata/:id/lyrics — get lyrics
router.get('/:id/lyrics', async (req, res) => {
  try {
    const engine = globalThis.mediaEngine;
    const meta = await engine.getFileMetadata(req.params.id);
    if (!meta) return res.status(404).json({ error: 'File not found' });

    res.json({
      plainLyrics: meta.lyrics || null,
      syncedLyrics: meta.lyricsSynced ?? meta.lyrics_synced ?? null,
      romajiLyrics: meta.lyrics_romaji ?? meta.lyricsRomaji ?? null,
    });
  } catch (err) {
    console.error('[metadata] GET lyrics error:', err);
    res.status(500).json({ error: 'Failed to read lyrics' });
  }
});

// PUT /api/metadata/:id/lyrics — save lyrics
router.put('/:id/lyrics', async (req, res) => {
  try {
    const engine = globalThis.mediaEngine;
    const resolved = await engine.resolve(req.params.id);
    if (!resolved || resolved.blocked) return res.status(404).json({ error: 'File not found' });

    const { plainLyrics, syncedLyrics, romajiLyrics } = req.body;

    // Save to DB via engine
    await engine.updateMetadata(req.params.id, {
      lyrics: plainLyrics || null,
      lyrics_synced: syncedLyrics || null,
      lyrics_romaji: romajiLyrics || null,
    });

    // Export .lrc file to same directory
    if (syncedLyrics) {
      const lrcPath = join(resolved.dirPath || '', resolved.name.replace(/\.[^.]+$/, '.lrc'));
      // Resolve full LRC path via engine's mediaRoots
      const { resolveFullPath } = await import('@homelab/media-engine');
      const fullLrcPath = resolveFullPath(lrcPath, globalThis.mediaEngine.mediaRoots);
      try {
        await writeFile(fullLrcPath, syncedLyrics, 'utf-8');
      } catch (err) {
        console.warn('[metadata] Could not write .lrc file:', err.message);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[metadata] PUT lyrics error:', err);
    res.status(500).json({ error: 'Failed to save lyrics' });
  }
});

// Helper: writeMetadata (local to this file since metadataWriter exports it differently)
async function writeMetadata(filePath, updates) {
  // For now, metadata writing is handled by the DB
  // Full file writing can be added later with format-specific encoders
}

export default router;
