import { getVisibility, setVisibility, ensureTables as ensureVisTables, getChanges as getVisChanges } from '@homelab/media-engine/visibility';
import { ensureChangesetTables as ensureCsTables, createChangeset as csCreate, finalizeChangeset as csFinalize, addChangeToChangeset as csAddChange, getChangeset as csGet, listChangesets as csList, detectConflicts as csDetectConflicts, applyChangeset as csApply } from '@homelab/media-engine/changeset';

const SORT_CLAUSE = {
  created_at: { asc: 'f.created_at ASC, f.id ASC', desc: 'f.created_at DESC, f.id DESC' },
  name:       { asc: 'LOWER(f.name) ASC, f.id ASC', desc: 'LOWER(f.name) DESC, f.id DESC' },
  mtime:      { asc: 'f.mtime ASC, f.id ASC',      desc: 'f.mtime DESC, f.id DESC' },
  size:       { asc: 'f.size ASC, f.id ASC',       desc: 'f.size DESC, f.id DESC' },
};

export class SqliteMediaRepository {
  constructor(db, stmts, listsDb, listsStmts) {
    this.db = db;
    this.stmts = stmts;
    this.listsDb = listsDb;
    this.listsStmts = listsStmts;
  }

  query(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  queryOne(sql, params = []) {
    return this.db.prepare(sql).get(...params);
  }

  run(sql, params = []) {
    return this.db.prepare(sql).run(...params);
  }

  transaction(fn) {
    return this.db.transaction(fn)();
  }

  // --- File core ---

  getFileById(id) {
    return this.stmts.getFile.get(id);
  }

  getFileWithPath(id) {
    return this.stmts.getFileWithPath.get(id);
  }

  upsertFile(file) {
    const normalized = {
      id: file.id,
      dir_id: file.dir_id,
      name: file.name,
      type: file.type,
      ext: file.ext ?? null,
      size: file.size ?? 0,
      mtime: file.mtime ?? 0,
      duration: file.duration ?? 0,
      last_verified: file.last_verified ?? 0,
      created_at: file.created_at ?? 0,
      created_at_embedded: file.created_at_embedded ?? null,
      modified_at_fs: file.modified_at_fs ?? null,
      uploaded_at: file.uploaded_at ?? null,
      metadata_source: file.metadata_source ?? null,
      checksum: file.checksum ?? null,
      title: file.title ?? null,
      artist: file.artist ?? null,
      album: file.album ?? null,
      genre: file.genre ?? null,
      lyrics: file.lyrics ?? null,
      lyrics_synced: file.lyrics_synced ?? null,
      lyrics_romaji: file.lyrics_romaji ?? null,
      cover_source: file.cover_source ?? null,
      is_locked: file.is_locked ?? 0,
      uploader_metadata: file.uploader_metadata ?? null,
      has_thumb: file.has_thumb ?? 0,
      is_favorite: file.is_favorite ?? 0,
      thumb_cache_path: file.thumb_cache_path ?? null,
      codec_info: file.codec_info ?? null,
      is_stream_compatible: file.is_stream_compatible ?? 0,
      youtube_id: file.youtube_id ?? null,
      video_offset: file.video_offset ?? 0,
      faststart_state: file.faststart_state ?? null,
    };
    this.stmts.upsertFile.run(normalized);
  }

  deleteFileById(id) {
    this.stmts.deleteFile.run(id);
  }

  // --- Folder core ---

  getFolderById(id) {
    const row = this.stmts.getFolder.get(id);
    if (!row) return null;
    return {
      id: row.id,
      path: row.path,
      parentId: row.parent_id,
      depth: row.depth,
      fileCount: row.file_count,
      totalSize: row.total_size,
      lastUpdated: row.last_updated,
      recursiveFileCount: row.recursive_file_count,
      recursiveTotalSize: row.recursive_total_size,
    };
  }

  getFolderByPath(path) {
    return this.stmts.getFolderByPath.get(path);
  }

  ensureFolder(path) {
    if (!path) {
      this.stmts.upsertFolder.run({
        path: '',
        parent_id: null,
        depth: 0,
        file_count: 0,
        total_size: 0,
        last_scanned: Date.now(),
        last_updated: Date.now(),
      });
      return this.stmts.getFolderByPath.get('').id;
    }

    const lastSlash = path.lastIndexOf('/');
    const parentPath = lastSlash > 0 ? path.substring(0, lastSlash) : '';
    const parentId = this.ensureFolder(parentPath);
    const depth = (this.stmts.getFolderByPath.get(parentPath)?.depth || 0) + 1;

    this.stmts.upsertFolder.run({
      path,
      parent_id: parentId,
      depth,
      file_count: 0,
      total_size: 0,
      last_scanned: Date.now(),
      last_updated: Date.now(),
    });

    return this.stmts.getFolderByPath.get(path).id;
  }

  // --- Folder queries ---

  getFoldersByParent(parentId) {
    return this.stmts.getFoldersByParentDistinct.all(parentId);
  }

  getPreviewFilesForFolder(folderId, limit = 4) {
    return this.stmts.getPreviewFilesForFolder.all(folderId, limit);
  }

  getFolderGeneration(folderId) {
    const row = this.stmts.getFolderGeneration.get(folderId);
    return row?.generation || 0;
  }

  searchFolders(query, limit) {
    return this.stmts.searchFolders.all(`%${query}%`, limit);
  }

  searchFoldersScoped(query, folderId, limit) {
    const likeQuery = `%${query}%`;
    return this.stmts.searchFoldersScoped.all(likeQuery, folderId, folderId, limit);
  }

  // --- Visibility (webId-scoped soft delete) ---

  ensureVisibilityTables() {
    ensureVisTables(this.db);
  }

  getVisibilityState(fileId, webId) {
    return getVisibility(this.db, fileId, webId);
  }

  setVisibilityState(fileId, webId, state, payload = null) {
    return setVisibility(this.db, fileId, webId, state, payload);
  }

  isVisible(fileId, webId) {
    if (!webId) return true;
    return getVisibility(this.db, fileId, webId) === 'PRESENT';
  }

  getChanges(webId, sinceTimestamp = 0) {
    return getVisChanges(this.db, webId, sinceTimestamp);
  }

  // --- Changesets ---

  ensureChangesetTables() {
    ensureCsTables(this.db);
  }

  createChangeset(webId, name, description) {
    return csCreate(this.db, webId, name, description);
  }

  finalizeChangeset(changesetId) {
    return csFinalize(this.db, changesetId);
  }

  addChangeToChangeset(changesetId, changeId) {
    return csAddChange(this.db, changesetId, changeId);
  }

  getChangeset(changesetId) {
    return csGet(this.db, changesetId);
  }

  listChangesets(webId, stateFilter = null) {
    return csList(this.db, webId, stateFilter);
  }

  detectConflicts(changesetId, targetWebId, targetRepository) {
    return csDetectConflicts(this.db, changesetId, targetWebId, targetRepository.db);
  }

  applyChangeset(changesetId, targetWebId, targetRepository) {
    return csApply(this.db, changesetId, targetWebId, targetRepository.db);
  }

  // --- File queries (visibility-joined) ---

  listFiles({ webId, folderId, type, favoriteOnly, sortBy = 'created_at', sortOrder = 'desc', limit = 100, offset = 0, cursor = null, prevCursor = null }) {
    const clauses = ["(mv.state = 'PRESENT' OR mv.state IS NULL)"];
    const params = [webId];
    if (folderId) {
      clauses.push('f.dir_id = ?');
      params.push(folderId);
    }
    if (type && ['video', 'audio', 'image'].includes(type)) {
      clauses.push('f.type = ?');
      params.push(type);
    }
    if (favoriteOnly) {
      clauses.push('EXISTS (SELECT 1 FROM lists.favorites fav WHERE fav.file_id = f.id)');
    }
    const where = clauses.join(' AND ');
    const baseSelect = `SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.duration, f.created_at, f.uploaded_at, f.is_favorite, fo.path as dir_path FROM files f LEFT JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ? LEFT JOIN folders fo ON f.dir_id = fo.id`;

    let sql, queryParams;
    const queryLimit = limit + 1;

    if (prevCursor && sortBy === 'created_at' && sortOrder === 'desc') {
      const [pc, pid] = prevCursor.split('_');
      const pCreatedAt = parseInt(pc, 10) || 0;
      sql = `${baseSelect} WHERE ${where} AND (f.created_at < ? OR (f.created_at = ? AND f.id < ?)) ORDER BY f.created_at DESC, f.id DESC LIMIT ?`;
      queryParams = [...params, pCreatedAt, pCreatedAt, pid, queryLimit];
    } else if (cursor && sortBy === 'created_at' && sortOrder === 'desc') {
      const [cCreatedAt, cId] = cursor.split('_');
      const createdAtNum = parseInt(cCreatedAt, 10) || 0;
      sql = `${baseSelect} WHERE ${where} AND (f.created_at, f.id) < (?, ?) ORDER BY f.created_at DESC, f.id DESC LIMIT ?`;
      queryParams = [...params, createdAtNum, cId, queryLimit];
    } else if (cursor && sortBy === 'created_at' && sortOrder === 'asc') {
      let c;
      try { c = JSON.parse(cursor); } catch { c = null; }
      if (c) {
        sql = `${baseSelect} WHERE ${where} AND (f.created_at > ? OR (f.created_at = ? AND f.id > ?)) ORDER BY f.created_at ASC, f.id ASC LIMIT ?`;
        queryParams = [...params, c.v, c.v, c.id, queryLimit];
      } else {
        sql = `${baseSelect} WHERE ${where} ORDER BY f.created_at ASC, f.id ASC LIMIT ?`;
        queryParams = [...params, queryLimit];
      }
    } else if (cursor && sortBy === 'mtime' && sortOrder === 'desc') {
      let c;
      try { c = JSON.parse(cursor); } catch { c = null; }
      if (c) {
        sql = `${baseSelect} WHERE ${where} AND (f.mtime < ? OR (f.mtime = ? AND f.id > ?)) ORDER BY f.mtime DESC, f.id ASC LIMIT ?`;
        queryParams = [...params, c.v, c.v, c.id, queryLimit];
      } else {
        sql = `${baseSelect} WHERE ${where} ORDER BY f.mtime DESC, f.id ASC LIMIT ?`;
        queryParams = [...params, queryLimit];
      }
    } else if (cursor && sortBy === 'mtime' && sortOrder === 'asc') {
      let c;
      try { c = JSON.parse(cursor); } catch { c = null; }
      if (c) {
        sql = `${baseSelect} WHERE ${where} AND (f.mtime > ? OR (f.mtime = ? AND f.id > ?)) ORDER BY f.mtime ASC, f.id ASC LIMIT ?`;
        queryParams = [...params, c.v, c.v, c.id, queryLimit];
      } else {
        sql = `${baseSelect} WHERE ${where} ORDER BY f.mtime ASC, f.id ASC LIMIT ?`;
        queryParams = [...params, queryLimit];
      }
    } else if (cursor && sortBy === 'name' && sortOrder === 'desc') {
      let c;
      try { c = JSON.parse(cursor); } catch { c = null; }
      if (c) {
        sql = `${baseSelect} WHERE ${where} AND (LOWER(f.name) COLLATE NOCASE < ? OR (LOWER(f.name) COLLATE NOCASE = ? AND f.id > ?)) ORDER BY LOWER(f.name) DESC, f.id ASC LIMIT ?`;
        queryParams = [...params, c.v, c.v, c.id, queryLimit];
      } else {
        sql = `${baseSelect} WHERE ${where} ORDER BY LOWER(f.name) DESC, f.id ASC LIMIT ?`;
        queryParams = [...params, queryLimit];
      }
    } else if (cursor && sortBy === 'name' && sortOrder === 'asc') {
      let c;
      try { c = JSON.parse(cursor); } catch { c = null; }
      if (c) {
        sql = `${baseSelect} WHERE ${where} AND (LOWER(f.name) COLLATE NOCASE > ? OR (LOWER(f.name) COLLATE NOCASE = ? AND f.id > ?)) ORDER BY LOWER(f.name) ASC, f.id ASC LIMIT ?`;
        queryParams = [...params, c.v, c.v, c.id, queryLimit];
      } else {
        sql = `${baseSelect} WHERE ${where} ORDER BY LOWER(f.name) ASC, f.id ASC LIMIT ?`;
        queryParams = [...params, queryLimit];
      }
    } else if (cursor && sortBy === 'size' && sortOrder === 'desc') {
      let c;
      try { c = JSON.parse(cursor); } catch { c = null; }
      if (c) {
        sql = `${baseSelect} WHERE ${where} AND (f.size < ? OR (f.size = ? AND f.id > ?)) ORDER BY f.size DESC, f.id ASC LIMIT ?`;
        queryParams = [...params, c.v, c.v, c.id, queryLimit];
      } else {
        sql = `${baseSelect} WHERE ${where} ORDER BY f.size DESC, f.id ASC LIMIT ?`;
        queryParams = [...params, queryLimit];
      }
    } else if (cursor && sortBy === 'size' && sortOrder === 'asc') {
      let c;
      try { c = JSON.parse(cursor); } catch { c = null; }
      if (c) {
        sql = `${baseSelect} WHERE ${where} AND (f.size > ? OR (f.size = ? AND f.id > ?)) ORDER BY f.size ASC, f.id ASC LIMIT ?`;
        queryParams = [...params, c.v, c.v, c.id, queryLimit];
      } else {
        sql = `${baseSelect} WHERE ${where} ORDER BY f.size ASC, f.id ASC LIMIT ?`;
        queryParams = [...params, queryLimit];
      }
    } else {
      const orderBy = SORT_CLAUSE[sortBy]?.[sortOrder] || SORT_CLAUSE.created_at.desc;
      sql = `${baseSelect} WHERE ${where} ORDER BY ${orderBy} LIMIT ?`;
      queryParams = [...params, queryLimit];
    }

    const items = this.db.prepare(sql).all(...queryParams);
    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    return { items, hasMore, limit, offset };
  }

  searchFiles({ webId, query, type = null, folderId = null, scope = 'all', limit = 50 }) {
    const ftsQuery = query.replace(/['"]/g, '').split(/\s+/).map(w => `"${w}"*`).join(' ');
    let sql, params;

    if (scope === 'current' && folderId) {
      sql = `
        SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.duration, f.created_at, f.uploaded_at, fo.path as dir_path
        FROM files f
        LEFT JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ?
        LEFT JOIN folders fo ON f.dir_id = fo.id
        WHERE f.rowid IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?) AND (mv.state = 'PRESENT' OR mv.state IS NULL) AND f.dir_id = ?
        LIMIT ?
      `;
      params = [webId, ftsQuery, folderId, limit];
    } else {
      sql = `
        SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.duration, f.created_at, f.uploaded_at, fo.path as dir_path
        FROM files f
        LEFT JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ?
        LEFT JOIN folders fo ON f.dir_id = fo.id
        WHERE f.rowid IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?) AND (mv.state = 'PRESENT' OR mv.state IS NULL)
        LIMIT ?
      `;
      params = [webId, ftsQuery, limit];
    }

    let results = this.db.prepare(sql).all(...params);
    if (type && type !== 'all') {
      results = results.filter(f => f.type === type);
    }
    return results;
  }

  getFileMetadata(fileId, webId) {
    const row = this.db.prepare(`
      SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.duration, f.has_thumb,
             f.created_at, f.uploaded_at, f.is_favorite, f.is_locked, f.codec_info,
             f.title, f.artist, f.album, f.genre, f.lyrics, f.lyrics_synced, f.lyrics_romaji, f.cover_source,
             f.youtube_id, f.video_offset,
             fo.path as dir_path,
             mv.state as visibility
      FROM files f
      LEFT JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ?
      LEFT JOIN folders fo ON f.dir_id = fo.id
      WHERE f.id = ?
    `).get(webId, fileId);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      path: row.dir_path ? `${row.dir_path}/${row.name}` : row.name,
      dirPath: row.dir_path || '',
      dir_path: row.dir_path || '',
      type: row.type,
      ext: row.ext,
      size: row.size,
      mtime: row.mtime,
      duration: row.duration || 0,
      hasThumb: !!row.has_thumb,
      createdAt: row.created_at,
      uploadedAt: row.uploaded_at,
      isFavorite: !!row.is_favorite,
      isLocked: !!row.is_locked,
      codecInfo: row.codec_info,
      title: row.title,
      artist: row.artist,
      album: row.album,
      genre: row.genre,
      lyrics: row.lyrics,
      lyricsSynced: row.lyrics_synced,
      lyrics_synced: row.lyrics_synced,
      lyrics_romaji: row.lyrics_romaji,
      lyricsRomaji: row.lyrics_romaji,
      coverSource: row.cover_source,
      cover_source: row.cover_source,
      youtube_id: row.youtube_id,
      youtubeId: row.youtube_id,
      video_offset: row.video_offset,
      videoOffset: row.video_offset,
      visibility: row.visibility || 'PRESENT',
    };
  }

  updateMetadata(fileId, updates = {}) {
    const whitelist = {
      isFavorite: 'is_favorite',
      isLocked: 'is_locked',
      title: 'title',
      artist: 'artist',
      album: 'album',
      genre: 'genre',
      cover_source: 'cover_source',
      lyrics: 'lyrics',
      lyrics_synced: 'lyrics_synced',
      lyrics_romaji: 'lyrics_romaji',
      youtube_id: 'youtube_id',
      video_offset: 'video_offset',
    };
    const sets = [];
    const params = [];
    for (const [key, col] of Object.entries(whitelist)) {
      if (key in updates && updates[key] !== undefined) {
        const val = updates[key];
        if (key === 'isFavorite' || key === 'isLocked') {
          sets.push(`${col} = ?`);
          params.push(val ? 1 : 0);
        } else {
          sets.push(`${col} = ?`);
          params.push(val);
        }
      }
    }
    // Legacy shape: { isFavorite, isLocked } — keep compat
    if ('is_favorite' in updates && !('isFavorite' in updates)) {
      sets.push('is_favorite = ?');
      params.push(updates.is_favorite ? 1 : 0);
    }
    if ('is_locked' in updates && !('isLocked' in updates)) {
      sets.push('is_locked = ?');
      params.push(updates.is_locked ? 1 : 0);
    }
    // Reject unknown fields
    const knownKeys = new Set([...Object.keys(whitelist), 'is_favorite', 'is_locked']);
    for (const k of Object.keys(updates)) {
      if (!knownKeys.has(k)) {
        throw new Error(`Unknown metadata field: ${k}`);
      }
    }
    if (sets.length === 0) return { ok: true };
    params.push(fileId);
    this.db.prepare(`UPDATE files SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    if (updates.isFavorite !== undefined || updates.is_favorite !== undefined) {
      const favVal = updates.isFavorite !== undefined ? updates.isFavorite : updates.is_favorite;
      if (favVal) {
        this.listsDb.prepare('INSERT OR IGNORE INTO favorites (file_id, created_at) VALUES (?, ?)').run(fileId, Date.now());
      } else {
        this.listsDb.prepare('DELETE FROM favorites WHERE file_id = ?').run(fileId);
      }
    }
    return { ok: true };
  }

  getStats(webId) {
    const totalRow = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM files f
      LEFT JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ?
      WHERE mv.state = 'PRESENT' OR mv.state IS NULL
    `).get(webId);
    const byType = this.db.prepare(`
      SELECT f.type, COUNT(*) as count
      FROM files f
      LEFT JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ?
      WHERE mv.state = 'PRESENT' OR mv.state IS NULL
      GROUP BY f.type
    `).all(webId);
    return {
      totalFiles: totalRow?.cnt || 0,
      byType: byType.reduce((acc, row) => { acc[row.type] = row.count; return acc; }, {}),
    };
  }

  getBatchFiles(ids, webId) {
    const uniqueIds = [...new Set(ids)].slice(0, 100);
    const rows = this.db.prepare(`
      SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.duration,
             f.created_at, f.uploaded_at, f.is_favorite, f.dir_id, fo.path as dir_path
      FROM files f
      LEFT JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ?
      LEFT JOIN folders fo ON f.dir_id = fo.id
      WHERE f.id IN (SELECT json_each.value FROM json_each(?)) AND (mv.state = 'PRESENT' OR mv.state IS NULL)
    `).all(webId, JSON.stringify(uniqueIds));
    const byId = new Map();
    for (const item of rows) {
      byId.set(item.id, {
        id: item.id,
        name: item.name,
        type: item.type,
        ext: item.ext,
        size: item.size,
        mtime: item.mtime,
        created_at: item.created_at,
        has_thumb: item.has_thumb,
        duration: item.duration || 0,
        bitrate: item.duration > 0 ? Math.round(item.size / item.duration) : 0,
        uploaded_at: item.uploaded_at || null,
        is_favorite: item.is_favorite || 0,
        dir_path: item.dir_path,
      });
    }
    return {
      items: uniqueIds.filter(id => byId.has(id)).map(id => byId.get(id)),
      missingIds: uniqueIds.filter(id => !byId.has(id)),
    };
  }

  resolveBatchFilenames(filenames) {
    const unique = [...new Set(filenames)];
    const placeholders = unique.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT id, name FROM files WHERE name IN (${placeholders})`).all(...unique);
    const results = {};
    for (const row of rows) {
      results[row.name] = row.id;
    }
    return results;
  }

  getSearchSuggestions(query, webId) {
    const q = `%${query.trim()}%`;
    const suggestions = this.db.prepare(`
      SELECT DISTINCT f.name FROM files f
      LEFT JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ?
      WHERE f.name LIKE ? AND (mv.state = 'PRESENT' OR mv.state IS NULL)
      ORDER BY f.name
      LIMIT 10
    `).all(webId, q);
    return suggestions.map(s => s.name);
  }

  listFavorites(webId) {
    const rows = this.db.prepare(`
      SELECT f.id, f.name, f.ext, f.size, f.mtime, f.type, f.duration, f.created_at,
             f.has_thumb, f.title, f.artist, f.album
      FROM files f
      LEFT JOIN media_visibility mv ON f.id = mv.file_id AND mv.web_id = ?
      WHERE (mv.state = 'PRESENT' OR mv.state IS NULL) AND f.is_favorite = 1 AND f.type = 'audio'
      ORDER BY f.created_at DESC
    `).all(webId);
    return rows.map((f) => {
      const name = f.name || '';
      const displayName = name.replace(/\.[^/.]+$/, '') || name;
      return {
        id: f.id,
        file_id: f.id,
        display_name: displayName,
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
  }

  // --- Aggregation (scanner, monitor) ---

  countByType() {
    return this.stmts.countFilesByType.all();
  }

  findByDirPattern(folderName, subfolderPattern, limit, offset) {
    return this.db.prepare(`
      SELECT id, size, mtime, dir_id, duration, checksum
      FROM files
      WHERE dir_id IN (SELECT id FROM folders WHERE path = ? OR path LIKE ?)
      LIMIT ? OFFSET ?
    `).all(folderName, subfolderPattern, limit, offset);
  }

  updateFolderSize(dirId, delta, now) {
    this.db.prepare('UPDATE folders SET total_size = MAX(0, total_size + ?), last_updated = ? WHERE id = ?').run(delta, now, dirId);
  }

  incrementFolderSize(dirId, size, now) {
    this.stmts.deltaIncrementFolder.run(size, now, dirId);
  }

  decrementFolderSize(dirId, size, now) {
    this.db.prepare('UPDATE folders SET total_size = MAX(0, total_size - ?), last_updated = ? WHERE id = ?').run(size, now, dirId);
  }

  updateCreatedAt(id, createdAt) {
    this.db.prepare('UPDATE files SET created_at = ? WHERE id = ?').run(createdAt, id);
  }

  deleteFilesByFolder(dirId) {
    this.db.prepare('DELETE FROM files WHERE dir_id = ?').run(dirId);
  }

  deleteFolder(id) {
    this.db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  }

  getAllFolders() {
    return this.db.prepare('SELECT id, path FROM folders WHERE id > 1').all();
  }

  reconcileFolders() {
    const remainingFolders = this.db.prepare('SELECT id FROM folders').all();
    for (const folder of remainingFolders) {
      this.stmts.reconcileFolder.run(folder.id);
    }
  }

  updateAllRecursiveCounts() {
    const stats = this.db.prepare(`
      WITH RECURSIVE descendants(folder_id, descendant_id) AS (
        SELECT id, id FROM folders
        UNION ALL
        SELECT d.folder_id, f.id FROM folders f JOIN descendants d ON f.parent_id = d.descendant_id
      )
      SELECT d.folder_id as id, 
             COUNT(*) as file_count, 
             COALESCE(SUM(size), 0) as total_size
      FROM files
      JOIN descendants d ON files.dir_id = d.descendant_id
      GROUP BY d.folder_id
    `).all();

    const update = this.db.prepare('UPDATE folders SET recursive_file_count = ?, recursive_total_size = ? WHERE id = ?');
    const tx = this.db.transaction((stats) => {
      this.db.prepare('UPDATE folders SET recursive_file_count = NULL, recursive_total_size = NULL').run();
      for (const row of stats) {
        update.run(row.file_count, row.total_size, row.id);
      }
    });
    tx(stats);
    console.log(`[db] Updated recursive counts for ${stats.length} folders`);
    return stats.length;
  }

  getFilesNeedingDuration(limit) {
    return this.db.prepare(`
      SELECT f.id, d.path, f.name, f.type, f.codec_info
      FROM files f
      JOIN folders d ON f.dir_id = d.id
      WHERE (f.duration = 0 OR f.codec_info IS NULL)
        AND f.type IN ('video', 'audio')
      LIMIT ?
    `).all(limit);
  }

  updateDuration(id, duration) {
    this.db.prepare('UPDATE files SET duration = ? WHERE id = ?').run(duration, id);
  }

  updateCodecInfo(id, codecInfo, isStreamCompatible) {
    this.stmts.updateCodecInfo.run(codecInfo, isStreamCompatible, id);
  }

  updatePlaylistTrackDurationByPath(duration, fullPath) {
    this.stmts.updatePlaylistTrackDurationByPath.run(duration, fullPath);
  }

  refreshPlaylistTrackDurations() {
    this.stmts.refreshPlaylistTrackDurations.run();
  }

  recomputeAllPlaylistTotals() {
    this.stmts.recomputeAllPlaylistTotals.run();
  }

  getFilesNeedingMetadata(limit) {
    return this.db.prepare(`
      SELECT f.id, d.path, f.name, f.type
      FROM files f
      JOIN folders d ON f.dir_id = d.id
      WHERE f.created_at_embedded IS NULL
        AND f.type IN ('image','video','audio')
      LIMIT ?
    `).all(limit);
  }

  updateCreatedAtEmbedded(id, createdAt, source) {
    this.db.prepare('UPDATE files SET created_at_embedded = ?, metadata_source = ? WHERE id = ?').run(createdAt, source, id);
  }
}
