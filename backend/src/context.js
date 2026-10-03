import { musicDb, musicStmts, listsDb, listsStmts, setupMusicFTS, deferredDbInit } from './db.js';
import { SqliteMediaRepository } from './repository/sqliteMediaRepository.js';
import { MediaScanner, MediaEngine, getFileId, getRelPath } from '@homelab/media-engine';
import { PATHS } from './config/paths.js';
import { buildThumbCache } from './utils/thumbnailQueue.js';
import { recordMemoryUsage } from './utils/resourceManager.js';
import { broadcastStats, broadcastFolderUpdate } from './utils/sseManager.js';
import { get } from './utils/runtimeSettings.js';

export const MEDIA_ROOT = [
  process.env.MEDIA_ROOT || '/home/CATIAA/Music'
].flatMap(r => r.split(':'))
.map(r => r.trim())
.filter(Boolean);

export const MUSIC_ROOT = [
  process.env.MUSIC_ROOT || '/home/CATIAA/Music'
].flatMap(r => r.split(':'))
.map(r => r.trim())
.filter(Boolean);

export const SCAN_ROOTS = [...new Set([...MEDIA_ROOT, ...MUSIC_ROOT])];

export const mediaRepository = new SqliteMediaRepository(musicDb, musicStmts, listsDb, listsStmts);
export const mediaEngine = new MediaEngine({
  repository: mediaRepository,
  mediaRoots: SCAN_ROOTS,
  webId: process.env.MEDIA_WEB_ID || 'default',
  thumbnailDir: PATHS.thumbnails,
  thumbnailConfig: {
    concurrency: get('thumb.concurrent', 4) || 4,
  }
});

export const mediaScanner = new MediaScanner({
  repository: mediaRepository,
  mediaRoots: MUSIC_ROOT,
  callbacks: {
    onFileDeleted: () => {},
    getBatchSize: () => Math.max(100, (get('scan.workers', 4) || 4) * 250),
    shouldCompareByHash: () => get('scan.compareByHash', false),
    recordMemoryUsage,
    broadcastStats,
    broadcastFolderUpdate,
  },
  config: {
    workers: get('scan.workers', 4) || 4,
    compareByHash: get('scan.compareByHash', false),
  },
});

mediaScanner.events.on('file.new', ({ fullPath, type }) => {
  const relPath = getRelPath(fullPath, SCAN_ROOTS);
  const fileId = getFileId(relPath);
  mediaEngine.enqueueThumbnail(fileId, fullPath, type);
});
mediaScanner.events.on('file.updated', ({ fullPath, type }) => {
  const relPath = getRelPath(fullPath, SCAN_ROOTS);
  const fileId = getFileId(relPath);
  mediaEngine.enqueueThumbnail(fileId, fullPath, type);
});

setupMusicFTS();
deferredDbInit();

export { musicDb as db, musicStmts, PATHS };
export const THUMBNAIL_DIR = PATHS.thumbnails;
