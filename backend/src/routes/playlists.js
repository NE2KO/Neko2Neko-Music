import { Router } from 'express';
import db, { playlistStmts } from '../db.js';
import { ensureThumbnailForFile } from './thumbnails.js';
import { resolveFileForEngine } from '@homelab/media-engine';
import { parseXSPF, isValidXSPF, getPlaylistSummary } from '../utils/xspfParser.js';
import { MEDIA_ROOT } from '../server.js';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, basename, extname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import Busboy from 'busboy';

const router = Router();

/**
 * GET /api/playlists - Get all discovered playlists
 */
router.get('/', (req, res) => {
  try {
    const playlists = playlistStmts.getAllPlaylists.all();
    
    res.json({
      playlists: playlists.map(p => ({
        id: p.id,
        path: p.path,
        title: p.title || p.path.split('/').pop(),
        creator: p.creator,
        sourceType: detectSourceType(p.path),
        track_count: p.track_count,
        available_tracks: p.available_tracks,
        missing_tracks: p.missing_tracks,
        total_duration: p.total_duration,
        total_size: p.total_size,
        has_image: !!p.image,
        last_scanned: p.last_scanned,
        last_updated: p.last_updated,
        created_at: p.created_at,
      })),
      total: playlists.length,
    });
  } catch (err) {
    console.error('[playlists] Error:', err);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// Helper to detect playlist source type
function detectSourceType(path) {
  if (!path) return 'unknown';
  if (path.startsWith('manual://')) return 'manual';
  if (path.startsWith('folder://')) return 'folder';
  if (path.startsWith('imported://')) return 'imported-xspf';
  if (path.endsWith('.xspf')) return 'imported-xspf';
  return 'unknown';
}

/**
 * Normalize path for robust comparison (strip common prefix, lowercase, etc.)
 */
function normalizePathForDedup(p) {
  if (!p) return '';
  // Strip any trailing/leading whitespace and lowercase
  let n = p.trim().toLowerCase().replace(/\\/g, '/');
  // If path starts with a root prefix like /home/<user>/, strip it for comparison
  // We also handle "Music/..." style relative paths
  // Try to find a common media root pattern and strip it
  const rootMatch = n.match(/^(?:\/\w+)+\/(music|media|mnt|home)\/(.+)$/i);
  if (rootMatch) {
    // Return everything after the first known media folder parent
    // e.g. /home/user/Music/Artist/song.flac进行治疗
    const parts = n.split('/');
    const musicIdx = parts.findIndex(part => part === 'music' || part === 'media');
    if (musicIdx >= 0) {
      return parts.slice(musicIdx).join('/');
    }
  }
  // For relative paths, just return as-is after normalization
  return n.replace(/^\/+/, '');
}

/**
 * GET /api/playlists/:id - Get playlist details with tracks
 */
router.get('/:id', (req, res) => {
  try {
    const playlistId = parseInt(req.params.id, 10);
    if (isNaN(playlistId)) {
      return res.status(400).json({ error: 'Invalid playlist ID' });
    }
    
    const playlist = playlistStmts.getPlaylistById.get(playlistId);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    
    const tracks = playlistStmts.getPlaylistTracks.all(playlistId);
    
    const commonParent = MEDIA_ROOT.length > 0
      ? MEDIA_ROOT.reduce((a, b) => {
          const aParts = a.split('/');
          const bParts = b.split('/');
          let i = 0;
          while (i < aParts.length && i < bParts.length && aParts[i] === bParts[i]) i++;
          return aParts.slice(0, i).join('/');
        })
      : '';
    function normPath(p) {
      if (!p) return '';
      if (commonParent && p.startsWith(commonParent + '/')) return p.substring(commonParent.length + 1);
      return p;
    }
    
    // Resolve file IDs inline (eliminates N+1 frontend requests)
    const uniqueNames = [...new Set(
      tracks.filter(t => t.resolved_path)
        .map(t => t.resolved_path.split('/').pop())
    )].filter(Boolean);
    let pathToFile = new Map();
    if (uniqueNames.length > 0) {
      const placeholders = uniqueNames.map(() => '?').join(',');
      const allFiles = db.prepare(`
        SELECT f.id, f.name, fo.path as dir_path, f.created_at, f.created_at_embedded, f.is_favorite, f.has_thumb, f.youtube_id, f.video_offset
        FROM files f JOIN folders fo ON f.dir_id = fo.id
        WHERE f.name IN (${placeholders})
      `).all(...uniqueNames);
      // Index by full path (dir_path/name)
      pathToFile = new Map(allFiles.map(f => [`${f.dir_path}/${f.name}`, f]));
      // Also index by absolute path variants for each MEDIA_ROOT
      for (const root of MEDIA_ROOT) {
        for (const f of allFiles) {
          pathToFile.set(`${root}/${f.dir_path}/${f.name}`, f);
        }
      }
      // Last-resort fallback: index by filename only
      // Only for filenames that have a single match (no collisions)
      const nameCount = new Map();
      for (const f of allFiles) {
        nameCount.set(f.name, (nameCount.get(f.name) || 0) + 1);
      }
      for (const f of allFiles) {
        if (nameCount.get(f.name) === 1 && !pathToFile.has(f.name)) {
          pathToFile.set(f.name, f);
        }
      }
    }

    // Bulk-resolve files referenced by track `location` (/file/<id>) in a single
    // query instead of one getFile per track (the N+1 that stalls large playlist
    // opens). Ordering still follows the original playlist `tracks`, so this only
    // replaces the per-track metadata lookups with an O(1) Map lookup.
    const locationIds = [...new Set(
      tracks.map(t => t.location?.match(/^\/file\/(.+)$/)?.[1]).filter(Boolean)
    )];
    let idToFile = new Map();
    if (locationIds.length > 0) {
      const placeholders = locationIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT * FROM files WHERE id IN (${placeholders})`).all(...locationIds);
      idToFile = new Map(rows.map(f => [String(f.id), f]));
    }

    const trackList = tracks.map(t => {
      const rp = t.resolved_path;
      const norm = rp ? normPath(rp) : null;
      const fname = rp?.split('/').pop();
      // Resolve file_id. Prefer the track's own `location` (/file/<id>) as the
      // canonical file id — this guarantees two distinct playlist tracks never
      // collide on the same file_id. Only fall back to the path/filename heuristic
      // when location is missing.
      let dbFile = null;
      const locMatch = t.location?.match(/^\/file\/(.+)$/);
      if (locMatch) {
        dbFile = idToFile.get(locMatch[1]);
      }
      if (!dbFile && norm) dbFile = pathToFile.get(norm);
      if (!dbFile && rp) dbFile = pathToFile.get(rp);
      if (!dbFile && fname) dbFile = pathToFile.get(fname);
      return {
        id: t.id,
        file_id: dbFile?.id || null,
        track_index: t.track_index,
        location: t.location,
        resolved_path: t.resolved_path,
        display_name: t.resolved_path?.split('/').pop()?.replace(/\.[^/.]+$/, '') ?? null,
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        artwork: t.artwork,
        track_num: t.track_num,
        exists: !!t.file_exists && !!dbFile?.id,
        size: t.file_size,
        mtime: t.file_mtime,
        created_at: dbFile?.created_at || t.file_mtime || 0,
        type: dbFile?.type || 'audio',
        is_favorite: dbFile?.is_favorite || 0,
        has_thumb: dbFile?.has_thumb || 0,
        youtube_id: dbFile?.youtube_id || null,
        video_offset: dbFile?.video_offset || 0,
      };
    });

    res.json({
      id: playlist.id,
      path: playlist.path,
      title: playlist.title || playlist.path.split('/').pop(),
      creator: playlist.creator,
      sourceType: detectSourceType(playlist.path),
      annotation: playlist.annotation,
      info: playlist.info,
      image: playlist.image,
      track_count: playlist.track_count,
      available_tracks: playlist.available_tracks,
      missing_tracks: playlist.missing_tracks,
      total_duration: playlist.total_duration,
      total_size: playlist.total_size,
      last_scanned: playlist.last_scanned,
      last_updated: playlist.last_updated,
      tracks: trackList,
    });

    // Pre-generate thumbnails for tracks missing one, deferred to the next
    // tick and capped by getMaxConcurrent() so a playlist open with many
    // missing thumbs can't spawn a burst of ffmpeg that saturates CPU/IO,
    // which would stall audio streaming (lingering player spinner) and slow
    // other playlist loads. Never blocks the response.
    setImmediate(async () => {
      const seenThumbIds = new Set();
      const engine = globalThis.mediaEngine;
      if (!engine) return;
      for (const t of trackList) {
        if (!t.file_id || t.has_thumb || seenThumbIds.has(t.file_id)) continue;
        seenThumbIds.add(t.file_id);
        try {
          const file = await resolveFileForEngine(t.file_id, engine.repository, engine.mediaRoots);
          if (file && !file.blocked && file.fullPath) {
            ensureThumbnailForFile(file).catch(() => {});
          }
        } catch {}
      }
    });
  } catch (err) {
    console.error('[playlists/:id] Error:', err);
    res.status(500).json({ error: 'Failed to fetch playlist' });
  }
});

/**
 * POST /api/playlists/:id/image - Upload / replace a playlist's cover image.
 * Stores the image as a base64 data URL in the playlist `image` column
 * (kept small via a hard size cap + PNG/JPEG/WebP allow-list).
 */
router.post('/:id/image', (req, res) => {
  const playlistId = parseInt(req.params.id, 10);
  if (isNaN(playlistId)) {
    return res.status(400).json({ error: 'Invalid playlist ID' });
  }
  const playlist = playlistStmts.getPlaylistById.get(playlistId);
  if (!playlist) {
    return res.status(404).json({ error: 'Playlist not found' });
  }

  let busboy;
  try {
    busboy = Busboy({ headers: req.headers, limits: { fileSize: 3 * 1024 * 1024, files: 1 } });
  } catch (e) {
    return res.status(400).json({ error: 'Invalid multipart request' });
  }

  let fileData = Buffer.alloc(0);
  let mime = '';
  let aborted = false;

  busboy.on('file', (fieldname, stream, info) => {
    if (fieldname !== 'image') {
      stream.resume();
      return;
    }
    mime = info.mimeType || '';
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(mime)) {
      aborted = true;
      stream.resume();
      return res.status(415).json({ error: 'Unsupported image type' });
    }
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => { fileData = Buffer.concat(chunks); });
  });

  busboy.on('close', () => {
    if (aborted) return;
    if (fileData.length === 0) {
      return res.status(400).json({ error: 'No image provided' });
    }
    const dataUrl = `data:${mime};base64,${fileData.toString('base64')}`;
    try {
      db.prepare('UPDATE playlists SET image = ? WHERE id = ?').run(dataUrl, playlistId);
      res.json({ id: playlistId, image: dataUrl });
    } catch (err) {
      console.error('[playlists/:id/image] Error:', err);
      res.status(500).json({ error: 'Failed to save cover image' });
    }
  });

  busboy.on('error', () => res.status(500).json({ error: 'Upload failed' }));
  req.pipe(busboy);
});

/**
 * GET /api/playlists/:id/image - Serve a playlist's cover image (base64 data URL).
 * Lets the frontend show the set cover immediately from just the playlist id,
 * instead of flashing the default until the full playlist payload is loaded.
 */
router.get('/:id/image', (req, res) => {
  const playlistId = parseInt(req.params.id, 10);
  if (isNaN(playlistId)) {
    return res.status(400).json({ error: 'Invalid playlist ID' });
  }
  const playlist = playlistStmts.getPlaylistById.get(playlistId);
  if (!playlist || !playlist.image) {
    return res.status(404).json({ error: 'Cover not found' });
  }
  const image = String(playlist.image);
  if (/^data:(image\/[\w.+-]+);base64,/.test(image)) {
    const matches = image.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
    res.setHeader('Content-Type', matches[1]);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(Buffer.from(matches[2], 'base64'));
  }
  if (/^(https?:|\/\/)/i.test(image)) {
    return res.redirect(image);
  }
  res.status(404).json({ error: 'Cover not found' });
});

/**
 * GET /api/playlists/:id/play - Get playback-ready queue
 */
router.get('/:id/play', (req, res) => {
  try {
    const playlistId = parseInt(req.params.id, 10);
    if (isNaN(playlistId)) {
      return res.status(400).json({ error: 'Invalid playlist ID' });
    }
    
    const playlist = playlistStmts.getPlaylistById.get(playlistId);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    
    const tracks = playlistStmts.getPlaylistTracks.all(playlistId);
    
    const commonParent = MEDIA_ROOT.length > 0
      ? MEDIA_ROOT.reduce((a, b) => {
          const aParts = a.split('/');
          const bParts = b.split('/');
          let i = 0;
          while (i < aParts.length && i < bParts.length && aParts[i] === bParts[i]) i++;
          return aParts.slice(0, i).join('/');
        })
      : '';
    function normalizePath(p) {
      if (!p) return '';
      if (commonParent && p.startsWith(commonParent + '/')) {
        return p.substring(commonParent.length + 1);
      }
      return p;
    }
    
    // Build path→file map with targeted query (only resolve track filenames)
    const uniqueNames2 = [...new Set(
      tracks.filter(t => t.resolved_path)
        .map(t => t.resolved_path.split('/').pop())
    )].filter(Boolean);
    let pathToFile = new Map();
    if (uniqueNames2.length > 0) {
      const placeholders = uniqueNames2.map(() => '?').join(',');
      const allFiles = db.prepare(`
        SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.duration, f.created_at, f.has_thumb, f.is_favorite, f.youtube_id, f.video_offset,
               fo.path as dir_path
        FROM files f
        JOIN folders fo ON f.dir_id = fo.id
        WHERE f.name IN (${placeholders})
      `).all(...uniqueNames2);
      pathToFile = new Map(allFiles.map(f => [`${f.dir_path}/${f.name}`, f]));
      for (const root of MEDIA_ROOT) {
        for (const f of allFiles) {
          pathToFile.set(`${root}/${f.dir_path}/${f.name}`, f);
        }
      }
      const nameCount2 = new Map();
      for (const f of allFiles) {
        nameCount2.set(f.name, (nameCount2.get(f.name) || 0) + 1);
      }
      for (const f of allFiles) {
        if (nameCount2.get(f.name) === 1 && !pathToFile.has(f.name)) {
          pathToFile.set(f.name, f);
        }
      }
    }

    // Bulk-resolve files referenced by track `location` (/file/<id>) in a single
    // query instead of one getFile per track (N+1). Ordering still follows the
    // original playlist `tracks`, so only the metadata lookups change.
    const locationIds = [...new Set(
      tracks.map(t => t.location?.match(/^\/file\/(.+)$/)?.[1]).filter(Boolean)
    )];
    let idToFile = new Map();
    if (locationIds.length > 0) {
      const placeholders = locationIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT * FROM files WHERE id IN (${placeholders})`).all(...locationIds);
      idToFile = new Map(rows.map(f => [String(f.id), f]));
    }

    const playableTracks = tracks
      .map(t => {
        const rp = t.resolved_path;
        const norm = rp ? normalizePath(rp) : null;
        const fname = rp?.split('/').pop();
        // Prefer the track's own `location` (/file/<id>) as the canonical file id so
        // two distinct tracks never collide; fall back to path/filename heuristic.
        let dbFile = null;
        const locMatch = t.location?.match(/^\/file\/(.+)$/);
        if (locMatch) {
          dbFile = idToFile.get(locMatch[1]);
        }
        if (!dbFile && norm) dbFile = pathToFile.get(norm);
        if (!dbFile && rp) dbFile = pathToFile.get(rp);
        if (!dbFile && fname) dbFile = pathToFile.get(fname);
        
        return {
          file_id: dbFile?.id,
          track_index: t.track_index,
          display_name: t.resolved_path?.split('/').pop()?.replace(/\.[^/.]+$/, '') ?? null,
          resolved_path: t.resolved_path,
          location: t.location,
          title: t.title,
          artist: t.artist,
          album: t.album,
          duration: t.duration,
          path: t.resolved_path,
          exists: true,
          type: dbFile?.type || 'audio',
          is_favorite: dbFile?.is_favorite || 0,
          youtube_id: dbFile?.youtube_id || null,
          video_offset: dbFile?.video_offset || 0,
          // Sort keys so GET /play can reproduce the UI's chosen track sort
          // (previously this endpoint returned raw DB order, so re-opening a
          // playlist after sorting reverted the carousel to "sort none").
          created_at: dbFile?.created_at || t.file_mtime || 0,
          mtime: t.file_mtime || 0,
          size: dbFile?.size || t.file_size || 0,
          name: dbFile?.name || t.resolved_path?.split('/').pop() || '',
        };
      });

    // Honor the user's chosen track sort when provided (sortBy/sortOrder query
    // params). When absent, keep the original raw-DB order for backward compat.
    const sortBy = req.query.sortBy || null;
    const sortOrder = req.query.sortOrder === 'desc' ? 'desc' : 'asc';
    const NUMERIC_KEYS = new Set(['duration', 'track_num', 'track_index', 'created_at', 'mtime', 'size']);
    let queue = playableTracks;
    if (sortBy && sortBy !== 'null' && sortBy !== 'is_favorite' && sortBy !== 'None') {
      const numeric = NUMERIC_KEYS.has(sortBy);
      queue = playableTracks.slice().sort((a, b) => {
        let va = a[sortBy];
        let vb = b[sortBy];
        if (sortBy === 'name') { va = a.display_name; vb = b.display_name; }
        if (numeric) {
          va = Number(va) || 0;
          vb = Number(vb) || 0;
        } else {
          va = String(va ?? '').toLowerCase();
          vb = String(vb ?? '').toLowerCase();
        }
        if (va < vb) return sortOrder === 'asc' ? -1 : 1;
        if (va > vb) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    }

    res.json({
      playlist: {
        id: playlist.id,
        title: playlist.title,
        creator: playlist.creator,
        image: playlist.image,
      },
      queue,
      total: queue.length,
    });
  } catch (err) {
    console.error('[playlists/:id/play] Error:', err);
    res.status(500).json({ error: 'Failed to prepare playback queue' });
  }
});

/**
 * POST /api/playlists/scan - Scan for XSPF playlists in media roots
 */
router.post('/scan', async (req, res) => {
  try {
    const { scanPlaylists } = await import('../utils/playlistScanner.js');
    const result = await scanPlaylists();
    
    res.json({
      message: 'Playlist scan complete',
      ...result,
    });
  } catch (err) {
    console.error('[playlists/scan] Error:', err);
    res.status(500).json({ error: 'Playlist scan failed', details: err.message });
  }
});

/**
 * POST /api/playlists/:id/refresh - Refresh/reparse a playlist
 */
router.post('/:id/refresh', async (req, res) => {
  try {
    const playlistId = parseInt(req.params.id, 10);
    if (isNaN(playlistId)) {
      return res.status(400).json({ error: 'Invalid playlist ID' });
    }
    
    const playlist = playlistStmts.getPlaylistById.get(playlistId);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    
    if (!existsSync(playlist.path)) {
      return res.status(404).json({ error: 'Playlist file no longer exists' });
    }
    
    const { parseAndCachePlaylist } = await import('../utils/playlistScanner.js');
    const result = await parseAndCachePlaylist(playlist.path);
    
    res.json({
      message: 'Playlist refreshed',
      ...result,
    });
  } catch (err) {
    console.error('[playlists/:id/refresh] Error:', err);
    res.status(500).json({ error: 'Failed to refresh playlist', details: err.message });
  }
});

/**
 * DELETE /api/playlists/:id - Remove playlist from cache (doesn't delete file)
 */
router.delete('/:id', (req, res) => {
  try {
    const playlistId = parseInt(req.params.id, 10);
    if (isNaN(playlistId)) {
      return res.status(400).json({ error: 'Invalid playlist ID' });
    }
    
    const playlist = playlistStmts.getPlaylistById.get(playlistId);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    // Hard-delete if ?permanent=true query param is set
    if (req.query.permanent === 'true') {
      playlistStmts.deletePlaylistTracks.run(playlistId);
      playlistStmts.deletePlaylist.run(playlistId);
      return res.json({ message: 'Playlist permanently deleted', path: playlist.path });
    }
    
    // Soft-delete: mark as deleted so XSPF scanner doesn't re-add it
    playlistStmts.softDeletePlaylist.run(Date.now(), playlistId);
    
    res.json({ message: 'Playlist deleted (soft)', path: playlist.path });
  } catch (err) {
    console.error('[playlists/:id/delete] Error:', err);
    res.status(500).json({ error: 'Failed to delete playlist' });
  }
});

/**
 * POST /api/playlists/create/manual - Create manual playlist from selected files
 */
router.post('/create/manual', (req, res) => {
  try {
    const { title, fileIds } = req.body;
    
    if (!title || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'Title and fileIds array required' });
    }
    
    const now = Date.now();
    const playlistTitle = title.trim() || `Manual Playlist ${new Date().toLocaleString()}`;
    
    // Get file details from database
    const files = [];
    for (const fileId of fileIds) {
      const file = playlistStmts.getFileWithPath.get(fileId);
      if (file) {
        files.push(file);
      }
    }
    
    if (files.length === 0) {
      return res.status(404).json({ error: 'No valid files found' });
    }
    
    // Create playlist entry
    const result = playlistStmts.upsertPlaylist.run({
      path: `manual://${playlistTitle}_${now}`,
      title: playlistTitle,
      creator: 'Manual Playlist',
      annotation: 'Created from selected files',
      info: null,
      image: null,
      track_count: files.length,
      total_duration: files.reduce((sum, f) => sum + (f.duration || 0), 0),
      total_size: files.reduce((sum, f) => sum + (f.size || 0), 0),
      available_tracks: files.length,
      missing_tracks: 0,
      last_scanned: now,
      last_updated: now,
      created_at: now,
    });
    
    const playlistId = result.lastInsertRowid || playlistStmts.getPlaylistIdByPath.get(`manual://${playlistTitle}_${now}`)?.id;
    
    // Insert tracks
    const insertTrack = playlistStmts.insertPlaylistTrack;
    const tx = db.transaction(() => {
      files.forEach((file, idx) => {
        insertTrack.run(
          playlistId,
          idx,
          `/file/${file.id}`,
          `${file.dir_path}/${file.name}`,
          file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' '),
          '',
          '',
          file.duration || 0,
          null,
          idx + 1,
          1,
          file.size || 0,
          file.mtime || 0,
        );
      });
    });
    tx();
    
    res.json({
      id: playlistId,
      title: playlistTitle,
      track_count: files.length,
      sourceType: 'manual',
    });
  } catch (err) {
    console.error('[playlists/create/manual] Error:', err);
    res.status(500).json({ error: 'Failed to create manual playlist', details: err.message });
  }
});

/**
 * POST /api/playlists/create/empty - Create empty playlist with title only
 */
router.post('/create/empty', (req, res) => {
  try {
    const { title } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title required' });
    }

    const now = Date.now();
    const playlistTitle = title.trim();

    const result = playlistStmts.upsertPlaylist.run({
      path: `manual://${playlistTitle}_${now}`,
      title: playlistTitle,
      creator: 'Manual Playlist',
      annotation: 'Created manually',
      info: null,
      image: null,
      track_count: 0,
      total_duration: 0,
      total_size: 0,
      available_tracks: 0,
      missing_tracks: 0,
      last_scanned: now,
      last_updated: now,
      created_at: now,
    });

    const playlistId = result.lastInsertRowid || playlistStmts.getPlaylistIdByPath.get(`manual://${playlistTitle}_${now}`)?.id;

    res.json({
      id: playlistId,
      title: playlistTitle,
      track_count: 0,
      sourceType: 'manual',
    });
  } catch (err) {
    console.error('[playlists/create/empty] Error:', err);
    res.status(500).json({ error: 'Failed to create playlist', details: err.message });
  }
});

/**
 * POST /api/playlists/:id/tracks - Add tracks to existing playlist
 */
router.post('/:id/tracks', (req, res) => {
  try {
    const playlistId = parseInt(req.params.id, 10);
    if (isNaN(playlistId)) {
      return res.status(400).json({ error: 'Invalid playlist ID' });
    }
    const { fileIds } = req.body;

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds array required' });
    }

    const playlist = playlistStmts.getPlaylistById.get(playlistId);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    // Get current max track_index
    const lastTrack = playlistStmts.getMaxTrackIndex.get(playlistId);
    let nextIndex = (lastTrack?.maxIdx ?? -1) + 1;

    const files = [];
    for (const fileId of fileIds) {
      const file = playlistStmts.getFileWithPath.get(fileId);
      if (file) files.push(file);
    }

    if (files.length === 0) {
      return res.status(404).json({ error: 'No valid files found' });
    }

    // Check for duplicates — compare normalized resolved_path against existing tracks
    const existingTracks = playlistStmts.getPlaylistTrackPaths.all(playlistId);
    const existingPaths = new Set(existingTracks.map(t => normalizePathForDedup(t.resolved_path)));
    const newFiles = files.filter(f => !existingPaths.has(normalizePathForDedup(`${f.dir_path}/${f.name}`)));
    const skipped = files.length - newFiles.length;

    if (newFiles.length === 0) {
      return res.json({ id: playlistId, title: playlist.title, added: 0, skipped, track_count: existingTracks.length, message: 'All tracks already in playlist' });
    }

    const insertTrack = playlistStmts.insertPlaylistTrack;
    const tx = db.transaction(() => {
      newFiles.forEach((file) => {
        const resolvedPath = `${file.dir_path}/${file.name}`;
        const displayName = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
        insertTrack.run(
          playlistId,
          nextIndex,
          `/file/${file.id}`,
          resolvedPath,
          displayName,
          file.artist || '',
          file.album || '',
          file.duration || 0,
          null,
          nextIndex + 1,
          1,
          file.size || 0,
          file.mtime || 0,
        );
        nextIndex++;
      });

      // Update playlist stats
      const stats = playlistStmts.getPlaylistTrackStats.get(playlistId);
      playlistStmts.updatePlaylistStats.run(stats.cnt, stats.dur, stats.sz, stats.cnt, Date.now(), playlistId);
    });
    tx();

    // Return ALL tracks (existing + new) so frontend has authoritative data.
    // Mirror the field set (and created_at resolution) of GET /:id so the grid
    // keeps its chosen sort immediately after an add — previously this response
    // omitted created_at, so sorting by "Created" silently became a no-op
    // ("sort none") until the playlist was reloaded.
    const allTracks = playlistStmts.getPlaylistTracks.all(playlistId).map(t => {
      const cid = t.location?.match(/^\/file\/(.+)$/)?.[1] || null;
      const dbFile = cid ? playlistStmts.getFile.get(cid) : null;
      return {
        id: t.id,
        file_id: dbFile?.id || null,
        track_index: t.track_index,
        location: t.location,
        resolved_path: t.resolved_path,
        display_name: t.resolved_path?.split('/').pop()?.replace(/\.[^/.]+$/, '') ?? t.title ?? null,
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        artwork: t.artwork,
        track_num: t.track_num,
        exists: !!t.file_exists && !!dbFile?.id,
        size: t.file_size,
        mtime: t.file_mtime,
        created_at: dbFile?.created_at || t.file_mtime || 0,
        type: dbFile?.type || 'audio',
        ext: dbFile?.ext || (t.resolved_path?.split('.').pop()?.toLowerCase() || ''),
        is_favorite: dbFile?.is_favorite || 0,
        youtube_id: dbFile?.youtube_id || null,
        video_offset: dbFile?.video_offset || 0,
        has_thumb: dbFile?.has_thumb || 0,
      };
    });

    res.json({
      id: playlistId,
      title: playlist.title,
      added: newFiles.length,
      skipped,
      track_count: allTracks.length,
      tracks: allTracks,
    });
  } catch (err) {
    console.error('[playlists/:id/tracks] Error:', err);
    res.status(500).json({ error: 'Failed to add tracks', details: err.message });
  }
});

/**
 * DELETE /api/playlists/:id/tracks/:trackId - Remove a track from playlist
 */
router.delete('/:id/tracks/:trackId', (req, res) => {
  try {
    const playlistId = parseInt(req.params.id, 10);
    const trackId = parseInt(req.params.trackId, 10);
    if (isNaN(playlistId) || isNaN(trackId)) {
      return res.status(400).json({ error: 'Invalid playlist or track ID' });
    }

    const playlist = playlistStmts.getPlaylistById.get(playlistId);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    const track = playlistStmts.getPlaylistTrack.get(trackId, playlistId);
    if (!track) {
      return res.status(404).json({ error: 'Track not found in playlist' });
    }

    const tx = db.transaction(() => {
      playlistStmts.deletePlaylistTrack.run(trackId);

      // Renumber remaining tracks
      const remaining = playlistStmts.getPlaylistTrackIds.all(playlistId);
      remaining.forEach((t, i) => playlistStmts.renumberPlaylistTrack.run(i, t.id));

      // Update playlist stats
      const stats = playlistStmts.getPlaylistTrackStats.get(playlistId);
      playlistStmts.updatePlaylistStats.run(stats.cnt, stats.dur, stats.sz, stats.cnt, Date.now(), playlistId);
    });
    tx();

    const countRow = playlistStmts.getPlaylistTrackCount.get(playlistId);
    res.json({ id: playlistId, removed: 1, track_count: countRow?.cnt ?? 0 });
  } catch (err) {
    console.error('[playlists/:id/tracks/:trackId] Error:', err);
    res.status(500).json({ error: 'Failed to remove track', details: err.message });
  }
});

// Bulk delete tracks from a playlist
router.post('/:id/tracks/delete', (req, res) => {
  try {
    const playlistId = parseInt(req.params.id, 10);
    if (isNaN(playlistId)) {
      return res.status(400).json({ error: 'Invalid playlist ID' });
    }
    const { trackIds } = req.body;
    if (!Array.isArray(trackIds) || trackIds.length === 0) {
      return res.status(400).json({ error: 'trackIds array required' });
    }

    const allTracks = playlistStmts.getPlaylistTrackPaths.all(playlistId);
    const fileIdSet = new Set(trackIds.map(String));
    const playlistTrackIds = allTracks
      .filter(t => {
        const match = t.resolved_path?.match(/^\/file\/([^\/]+)/);
        return match && fileIdSet.has(match[1]);
      })
      .map(t => t.id);

    if (playlistTrackIds.length === 0) {
      return res.json({ removed: 0, track_count: allTracks.length });
    }

    const deletePlaceholder = playlistTrackIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM playlist_tracks WHERE playlist_id = ? AND id IN (${deletePlaceholder})`).run(playlistId, ...playlistTrackIds);
    // Renumber remaining tracks
    const remaining = playlistStmts.getPlaylistTrackIds.all(playlistId);
    remaining.forEach((t, i) => playlistStmts.renumberPlaylistTrack.run(i, t.id));
    // Update playlist stats
    const stats = playlistStmts.getPlaylistTrackStats.get(playlistId);
    playlistStmts.updatePlaylistStats.run(stats.cnt, stats.dur, stats.sz, stats.cnt, Date.now(), playlistId);
    res.json({ removed: playlistTrackIds.length, track_count: stats.cnt });
  } catch (err) {
    console.error('[playlists/:id/tracks/delete] Error:', err);
    res.status(500).json({ error: 'Failed to bulk delete tracks', details: err.message });
  }
});

/**
 * GET /api/playlists/:id/available-tracks - Search audio files for adding to playlist
 * Query params: sortBy (name|size|mtime|ext), sortOrder (asc|desc), type (mp3|flac|opus|m4a|aac|all), search, limit
 */
router.get('/:id/available-tracks', (req, res) => {
  try {
    const playlistId = parseInt(req.params.id, 10);
    if (isNaN(playlistId)) {
      return res.status(400).json({ error: 'Invalid playlist ID' });
    }
    const { sortBy = 'name', sortOrder = 'asc', type = 'all', search = '', limit } = req.query;

    const conditions = ["f.type = 'audio'"];
    const params = [];

    // No folder path filter: scanner already scopes to MUSIC_ROOT, and
    // folder paths in DB are stored without the root prefix (e.g. "YouTube").

    // We will filter out already-added tracks in JS using normalized path comparison
    const existingTracks = playlistStmts.getPlaylistTrackPaths.all(playlistId);
    const existingPaths = new Set(existingTracks.map(t => normalizePathForDedup(t.resolved_path)));

    // Filter by extension
    if (type && type !== 'all') {
      conditions.push('f.ext = ?');
      params.push(`.${type}`);
    }

    // Search by name
    if (search && search.trim()) {
      conditions.push('f.name LIKE ?');
      params.push(`%${search.trim()}%`);
    }

    // Sort
    const sortMap = {
      name: 'f.name COLLATE NOCASE',
      size: 'f.size',
      mtime: 'f.mtime',
      created_at: 'f.created_at',
      ext: 'f.ext',
    };
    const sortCol = sortMap[sortBy] || 'f.name COLLATE NOCASE';
    const sortDir = sortOrder === 'desc' ? 'DESC' : 'ASC';

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const queryLimit = limit ? (parseInt(limit) || 10000) : 10000;

    const sql = `
      SELECT f.id, f.name, f.ext, f.size, f.mtime, f.type, f.duration, f.created_at, f.has_thumb,
             d.path as dir_path
      FROM files f
      JOIN folders d ON f.dir_id = d.id
      ${where}
      GROUP BY f.id
      ORDER BY ${sortCol} ${sortDir}, f.id ASC
      LIMIT ${queryLimit}
    `;

    const allFiles = db.prepare(sql).all(...params);

    // Filter out tracks already in the playlist using normalized path comparison
    const files = allFiles.filter(f => {
      const candidatePath = normalizePathForDedup(`${f.dir_path}/${f.name}`);
      return !existingPaths.has(candidatePath);
    });

    // Get total count for the same filters (unfiltered count from DB, minus existing)
    // Since GROUP BY is in the SQL, we can approximate total by filtering the allFiles result count
    const total = files.length;

    // Get type counts from the filtered available files
    const typeCountMap = new Map();
    for (const f of files) {
      const ext = f.ext || '.unknown';
      typeCountMap.set(ext, (typeCountMap.get(ext) || 0) + 1);
    }

    res.json({
      files: files.map(f => ({
        id: f.id,
        name: f.name,
        ext: f.ext,
        size: f.size,
        mtime: f.mtime,
        created_at: f.created_at,
        duration: f.duration || 0,
        dir_path: f.dir_path,
        has_thumb: f.has_thumb || 0,
      })),
      total,
      typeCounts: Object.fromEntries(typeCountMap.entries()),
    });
  } catch (err) {
    console.error('[playlists/:id/available-tracks] Error:', err);
    res.status(500).json({ error: 'Failed to search tracks', details: err.message });
  }
});

/**
 * POST /api/playlists/create/folder - Create playlist from folder scan
 */
router.post('/create/folder', (req, res) => {
  try {
    const { folderPath, title } = req.body;
    
    if (!folderPath) {
      return res.status(400).json({ error: 'folderPath required' });
    }
    
    // Resolve folder path relative to MEDIA_ROOT
    let resolvedPath = folderPath;
    if (!folderPath.startsWith('/')) {
      for (const root of MEDIA_ROOT) {
        const testPath = join(root, folderPath);
        if (existsSync(testPath)) {
          resolvedPath = testPath;
          break;
        }
      }
    }
    
    if (!existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    
     // Scan folder for audio files recursively
    
    const audioExtensions = ['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.wma', '.opus'];
    const foundFiles = [];
    
    function scanDir(dir) {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          try {
            const stats = statSync(fullPath);
            if (stats.isDirectory()) {
              if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                scanDir(fullPath);
              }
            } else if (stats.isFile()) {
              const ext = extname(entry.name).toLowerCase();
              if (audioExtensions.includes(ext)) {
                foundFiles.push(fullPath);
              }
            }
          } catch (err) {
            // Skip inaccessible files
          }
        }
      } catch (err) {
        // Skip inaccessible directories
      }
    }
    
    scanDir(resolvedPath);
    
    if (foundFiles.length === 0) {
      return res.status(404).json({ error: 'No audio files found in folder' });
    }
    
    const now = Date.now();
    const playlistTitle = title || basename(resolvedPath);
    
    // Create playlist entry
    const result = playlistStmts.upsertPlaylist.run({
      path: `folder://${resolvedPath}`,
      title: playlistTitle,
      creator: 'Folder Playlist',
      annotation: `Scanned from ${resolvedPath}`,
      info: null,
      image: null,
      track_count: foundFiles.length,
      total_duration: 0,
      total_size: 0,
      available_tracks: foundFiles.length,
      missing_tracks: 0,
      last_scanned: now,
      last_updated: now,
      created_at: now,
    });
    
    const playlistId = result.lastInsertRowid;
    
    // Match files to database entries and insert tracks
    const insertTrack = playlistStmts.insertPlaylistTrack;
    const lookupFileStmt = playlistStmts.lookupFileByDirPathAndName;
    const tx = db.transaction(() => {
      foundFiles.forEach((filePath, idx) => {
        const fileName = basename(filePath);
        const dirPath = resolvedPath;
        
        const dbFile = lookupFileStmt.get(dirPath, fileName);
        
        const duration = dbFile?.duration || 0;
        const size = dbFile?.size || 0;
        const mtime = dbFile?.mtime || 0;
        
        insertTrack.run(
          playlistId,
          idx,
          filePath,
          filePath,
          fileName.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' '),
          '',
          '',
          duration,
          null,
          idx + 1,
          dbFile ? 1 : 0,
          size,
          mtime,
        );
      });
    });
    tx();
    
    // Update total duration and size
    const stats = playlistStmts.getPlaylistTrackStatsSum.get(playlistId);
    
    playlistStmts.upsertPlaylist.run({
      path: `folder://${resolvedPath}`,
      title: playlistTitle,
      creator: 'Folder Playlist',
      annotation: `Scanned from ${resolvedPath}`,
      info: null,
      image: null,
      track_count: foundFiles.length,
      total_duration: stats?.total_duration || 0,
      total_size: stats?.total_size || 0,
      available_tracks: foundFiles.length,
      missing_tracks: 0,
      last_scanned: now,
      last_updated: now,
      created_at: now,
    });
    
    res.json({
      id: playlistId,
      title: playlistTitle,
      track_count: foundFiles.length,
      sourceType: 'folder',
      sourcePath: resolvedPath,
    });
  } catch (err) {
    console.error('[playlists/create/folder] Error:', err);
    res.status(500).json({ error: 'Failed to create folder playlist', details: err.message });
  }
});

/**
 * POST /api/playlists/import - Import XSPF playlist file
 */
router.post('/import', (req, res) => {
  let busboy;
  try {
    busboy = Busboy({ headers: req.headers, limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  } catch (e) {
    return res.status(400).json({ error: 'Invalid multipart request' });
  }

  let fileData = Buffer.alloc(0);
  let fileName = 'playlist.xspf';

  busboy.on('file', (fieldname, stream, info) => {
    if (fieldname !== 'playlist') {
      stream.resume();
      return;
    }
    fileName = info.filename || 'playlist.xspf';
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => { fileData = Buffer.concat(chunks); });
  });

  busboy.on('finish', async () => {
    if (fileData.length === 0) {
      return res.status(400).json({ error: 'No playlist file provided' });
    }

    const tempPath = join(tmpdir(), `playlist_import_${Date.now()}.xspf`);

    try {
      writeFileSync(tempPath, fileData);

      const playlist = await parseXSPF(tempPath);
      const summary = getPlaylistSummary(playlist);

      const now = Date.now();
      const playlistTitle = playlist.title || `Imported ${basename(fileName)}`;

      const result = playlistStmts.upsertPlaylist.run({
        path: `imported://${playlistTitle}_${now}`,
        title: playlistTitle,
        creator: playlist.creator || 'Imported Playlist',
        annotation: `Imported from ${fileName}`,
        info: playlist.info || null,
        image: playlist.image || null,
        track_count: summary.totalTracks,
        total_duration: summary.totalDuration,
        total_size: summary.totalSize,
        available_tracks: summary.availableTracks,
        missing_tracks: summary.missingTracks,
        last_scanned: now,
        last_updated: now,
        created_at: now,
      });

      const playlistId = result.lastInsertRowid;

      const insertTrack = playlistStmts.insertPlaylistTrack;
      const tx = db.transaction(() => {
        for (let i = 0; i < playlist.tracks.length; i++) {
          const track = playlist.tracks[i];
          insertTrack.run(
            playlistId,
            i,
            track.originalLocation || '',
            track.path || '',
            track.title || '',
            track.artist || '',
            track.album || '',
            track.duration || 0,
            track.artwork || null,
            track.trackNum || i + 1,
            track.exists ? 1 : 0,
            track.size || 0,
            track.mtime || 0,
          );
        }
      });
      tx();

      res.json({
        id: playlistId,
        title: playlistTitle,
        track_count: summary.totalTracks,
        sourceType: 'imported-xspf',
        message: 'Playlist imported successfully',
      });
    } catch (err) {
      console.error('[playlists/import] Error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to import playlist', details: err.message });
      }
    } finally {
      try { unlinkSync(tempPath); } catch (_) {}
    }
  });

  req.pipe(busboy);
});

export default router;