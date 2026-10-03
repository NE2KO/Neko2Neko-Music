import { Router } from 'express';
import { mkdirSync, unlinkSync } from 'node:fs';
import { THUMBNAIL_DIR, getThumbPath } from '../utils/thumbnailUtils.js';
import { ensureThumbnailForFile } from './thumbnails.js';
import { resolveFileForEngine } from '@homelab/media-engine';

mkdirSync(THUMBNAIL_DIR, { recursive: true });

const DEFAULT_LIMIT = 5000;

const router = Router();

// --- Binary media index (playback/navigation) ------------------------------
// Per-folder ordered ID list served as raw 16-byte IDs (the DB id is a 32-char
// hex string = 16 bytes). Client does `offset = i * 16` random access — no JSON.
const INDEX_TYPES = new Set(['video', 'audio', 'image']);
const ID_BYTES = 16;
const SORT_CLAUSE = {
  created_at: { asc: 'f.created_at ASC, f.id DESC', desc: 'f.created_at DESC, f.id DESC' },
  name:       { asc: 'LOWER(f.name) ASC, f.id ASC', desc: 'LOWER(f.name) DESC, f.id DESC' },
  mtime:      { asc: 'f.mtime ASC, f.id ASC',      desc: 'f.mtime DESC, f.id DESC' },
  size:       { asc: 'f.size ASC, f.id ASC',       desc: 'f.size DESC, f.id DESC' },
};
const indexStmtCache = new Map();

function getIndexStmt(sortBy, sortOrder, type, favoriteOnly) {
  const order = SORT_CLAUSE[sortBy] || SORT_CLAUSE.created_at;
  const dir = (sortOrder === 'asc') ? 'asc' : 'desc';
  const key = `${sortBy}:${dir}:${type || '*'}:${favoriteOnly ? 'fav' : '0'}`;
  let stmt = indexStmtCache.get(key);
  if (stmt) return stmt;

  const clauses = ['f.dir_id = ?'];
  if (type && INDEX_TYPES.has(type)) clauses.push("f.type = ?");
  if (favoriteOnly) clauses.push('f.is_favorite = 1');
  const sql = `SELECT f.id FROM files f WHERE ${clauses.join(' AND ')} ORDER BY ${order[dir]}`;
  const db = globalThis.db || globalThis.mediaEngine?.repository?.db;
  stmt = db.prepare(sql);
  indexStmtCache.set(key, stmt);
  return stmt;
}

function queryIndex(dirId, sortBy, sortOrder, type, favoriteOnly) {
  const stmt = getIndexStmt(
    (sortBy === 'all' ? null : sortBy),
    sortOrder,
    (!type || type === 'folder' || type === 'all') ? null : type,
    favoriteOnly === '1' || favoriteOnly === 'true'
  );
  const params = [dirId];
  if (stmt.source.includes("f.type = ?")) params.push(type);
  return stmt.all(...params);
}

// GET /api/files?path=&folder_id=&cursor=&limit=&view=&sortBy=&sortOrder=
router.get('/', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    console.time('[files] API request');
    const folderPath = req.query.path || '';
    const folderIdQuery = req.query.folder_id ? parseInt(req.query.folder_id, 10) : null;
    const cursor = req.query.cursor || null;
    const prevCursorParam = req.query.prev_cursor || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 10000);
    const view = req.query.view || 'grid';
    const sortBy = req.query.sortBy || 'created_at';
    const sortOrder = req.query.sortOrder || 'desc';

    let folder;
    if (folderIdQuery) {
      folder = await engine.getFolder(folderIdQuery);
    } else {
      try {
        const newId = globalThis.mediaScanner?.ensureFolder(folderPath);
        if (newId != null) {
          folder = await engine.getFolder(newId);
        } else {
          folder = null;
        }
      } catch (e) {
        console.timeEnd('[files] API request');
        return res.json({ items: [], folders: [], next_cursor: null, prev_cursor: null, has_more: false, total_count: 0 });
      }
    }
    if (!folder) {
      console.timeEnd('[files] API request');
      return res.json({ items: [], folders: [], next_cursor: null, prev_cursor: null, has_more: false, total_count: 0 });
    }

    const folders = await engine.getFoldersByParent(folder.id);

    const queryLimit = limit + 1;

    const listOpts = {
      folderId: folder.id,
      sortBy,
      sortOrder,
      limit: queryLimit,
      cursor,
      prevCursor: prevCursorParam,
    };
    const type = req.query.type;
    if (type && !['folder', 'all'].includes(type)) listOpts.type = type;
    const favoriteOnly = req.query.favoriteOnly;
    if (favoriteOnly === '1' || favoriteOnly === 'true' || favoriteOnly === true) listOpts.favoriteOnly = true;

    const result = await engine.listFiles(listOpts);
    let items = result.items || [];
    let hasMore = !!result.hasMore;
    if (!hasMore && items.length > limit) {
      hasMore = true;
      items.pop();
    }
    void view;

    const lastItem = items[items.length - 1];
    let nextCursor = null;
    if (lastItem) {
      if (sortBy === 'created_at') {
        if (sortOrder === 'desc') {
          nextCursor = `${lastItem.created_at}_${lastItem.id}`;
        } else {
          nextCursor = JSON.stringify({ v: lastItem.created_at, id: lastItem.id });
        }
      } else if (sortBy === 'mtime') {
        nextCursor = JSON.stringify({ v: lastItem.mtime, id: lastItem.id });
      } else if (sortBy === 'name') {
        nextCursor = JSON.stringify({ v: lastItem.name, id: lastItem.id });
      } else if (sortBy === 'size') {
        nextCursor = JSON.stringify({ v: lastItem.size, id: lastItem.id });
      } else {
        nextCursor = `${lastItem.created_at}_${lastItem.id}`;
      }
    }

    const firstItem = items[0];
    let prevCursor = null;
    if (firstItem && sortBy === 'created_at' && sortOrder === 'desc') {
      prevCursor = `${firstItem.created_at}_${firstItem.id}`;
    }

    const shapedItems = items.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      ext: item.ext,
      size: item.size,
      mtime: item.mtime,
      created_at: item.created_at,
      has_thumb: item.has_thumb,
      dir_path: item.dir_path,
      duration: item.duration || 0,
      bitrate: item.duration > 0 ? Math.round(item.size / item.duration) : 0,
      uploaded_at: item.uploaded_at || null,
      is_favorite: item.is_favorite || 0,
    }));

    let previewsByFolder = {};
    if (folders.length > 0) {
      const previewEntries = await Promise.all(
        folders.map(async (f) => {
          try {
            const previews = await engine.getPreviewFilesForFolder(f.id, 4);
            return [f.id, previews.map((p) => ({ id: p.id, name: p.name, type: p.type, has_thumb: p.has_thumb }))];
          } catch {
            return [f.id, []];
          }
        })
      );
      for (const [fid, prevs] of previewEntries) {
        previewsByFolder[fid] = prevs;
      }
    }

    if (shapedItems.length > 0) {
      const pregenLimit = Math.min(shapedItems.length, 2);
      for (let i = 0; i < pregenLimit; i++) {
        const item = shapedItems[i];
        if (item.has_thumb || item.type === 'video') continue;
        try {
const resolved = await resolveFileForEngine(item.id, engine.repository, engine.mediaRoots);
           if (resolved && !resolved.blocked && resolved.fullPath) {
             ensureThumbnailForFile(resolved).catch(() => {});
           }
        } catch {}
      }
    }

    console.timeEnd('[files] API request');
    const folderFileCount = folder.fileCount ?? folder.file_count ?? 0;
    const folderTotalSize = folder.totalSize ?? folder.total_size ?? 0;
    res.json({
      items: shapedItems,
      folders: folders.map((f) => ({
        id: f.id,
        path: f.path,
        name: f.path.split('/').pop(),
        type: 'folder',
        file_count: f.file_count ?? f.fileCount ?? 0,
        total_size: f.total_size ?? f.totalSize ?? 0,
        subfolder_count: f.subfolder_count ?? f.subfolderCount ?? 0,
        previews: previewsByFolder[f.id] || [],
      })),
      current_folder: {
        id: folder.id,
        path: folder.path,
        name: folder.path.split('/').pop(),
        type: 'folder',
        file_count: folderFileCount,
        total_size: folderTotalSize,
      },
      next_cursor: nextCursor,
      prev_cursor: prevCursor,
      has_more: hasMore,
      total_count: folderFileCount,
    });
  } catch (err) {
    console.error('[files] Error:', err);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

const SHUFFLE_LIMIT = 50000;

router.get('/shuffle', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || SHUFFLE_LIMIT, 100000);
    const folderId = req.query.folder_id ? parseInt(req.query.folder_id, 10) : null;
    const seed = req.query.seed ? parseInt(req.query.seed, 10) : Math.floor(Math.random() * 4294967296);

    let items;
    if (folderId) {
      const { getShuffledFiles } = await import('../utils/deterministicShuffle.js');
      items = await getShuffledFiles(folderId, seed, limit);
    } else {
      const result = await engine.listFiles({ limit, sortBy: 'created_at', sortOrder: 'desc' });
      const ids = (result.items || []).map((r) => r.id);
      const { deterministicShuffle } = await import('../utils/deterministicShuffle.js');
      const shuffled = deterministicShuffle(ids, seed);
      const batch = await engine.getBatchFiles(shuffled);
      items = batch.items || batch || [];
      if (Array.isArray(batch) && !batch.items) items = batch;
    }

    const shapedItems = items.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      ext: item.ext,
      size: item.size,
      mtime: item.mtime,
      created_at: item.created_at,
      uploaded_at: item.uploaded_at || null,
      has_thumb: item.has_thumb,
      dir_id: item.dir_id,
      dir_path: item.dir_path,
      duration: item.duration || 0,
      bitrate: item.duration > 0 ? Math.round(item.size / item.duration) : 0,
    }));

    if (shapedItems.length > 0) {
      const pregenLimit = Math.min(shapedItems.length, 4);
      for (let i = 0; i < pregenLimit; i++) {
        const item = shapedItems[i];
        if (item.has_thumb) continue;
        try {
const resolved = await resolveFileForEngine(item.id, engine.repository, engine.mediaRoots);
           if (resolved && !resolved.blocked && resolved.fullPath) {
             ensureThumbnailForFile(resolved).catch(() => {});
           }
        } catch {}
      }
    }

    res.json({ items: shapedItems, has_more: shapedItems.length === limit, seed });
  } catch (err) {
    console.error('[files/shuffle] Error:', err);
    res.status(500).json({ error: 'Failed to fetch shuffle' });
  }
});

router.post('/refresh', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    await globalThis.mediaScanner?.scan();
    const { cleanupOrphanEntries } = await import('../utils/maintenance.js');
    const deleted = cleanupOrphanEntries();
    const stats = await engine.getStats();
    res.json({ message: 'Sync complete', total: stats.totalFiles ?? stats.total ?? 0, deleted });
  } catch (err) {
    console.error('[files/refresh] Error:', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

router.post('/cleanup', async (req, res) => {
  try {
    const { cleanupOrphanEntries } = await import('../utils/maintenance.js');
    const deleted = cleanupOrphanEntries();
    res.json({ message: `Removed ${deleted} orphan entries`, deleted });
  } catch (err) {
    console.error('[files/cleanup] Error:', err);
    res.status(500).json({ error: 'Cleanup failed' });
  }
});

router.get('/stats', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    const stats = await engine.getStats();
    res.json({
      total: stats.totalFiles ?? stats.total ?? 0,
      videos: stats.byType?.video ?? stats.videos ?? 0,
      audio: stats.byType?.audio ?? stats.audio ?? 0,
      images: stats.byType?.image ?? stats.images ?? 0,
    });
  } catch (err) {
    console.error('[files/stats] Error:', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

router.get('/folders/:id', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    const folder = await engine.getFolder(req.params.id);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    res.json({
      id: folder.id,
      path: folder.path,
      parent_id: folder.parentId ?? folder.parent_id ?? null,
      depth: folder.depth,
      file_count: folder.fileCount ?? folder.file_count ?? 0,
      total_size: folder.totalSize ?? folder.total_size ?? 0,
      last_updated: folder.lastUpdated ?? folder.last_updated ?? null,
      recursive_file_count: folder.recursiveFileCount ?? folder.recursive_file_count ?? null,
      recursive_total_size: folder.recursiveTotalSize ?? folder.recursive_total_size ?? null,
    });
  } catch (err) {
    console.error('[folders/:id] Error:', err);
    res.status(500).json({ error: 'Failed to fetch folder' });
  }
});

router.get('/folders/:id/index', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    const folderId = parseInt(req.params.id, 10);
    if (isNaN(folderId)) {
      return res.status(400).json({ error: 'Invalid folder ID' });
    }
    const folder = await engine.getFolder(folderId);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const sortBy = req.query.sortBy || 'created_at';
    const sortOrder = req.query.sortOrder || 'desc';
    const type = req.query.type || null;
    const favoriteOnly = req.query.favoriteOnly;

    const rows = queryIndex(folderId, sortBy, sortOrder, type, favoriteOnly);
    const generation = await engine.getFolderGeneration(folderId);

    const etag = `W/"${folderId}:${generation}:${sortBy}:${sortOrder}:${type || 'all'}:${favoriteOnly ? 'fav' : '0'}"`;
    if ((req.headers['if-none-match'] || '').trim() === etag) {
      res.status(304).end();
      return;
    }

    const buf = Buffer.alloc(rows.length * ID_BYTES);
    for (let i = 0; i < rows.length; i++) {
      Buffer.from(rows[i].id, 'hex').copy(buf, i * ID_BYTES);
    }

    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': buf.length,
      'Cache-Control': 'max-age=5, must-revalidate',
      'ETag': etag,
      'X-Index-Version': String(generation),
      'X-Index-Total': String(rows.length),
    });
    res.send(buf);
  } catch (err) {
    console.error('[folders/:id/index] Error:', err);
    res.status(500).json({ error: 'Failed to fetch index' });
  }
});

router.post('/batch', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    const idsParam = req.body?.ids;
    if (!Array.isArray(idsParam) || idsParam.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    const ids = [...new Set(idsParam)].slice(0, 100);

    const result = await engine.getBatchFiles(ids);
    if (result && result.items && result.missingIds) {
      return res.json(result);
    }
    const items = Array.isArray(result) ? result : (result.items || []);
    const byId = new Map(items.map((it) => [it.id, it]));
    const ordered = ids.filter((id) => byId.has(id)).map((id) => byId.get(id));
    const missingIds = ids.filter((id) => !byId.has(id));
    res.json({ items: ordered, missingIds });
  } catch (err) {
    console.error('[files/batch] Error:', err);
    res.status(500).json({ error: 'Failed to batch fetch' });
  }
});

router.get('/:id/previews', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    const folderId = parseInt(req.params.id, 10);
    if (isNaN(folderId)) {
      return res.status(400).json({ error: 'Invalid folder ID' });
    }
    const previewFiles = await engine.getPreviewFilesForFolder(folderId, 4);
    return res.json(previewFiles.map((f) => ({ id: f.id, type: f.type, has_thumb: f.has_thumb })));
  } catch (err) {
    console.error('[folders/:id/previews] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch folder previews' });
  }
});

router.get('/search', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    const { q, scope = 'all', folder_id, type = 'all', sort = 'name_asc', limit = 100 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.json({ folders: [], files: [], total: 0 });
    }

    const query = q.trim();
    const limitNum = Math.min(parseInt(limit, 10) || 100, 200);
    const folderId = folder_id ? parseInt(folder_id, 10) : null;

    let folders = [];
    let files = [];

    folders = await engine.searchFolders(query, { scope, folderId, limit: limitNum });

    if (type === 'folder') {
      files = [];
    } else {
      files = await engine.searchFiles(query, { type: type === 'all' ? null : type, limit: limitNum, scope, folderId });

      if (sort === 'name_asc') {
        files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      } else if (sort === 'name_desc') {
        files.sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: 'base' }));
      } else if (sort === 'mtime_desc') {
        files.sort((a, b) => b.mtime - a.mtime);
      } else if (sort === 'mtime_asc') {
        files.sort((a, b) => a.mtime - b.mtime);
      } else if (sort === 'size_desc') {
        files.sort((a, b) => b.size - a.size);
      } else if (sort === 'size_asc') {
        files.sort((a, b) => a.size - b.size);
      }
    }

    const shapedFolders = folders.map((f) => ({
      id: f.id,
      path: f.path,
      name: f.path.split('/').pop(),
      type: 'folder',
      file_count: f.file_count ?? f.fileCount ?? 0,
      total_size: f.total_size ?? f.totalSize ?? 0,
      subfolder_count: f.subfolder_count ?? f.subfolderCount ?? 0,
    }));

    const shapedFiles = files.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      ext: f.ext,
      size: f.size,
      mtime: f.mtime,
      created_at: f.created_at ?? f.createdAt ?? 0,
      uploaded_at: f.uploaded_at ?? f.uploadedAt ?? null,
      has_thumb: f.has_thumb ?? f.hasThumb ?? 0,
      dir_path: f.dir_path ?? f.dirPath ?? '',
    }));

    res.json({
      folders: shapedFolders,
      files: shapedFiles,
      total: shapedFolders.length + shapedFiles.length,
    });
  } catch (err) {
    console.error('[search] Error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

router.get('/search/suggest', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.json({ suggestions: [] });
    }

    const suggestions = await engine.getSearchSuggestions(q.trim());

    res.json({ suggestions });
  } catch (err) {
    console.error('[search/suggest] Error:', err);
    res.status(500).json({ error: 'Suggestions failed' });
  }
});

router.patch('/:id/lock', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    const meta = await engine.getFileMetadata(req.params.id);
    if (!meta) return res.status(404).json({ error: 'File not found' });
    const newVal = meta.isLocked ?? meta.is_locked ? 0 : 1;
    await engine.updateMetadata(req.params.id, { isLocked: newVal });
    res.json({ id: req.params.id, is_locked: newVal });
  } catch (err) {
    console.error('[files/lock] Error:', err);
    res.status(500).json({ error: 'Failed to toggle lock' });
  }
});

router.get('/:id/lock', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    const meta = await engine.getFileMetadata(req.params.id);
    if (!meta) return res.status(404).json({ error: 'File not found' });
    res.json({ id: req.params.id, is_locked: meta.isLocked ?? meta.is_locked ? 1 : 0 });
  } catch (err) {
    console.error('[files/lock] Error:', err);
    res.status(500).json({ error: 'Failed to read lock' });
  }
});

router.patch('/:id/favorite', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    const meta = await engine.getFileMetadata(req.params.id);
    if (!meta) return res.status(404).json({ error: 'File not found' });
    const newVal = meta.isFavorite ?? meta.is_favorite ? 0 : 1;
    await engine.updateMetadata(req.params.id, { isFavorite: newVal });
    res.json({ id: req.params.id, is_favorite: newVal });
  } catch (err) {
    console.error('[files/favorite] Error:', err);
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

router.get('/favorites', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    if (engine.listFavorites) {
      const files = await engine.listFavorites();
      return res.json({ files, total: files.length });
    }
    const rows = await engine.listFiles({ favoriteOnly: true, type: 'audio', limit: 10000, sortBy: 'created_at', sortOrder: 'desc' });
    const files = (rows.items || []).map((f) => {
      const name = f.name || '';
      const displayName = name.replace(/\.[^/.]+$/, '') || name;
      return {
        id: f.id,
        file_id: f.id,
        display_name: displayName,
        resolved_path: f.dir_path ? `${f.dir_path}/${name}` : name,
        location: `/file/${f.id}`,
        title: displayName,
        artist: f.artist || '',
        album: f.album || '',
        duration: f.duration || 0,
        track_num: 0,
        exists: true,
        size: f.size || 0,
        mtime: f.mtime || 0,
        created_at: f.created_at || 0,
        type: f.type || 'audio',
        ext: (f.ext || '').replace(/^\./, ''),
        is_favorite: 1,
        has_thumb: f.has_thumb || 0,
      };
    });
    res.json({ files, total: files.length });
  } catch (err) {
    console.error('[files/favorites] Error:', err);
    res.status(500).json({ error: 'Failed to load favorites' });
  }
});

router.get('/:id', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    const meta = await engine.getFileMetadata(req.params.id);
    if (!meta) {
      return res.status(404).json({ error: 'File not found' });
    }
    const size = meta.size ?? 0;
    const duration = meta.duration ?? 0;
    res.json({
      id: meta.id,
      name: meta.name,
      type: meta.type,
      ext: meta.ext,
      size,
      mtime: meta.mtime,
      created_at: meta.createdAt ?? meta.created_at ?? 0,
      uploaded_at: meta.uploadedAt ?? meta.uploaded_at ?? null,
      has_thumb: meta.hasThumb ?? meta.has_thumb ?? 0,
      dir_path: meta.dirPath ?? meta.dir_path ?? '',
      duration,
      title: meta.title ?? null,
      artist: meta.artist ?? null,
      album: meta.album ?? null,
      is_favorite: meta.isFavorite ?? meta.is_favorite ? 1 : 0,
      is_locked: meta.isLocked ?? meta.is_locked ? 1 : 0,
      bitrate: duration > 0 ? Math.round(size / duration) : 0,
    });
  } catch (err) {
    console.error('[files/:id] Error:', err);
    res.status(500).json({ error: 'Failed to fetch file' });
  }
});

router.post('/resolve-batch', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    const { filenames } = req.body;
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ error: 'filenames array required' });
    }
    const results = await engine.resolveBatchFilenames(filenames);
    res.json({ results });
  } catch (err) {
    console.error('[files/resolve-batch] Error:', err);
    res.status(500).json({ error: 'Failed to resolve batch' });
  }
});

router.delete('/:id', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    const resolved = await engine.resolve(req.params.id);
    const meta = await engine.getFileMetadata(req.params.id);
    if (!resolved && !meta) return res.status(404).json({ error: 'File not found' });
    if (resolved?.blocked) return res.status(404).json({ error: 'File not found' });

    const thumbPath = getThumbPath(req.params.id);
    try { unlinkSync(thumbPath); } catch {}

    const fullPath = resolved?.fullPath || (meta?.path);
    if (fullPath) {
      try { unlinkSync(fullPath); } catch (err) {
        console.error('[files/delete] Failed to delete file:', fullPath, err.message);
      }
    }

    const db = globalThis.db || engine.repository?.db;
    if (db) {
      try { db.prepare('DELETE FROM files WHERE id = ?').run(req.params.id); } catch {}
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[files/delete] Error:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

router.post('/batch/lock', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    const { ids, lock } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    if (typeof lock !== 'boolean') {
      return res.status(400).json({ error: 'lock boolean required' });
    }
    let updated = 0;
    for (const id of ids) {
      await engine.updateMetadata(id, { isLocked: lock ? 1 : 0 });
      updated++;
    }
    res.json({ updated });
  } catch (err) {
    console.error('[files/batch/lock] Error:', err);
    res.status(500).json({ error: 'Failed to batch lock' });
  }
});

router.post('/batch/delete', async (req, res) => {
  const engine = globalThis.mediaEngine;
  if (!engine) return res.status(500).json({ error: 'Media engine not initialized' });
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    let deleted = 0;
    const db = globalThis.db || engine.repository?.db;
    for (const id of ids) {
      let resolved = null;
      try { resolved = await engine.resolve(id); } catch {}
      if (!resolved && !(await engine.getFileMetadata(id))) continue;

      const thumbPath = getThumbPath(id);
      try { unlinkSync(thumbPath); } catch {}

      if (resolved?.fullPath) {
        try { unlinkSync(resolved.fullPath); } catch (err) {
          console.error('[files/batch/delete] Failed to delete file:', resolved.fullPath, err.message);
        }
      }

      if (db) {
        try { db.prepare('DELETE FROM files WHERE id = ?').run(id); } catch {}
      }
      deleted++;
    }
    res.json({ deleted });
  } catch (err) {
    console.error('[files/batch/delete] Error:', err);
    res.status(500).json({ error: 'Failed to batch delete' });
  }
});

export default router;
export { THUMBNAIL_DIR };
