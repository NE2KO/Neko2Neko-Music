import { musicEngine, playlistEngine, videoCacheEngine, thumbCacheEngine, listsEngine, startDbGateway } from './gateway/db/index.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

let started = false;
let startPromise = null;

export async function deferredDbInit() {
  if (started) return;
  if (!startPromise) {
    startPromise = startDbGateway().then(() => {
      started = true;
      console.log('[db] Deferred init complete');
    }).catch(err => {
      startPromise = null;
      throw err;
    });
  }
  return startPromise;
}

deferredDbInit().catch(() => {});

export function setupMusicFTS() {
  return new Promise((resolve) => {
    const workerPath = join(__dirname, 'fts-rebuild-worker.mjs');
    const child = fork(workerPath, [`/home/CATIAA/WEB/db/Music/music.db`], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], timeout: 120000 });
    child.stderr?.on('data', () => {});
    child.on('message', (msg) => {
      if (msg.type === 'done') resolve();
      else resolve();
    });
    child.on('error', () => resolve());
    child.on('exit', () => resolve());
  });
}

const musicDb = musicEngine;
const playlistDb = playlistEngine;
const videoCacheDb = videoCacheEngine;
const thumbCacheDb = thumbCacheEngine;
const listsDb = listsEngine;

const musicStmts = {
  upsertFile: {
    run: (data) => musicDb.run(`
      INSERT INTO files (id, dir_id, name, type, ext, size, mtime, duration, last_verified, created_at, created_at_embedded, modified_at_fs, uploaded_at, metadata_source, checksum, title, artist, album, genre, lyrics, lyrics_synced, lyrics_romaji, cover_source, is_locked, uploader_metadata, has_thumb, thumb_cache_path, is_favorite, codec_info, is_stream_compatible, youtube_id, video_offset, faststart_state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        dir_id = excluded.dir_id, name = excluded.name, type = excluded.type, ext = excluded.ext,
        size = excluded.size, mtime = excluded.mtime, duration = excluded.duration,
        last_verified = excluded.last_verified,
        created_at_embedded = COALESCE(excluded.created_at_embedded, files.created_at_embedded),
        modified_at_fs = COALESCE(excluded.modified_at_fs, files.modified_at_fs),
        uploaded_at = COALESCE(excluded.uploaded_at, files.uploaded_at),
        metadata_source = COALESCE(excluded.metadata_source, files.metadata_source),
        checksum = COALESCE(excluded.checksum, files.checksum),
        title = excluded.title, artist = excluded.artist, album = excluded.album, genre = excluded.genre,
        lyrics = excluded.lyrics, lyrics_synced = excluded.lyrics_synced, lyrics_romaji = excluded.lyrics_romaji,
        cover_source = excluded.cover_source, is_locked = excluded.is_locked, uploader_metadata = excluded.uploader_metadata,
        has_thumb = excluded.has_thumb, thumb_cache_path = excluded.thumb_cache_path, is_favorite = excluded.is_favorite,
        codec_info = excluded.codec_info, is_stream_compatible = excluded.is_stream_compatible,
        youtube_id = excluded.youtube_id, video_offset = excluded.video_offset, faststart_state = excluded.faststart_state
    `, [
      data.id, data.dir_id, data.name, data.type, data.ext, data.size, data.mtime, data.duration || 0,
      data.last_verified || 0, data.created_at || 0, data.created_at_embedded || null,
      data.modified_at_fs || null, data.uploaded_at || null, data.metadata_source || null,
      data.checksum || null, data.title || null, data.artist || null, data.album || null,
      data.genre || null, data.lyrics || null, data.lyrics_synced || null, data.lyrics_romaji || null,
      data.cover_source || null, data.is_locked || 0, data.uploader_metadata || null,
      data.has_thumb ?? 0, data.thumb_cache_path || null, data.is_favorite ?? 0,
      data.codec_info || null, data.is_stream_compatible ?? 0, data.youtube_id || null,
      data.video_offset || 0, data.faststart_state ?? null
    ]),
  },
  getFile: { get: (id) => musicDb.get('SELECT * FROM files WHERE id = ?', [id]) },
  deleteFile: { run: (id) => musicDb.run('DELETE FROM files WHERE id = ?', [id]) },
  updateThumbStatus: { run: (id) => musicDb.run('UPDATE files SET has_thumb = 1 WHERE id = ?', [id]) },
  skipThumbStatus: { run: (id) => musicDb.run('UPDATE files SET has_thumb = 2 WHERE id = ?', [id]) },
  updateThumbCachePath: { run: (path, id) => musicDb.run('UPDATE files SET thumb_cache_path = ? WHERE id = ?', [path, id]) },
  updateLastAccessed: { run: (ts, id) => musicDb.run('UPDATE files SET last_verified = ? WHERE id = ?', [ts, id]) },
  updateCodecInfo: { run: (info, compatible, id) => musicDb.run('UPDATE files SET codec_info = ?, is_stream_compatible = ? WHERE id = ?', [info, compatible, id]) },
  updateFaststartState: { run: (state, id) => musicDb.run('UPDATE files SET faststart_state = ? WHERE id = ?', [state, id]) },
  getCodecInfo: { get: (id) => musicDb.get('SELECT codec_info, is_stream_compatible FROM files WHERE id = ?', [id]) },
  reconcileFolder: { run: (id) => musicDb.run('UPDATE folders SET file_count = (SELECT COUNT(*) FROM files WHERE dir_id = folders.id), total_size = (SELECT COALESCE(SUM(size), 0) FROM files WHERE dir_id = folders.id) WHERE id = ?', [id]) },
  getFolder: { get: (id) => musicDb.get('SELECT * FROM folders WHERE id = ?', [id]) },
  getFolderGeneration: { get: (folderId) => musicDb.get('SELECT generation FROM folder_generation WHERE folder_id = ?', [folderId]) },
  deltaIncrementFolder: { run: (size, ts, id) => musicDb.run('UPDATE folders SET file_count = file_count + 1, total_size = total_size + ?, last_updated = ? WHERE id = ?', [size, ts, id]) },
  deltaDecrementFolder: { run: (size, ts, id) => musicDb.run('UPDATE folders SET file_count = MAX(0, file_count - 1), total_size = MAX(0, total_size - ?), last_updated = ? WHERE id = ?', [size, ts, id]) },
  countFilesByType: { all: () => musicDb.query('SELECT type, COUNT(*) as count FROM files GROUP BY type') },
  countTotalFiles: { get: () => musicDb.get('SELECT COUNT(*) as total FROM files') },
  upsertFolder: {
    run: (data) => musicDb.run(`
      INSERT INTO folders (path, parent_id, depth, file_count, total_size, last_scanned, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        parent_id = excluded.parent_id,
        depth = excluded.depth,
        last_scanned = excluded.last_scanned,
        last_updated = excluded.last_updated
    `, [data.path, data.parent_id, data.depth, data.file_count, data.total_size, data.last_scanned, data.last_updated])
  },
  getFolderByPath: { get: (path) => musicDb.get('SELECT * FROM folders WHERE path = ?', [path]) },
  getFoldersByParent: { all: (parentId) => musicDb.query('SELECT id, path, COALESCE(recursive_file_count, file_count) as file_count, COALESCE(recursive_total_size, total_size) as total_size, last_updated, (SELECT COUNT(*) FROM folders sub WHERE sub.parent_id = folders.id) as subfolder_count FROM folders WHERE parent_id = ? ORDER BY path ASC', [parentId]) },
  getFoldersByParentDistinct: { all: (parentId) => musicDb.query(`SELECT MIN(id) as id, path, COALESCE(MAX(recursive_file_count), MAX(file_count)) as file_count, COALESCE(MAX(recursive_total_size), MAX(total_size)) as total_size, MAX(last_updated) as last_updated, (SELECT COUNT(*) FROM folders sub WHERE sub.parent_id = folders.id) as subfolder_count FROM folders WHERE parent_id = ? GROUP BY path ORDER BY path ASC`, [parentId]) },
  getPreviewFilesForFolder: { all: (folderId, limit) => musicDb.query('SELECT id, name, type, ext, has_thumb FROM files WHERE dir_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', [folderId, limit]) },
  searchFolders: { all: (query, limit) => musicDb.query("SELECT id, path, path as name, 'folder' as type, COALESCE(recursive_file_count, file_count) as file_count, COALESCE(recursive_total_size, total_size) as total_size, (SELECT COUNT(*) FROM folders sub WHERE sub.parent_id = folders.id) as subfolder_count FROM folders WHERE path LIKE ? ORDER BY path LIMIT ?", [`%${query}%`, limit]) },
  searchFoldersScoped: { all: (query, folderId, limit) => musicDb.query("SELECT id, path, path as name, 'folder' as type, COALESCE(recursive_file_count, file_count) as file_count, COALESCE(recursive_total_size, total_size) as total_size, (SELECT COUNT(*) FROM folders sub WHERE sub.parent_id = folders.id) as subfolder_count FROM folders WHERE path LIKE ? AND (id = ? OR parent_id = ?) ORDER BY path LIMIT ?", [`%${query}%`, folderId, folderId, limit]) },
  getFileWithPath: { get: (id) => musicDb.get(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.duration, f.has_thumb, f.thumb_cache_path, f.uploaded_at, f.is_favorite,
           f.title, f.artist, f.album, f.genre, f.lyrics, f.lyrics_synced, f.cover_source, f.youtube_id, f.video_offset, f.codec_info, f.is_stream_compatible, f.faststart_state,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.id = ?
  `, [id]) },
};

const playlistStmts = {
  getPlaylistByPath: { get: (path) => playlistDb.get('SELECT * FROM playlists WHERE path = ?', [path]) },
  getPlaylistById: { get: (id) => playlistDb.get('SELECT * FROM playlists WHERE id = ?', [id]) },
  getAllPlaylists: { all: () => playlistDb.query('SELECT * FROM playlists WHERE deleted_at IS NULL ORDER BY title ASC') },
  getAllPlaylistsIncludingDeleted: { all: () => playlistDb.query('SELECT * FROM playlists ORDER BY title ASC') },
  softDeletePlaylist: { run: (ts, id) => playlistDb.run('UPDATE playlists SET deleted_at = ? WHERE id = ?', [ts, id]) },
  restorePlaylist: { run: (id) => playlistDb.run('UPDATE playlists SET deleted_at = NULL WHERE id = ?', [id]) },
  upsertPlaylist: { run: (data) => playlistDb.run(`
    INSERT INTO playlists (path, title, creator, annotation, info, image, track_count, total_duration, total_size, available_tracks, missing_tracks, last_scanned, last_updated, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      title = excluded.title, creator = excluded.creator, annotation = excluded.annotation,
      info = excluded.info, image = excluded.image, track_count = excluded.track_count,
      total_duration = excluded.total_duration, total_size = excluded.total_size,
      available_tracks = excluded.available_tracks, missing_tracks = excluded.missing_tracks,
      last_scanned = excluded.last_scanned, last_updated = excluded.last_updated
  `, [data.path, data.title, data.creator, data.annotation, data.info, data.image, data.track_count, data.total_duration, data.total_size, data.available_tracks, data.missing_tracks, data.last_scanned, data.last_updated, data.created_at]) },
  deletePlaylist: { run: (id) => playlistDb.run('DELETE FROM playlists WHERE id = ?', [id]) },
  deletePlaylistTracks: { run: (id) => playlistDb.run('DELETE FROM playlist_tracks WHERE playlist_id = ?', [id]) },
  insertPlaylistTrack: { run: (playlist_id, track_index, location, resolved_path, title, artist, album, duration, artwork, track_num, file_exists, file_size, file_mtime) =>
    playlistDb.run('INSERT INTO playlist_tracks (playlist_id, track_index, location, resolved_path, title, artist, album, duration, artwork, track_num, file_exists, file_size, file_mtime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [playlist_id, track_index, location, resolved_path, title, artist, album, duration, artwork, track_num, file_exists, file_size, file_mtime]) },
  getPlaylistTracks: { all: (playlist_id) => playlistDb.query('SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY track_index ASC', [playlist_id]) },
  getPlaylistIdByPath: { get: (path) => playlistDb.get('SELECT id FROM playlists WHERE path = ?', [path]) },
  getMaxTrackIndex: { get: (playlist_id) => playlistDb.get('SELECT MAX(track_index) as maxIdx FROM playlist_tracks WHERE playlist_id = ?', [playlist_id]) },
  getPlaylistTrackPaths: { all: (playlist_id) => playlistDb.query('SELECT resolved_path FROM playlist_tracks WHERE playlist_id = ?', [playlist_id]) },
  getPlaylistTrackStats: { get: (playlist_id) => playlistDb.get('SELECT COUNT(*) as cnt, COALESCE(SUM(duration),0) as dur, COALESCE(SUM(file_size),0) as sz FROM playlist_tracks WHERE playlist_id = ?', [playlist_id]) },
  updatePlaylistStats: { run: (track_count, total_duration, total_size, available_tracks, last_updated, id) =>
    playlistDb.run('UPDATE playlists SET track_count = ?, total_duration = ?, total_size = ?, available_tracks = ?, last_updated = ? WHERE id = ?',
      [track_count, total_duration, total_size, available_tracks, last_updated, id]) },
  getPlaylistTrack: { get: (id, playlist_id) => playlistDb.get('SELECT * FROM playlist_tracks WHERE id = ? AND playlist_id = ?', [id, playlist_id]) },
  deletePlaylistTrack: { run: (id) => playlistDb.run('DELETE FROM playlist_tracks WHERE id = ?', [id]) },
  getPlaylistTrackIds: { all: (playlist_id) => playlistDb.query('SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY track_index ASC', [playlist_id]) },
  renumberPlaylistTrack: { run: (idx, id) => playlistDb.run('UPDATE playlist_tracks SET track_index = ? WHERE id = ?', [idx, id]) },
  getPlaylistTrackCount: { get: (playlist_id) => playlistDb.get('SELECT COUNT(*) as cnt FROM playlist_tracks WHERE playlist_id = ?', [playlist_id]) },
  getPlaylistTrackStatsSum: { get: (playlist_id) => playlistDb.get('SELECT SUM(duration) as total_duration, SUM(file_size) as total_size FROM playlist_tracks WHERE playlist_id = ?', [playlist_id]) },
  updatePlaylistTrackDurationByPath: { run: (duration, resolved_path) => playlistDb.run('UPDATE playlist_tracks SET duration = ? WHERE resolved_path = ?', [duration, resolved_path]) },
  refreshPlaylistTrackDurations: { run: () => playlistDb.run(`
    UPDATE playlist_tracks SET duration = COALESCE((
      SELECT f.duration FROM files f
      JOIN folders fo ON f.dir_id = fo.id
      WHERE fo.path || '/' || f.name = playlist_tracks.resolved_path
      LIMIT 1
    ), duration)
    WHERE duration = 0 OR duration IS NULL
  `) },
  recomputeAllPlaylistTotals: { run: () => playlistDb.run(`
    UPDATE playlists SET
      total_duration = COALESCE((SELECT SUM(pt.duration) FROM playlist_tracks pt WHERE pt.playlist_id = playlists.id), 0),
      total_size = COALESCE((SELECT SUM(pt.file_size) FROM playlist_tracks pt WHERE pt.playlist_id = playlists.id), 0)
  `) },
  lookupFileByDirPathAndName: { get: (dirPath, fileName) => playlistDb.get(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.duration, f.has_thumb
    FROM files f
    JOIN folders fo ON f.dir_id = fo.id
    WHERE fo.path = ? AND f.name = ?
  `, [dirPath, fileName]) },
};

const videoCacheStmts = {
  getVideo: { get: (youtube_id) => videoCacheDb.get('SELECT * FROM video_cache WHERE youtube_id = ?', [youtube_id]) },
  upsertVideo: { run: (data) => videoCacheDb.run(`
    INSERT INTO video_cache (youtube_id, format, codec, resolution, size, hit_count, is_seekable, source_url, cached_at, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(youtube_id) DO UPDATE SET
      format = excluded.format, codec = excluded.codec, resolution = excluded.resolution,
      size = excluded.size, hit_count = excluded.hit_count + 1,
      is_seekable = excluded.is_seekable, source_url = excluded.source_url,
      cached_at = excluded.cached_at, last_accessed = excluded.last_accessed
  `, [data.youtube_id, data.format, data.codec, data.resolution, data.size, data.hit_count, data.is_seekable, data.source_url, data.cached_at, data.last_accessed]) },
  incrementHit: { run: (ts, youtube_id) => videoCacheDb.run('UPDATE video_cache SET hit_count = hit_count + 1, last_accessed = ? WHERE youtube_id = ?', [ts, youtube_id]) },
  updateSeekable: { run: (seekable, youtube_id) => videoCacheDb.run('UPDATE video_cache SET is_seekable = ? WHERE youtube_id = ?', [seekable, youtube_id]) },
  deleteVideo: { run: (youtube_id) => videoCacheDb.run('DELETE FROM video_cache WHERE youtube_id = ?', [youtube_id]) },
  getAllVideos: { all: () => videoCacheDb.query('SELECT * FROM video_cache ORDER BY last_accessed DESC') },
  getVideosByAccess: { all: (limit) => videoCacheDb.query('SELECT * FROM video_cache ORDER BY last_accessed ASC LIMIT ?', [limit]) },
};

const thumbCacheStmts = {
  getThumb: { get: (file_id, size) => thumbCacheDb.get('SELECT * FROM thumbnail_cache WHERE file_id = ? AND size = ?', [file_id, size]) },
  upsertThumb: { run: (file_id, size, path, generated_at, file_size) => thumbCacheDb.run(`
    INSERT INTO thumbnail_cache (file_id, size, path, generated_at, file_size)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(file_id) DO UPDATE SET path = excluded.path, generated_at = excluded.generated_at, file_size = excluded.file_size
  `, [file_id, size, path, generated_at, file_size]) },
  deleteThumb: { run: (file_id) => thumbCacheDb.run('DELETE FROM thumbnail_cache WHERE file_id = ?', [file_id]) },
  getQueue: { all: (status, limit) => thumbCacheDb.query('SELECT * FROM thumbnail_queue WHERE status = ? ORDER BY priority DESC, created_at ASC LIMIT ?', [status, limit]) },
  upsertQueue: { run: (file_id, status, priority, attempts, last_error, created_at, updated_at) => thumbCacheDb.run(`
    INSERT INTO thumbnail_queue (file_id, status, priority, attempts, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_id) DO UPDATE SET status = excluded.status, priority = excluded.priority,
      attempts = excluded.attempts, last_error = excluded.last_error, updated_at = excluded.updated_at
  `, [file_id, status, priority, attempts, last_error, created_at, updated_at]) },
  updateQueueStatus: { run: (status, updated_at, file_id) => thumbCacheDb.run('UPDATE thumbnail_queue SET status = ?, updated_at = ? WHERE file_id = ?', [status, updated_at, file_id]) },
  deleteQueue: { run: (file_id) => thumbCacheDb.run('DELETE FROM thumbnail_queue WHERE file_id = ?', [file_id]) },
};

const listsStmts = {
  getFavorite: { get: (file_id) => listsDb.get('SELECT * FROM favorites WHERE file_id = ?', [file_id]) },
  addFavorite: { run: (file_id, created_at) => listsDb.run('INSERT OR IGNORE INTO favorites (file_id, created_at) VALUES (?, ?)', [file_id, created_at]) },
  removeFavorite: { run: (file_id) => listsDb.run('DELETE FROM favorites WHERE file_id = ?', [file_id]) },
  getAllFavorites: { all: () => listsDb.query('SELECT file_id FROM favorites ORDER BY created_at DESC') },
  getListeningStats: { get: (trackId) => listsDb.get('SELECT * FROM listening_stats WHERE trackId = ?', [trackId]) },
  upsertListeningStats: { run: (trackId, playCount, listenedSeconds, lastPlayedAt, displayName, updatedAt) => listsDb.run(`
    INSERT OR REPLACE INTO listening_stats (trackId, playCount, listenedSeconds, lastPlayedAt, displayName, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [trackId, playCount, listenedSeconds, lastPlayedAt, displayName, updatedAt]) },
  getListeningSessions: { get: (sessionId) => listsDb.get('SELECT * FROM listening_sessions WHERE sessionId = ?', [sessionId]) },
  upsertListeningSession: { run: (sessionId, trackId, playDelta, listenedDelta, createdAt) => listsDb.run(`
    INSERT OR REPLACE INTO listening_sessions (sessionId, trackId, playDelta, listenedDelta, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `, [sessionId, trackId, playDelta, listenedDelta, createdAt]) },
  getMostPlayed: { all: (limit) => listsDb.query('SELECT * FROM most_played ORDER BY play_count DESC LIMIT ?', [limit]) },
  upsertMostPlayed: { run: (file_id, play_count, last_played_at) => listsDb.run('INSERT OR REPLACE INTO most_played (file_id, play_count, last_played_at) VALUES (?, ?, ?)', [file_id, play_count, last_played_at]) },
  getRecentlyPlayed: { all: (limit) => listsDb.query('SELECT * FROM recently_played ORDER BY played_at DESC LIMIT ?', [limit]) },
  addRecentlyPlayed: { run: (file_id, played_at, session_id) => listsDb.run('INSERT OR IGNORE INTO recently_played (file_id, played_at, session_id) VALUES (?, ?, ?)', [file_id, played_at, session_id]) },
};

export {
  musicDb, playlistDb, videoCacheDb, thumbCacheDb, listsDb,
  musicStmts, playlistStmts, videoCacheStmts, thumbCacheStmts, listsStmts,
};
export default musicDb;
