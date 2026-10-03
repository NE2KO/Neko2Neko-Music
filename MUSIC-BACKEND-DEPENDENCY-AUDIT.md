# Music Backend Dependency Audit — Phase 14.2

**Date:** 2026-09-07  
**Target:** `/home/CATIAA/WEB/Music/backend/`  
**Source of Truth:** `/home/CATIAA/WEB/Music/frontend/src/utils/api.js`

---

## Inventory

### Core Infrastructure [MUSIC]

| File | Classification | Reachable By | Action |
|------|---------------|-------------|--------|
| `src/db.js` | [MUSIC] | All routes via global `db` | KEEP |
| `src/server.js` | [MUSIC] | Entry point | KEEP |
| `src/config/paths.js` | [SHARED-INFRASTRUCTURE] | Multiple routes, utilities | KEEP |
| `src/middleware/serviceGuard.js` | [SHARED-INFRASTRUCTURE] | Routes requiring service guard | MODIFY |
| `src/repository/sqliteMediaRepository.js` | [MUSIC] | `server.js`, media-engine | KEEP |
| `src/services/registry.js` | [MUSIC] | `routes/services.js` | KEEP |
| `src/syncUtils.js` | [MUSIC] | `routes/syncVerify.js` | KEEP |
| `src/fts-rebuild-worker.mjs` | [MUSIC] | `db.js` FTS setup | KEEP |

### Route Files [MUSIC]

| File | Classification | Endpoints | Action |
|------|---------------|-----------|--------|
| `src/routes/files.js` | [MUSIC] | `/api/files`, `/api/files/:id`, `/api/files/batch`, `/api/files/favorites`, `/api/search` | KEEP |
| `src/routes/file.js` | [MUSIC] | `/file/:id` | KEEP |
| `src/routes/thumbnails.js` | [MUSIC] | `/thumbnails/:id.jpg` | KEEP |
| `src/routes/playlists.js` | [MUSIC] | `/api/playlists/*` | KEEP |
| `src/routes/metadata.js` | [MUSIC] | `/api/metadata/*` | KEEP |
| `src/routes/videoCache.js` | [MUSIC] | `/api/video-cache/*` | KEEP |
| `src/routes/listening.js` | [MUSIC] | `/api/listening/*` | KEEP |
| `src/routes/syncVerify.js` | [MUSIC] | `/api/sync-verify/*` | KEEP |
| `src/routes/services.js` | [MUSIC] | `/api/services/*` | MODIFY |
| `src/routes/stream.js` | [MAIN-WEB-ONLY] | `/stream/*` (not used by Music) | REMOVE |

### Utility Files

| File | Classification | Used By | Action |
|------|---------------|---------|--------|
| `src/utils/logger.js` | [MUSIC] | All routes and utilities | KEEP |
| `src/utils/runtimeSettings.js` | [SHARED-INFRASTRUCTURE] | Multiple files | KEEP |
| `src/utils/sseManager.js` | [MUSIC] | `server.js` | KEEP |
| `src/utils/thumbnailQueue.js` | [MUSIC] | `server.js` (onNewFile callback) | KEEP |
| `src/utils/thumbnailUtils.js` | [MUSIC] | `routes/thumbnails.js`, `routes/files.js` | KEEP |
| `src/utils/videoCache.js` | [MUSIC] | `routes/videoCache.js`, `server.js` startup | KEEP |
| `src/utils/playlistScanner.js` | [MUSIC] | `routes/playlists.js`, `server.js` startup | KEEP |
| `src/utils/xspfParser.js` | [MUSIC] | `routes/playlists.js` | KEEP |
| `src/utils/maintenance.js` | [MUSIC] | `server.js` | MODIFY |
| `src/utils/resourceManager.js` | [MUSIC] | `server.js` (scan callbacks) | KEEP |
| `src/utils/youtube.js` | [MUSIC] | `utils/ytdlp.js`, `utils/videoCache.js` | KEEP |
| `src/utils/ytdlp.js` | [MUSIC] | `utils/videoCache.js` | KEEP |
| `src/utils/coverSources.js` | [MUSIC] | `routes/metadata.js` | KEEP |
| `src/utils/lyricsSources.js` | [MUSIC] | `routes/metadata.js` | KEEP |
| `src/utils/musicbrainz.js` | [MUSIC] | `routes/metadata.js` | KEEP |
| `src/utils/lrclib.js` | [MUSIC] | `routes/metadata.js` | KEEP |
| `src/utils/genius.js` | [MUSIC] | `routes/metadata.js` | KEEP |
| `src/utils/netease.js` | [MUSIC] | `routes/metadata.js` | KEEP |
| `src/utils/metadataWriter.js` | [MUSIC] | `routes/metadata.js` | KEEP |
| `src/utils/deterministicShuffle.js` | [MUSIC] | `routes/playlists.js` | KEEP |
| `src/utils/lrcParser.js` | [MUSIC] | `routes/metadata.js` | KEEP |
| `src/utils/lrcmux.js` | [MUSIC] | `routes/metadata.js` | KEEP |
| `src/utils/pyjlyric.js` | [MUSIC] | `routes/metadata.js` | KEEP |
| `src/utils/pyjlyric_search.py` | [MUSIC] | `routes/metadata.js` | KEEP |
| `src/utils/romaji.js` | [MUSIC] | `routes/metadata.js` | KEEP |
| `src/utils/adaptiveController.js` | [MUSIC] | `routes/files.js` | KEEP |
| `src/utils/playbackEngine.js` | [MAIN-WEB-ONLY] | Only used by `routes/stream.js` | REMOVE |
| `src/utils/hlsGenerator.js` | [MAIN-WEB-ONLY] | Only used by `routes/stream.js` | REMOVE |
| `src/utils/avSync.js` | [MAIN-WEB-ONLY] | Only used by `playbackEngine.js`, `hlsGenerator.js` | REMOVE |
| `src/utils/uploadManager.js` | [DEAD] | No Music route imports it | REMOVE |
| `src/utils/logCapture.js` | [DEAD] | No Music route imports it | REMOVE |
| `src/utils/sessionTracker.js` | [DEAD] | No Music route imports it | REMOVE |

### Monitor Directory [MONITORING]

| File | Classification | Used By Music | Action |
|------|---------------|--------------|--------|
| `src/monitor/alerts.js` | [MONITORING] | No | REMOVE |
| `src/monitor/collectors/cpu.js` | [MONITORING] | No | REMOVE |
| `src/monitor/collectors/disk.js` | [MONITORING] | No | REMOVE |
| `src/monitor/collectors/gpu.js` | [MONITORING] | No | REMOVE |
| `src/monitor/collectors/memory.js` | [MONITORING] | No | REMOVE |
| `src/monitor/collectors/network.js` | [MONITORING] | No | REMOVE |
| `src/monitor/collectors/system.js` | [MONITORING] | No | REMOVE |
| `src/monitor/docker.js` | [MONITORING] | No | REMOVE |
| `src/monitor/engine.js` | [MONITORING] | Only `routes/services.js` (non-Music service) | REMOVE |
| `src/monitor/historical.js` | [MONITORING] | Only `utils/maintenance.js` (non-Music import) | REMOVE |
| `src/monitor/logs.js` | [MONITORING] | No | REMOVE |
| `src/monitor/monitoringCache.js` | [MONITORING] | No | REMOVE |
| `src/monitor/platdetect.js` | [MONITORING] | No | REMOVE |
| `src/monitor/processes.js` | [MONITORING] | No | REMOVE |
| `src/monitor/services.js` | [MONITORING] | No | REMOVE |
| `src/monitor/websocket.js` | [MONITORING] | No | REMOVE |
| `src/monitor/webStats.js` | [MONITORING] | No | REMOVE |

---

## Reachability Matrix

```
Music API Endpoint              → Uses
─────────────────────────────────────────────────────────────────────
/api/files                      → routes/files.js, utils/thumbnailUtils.js, db.js
/api/files/:id                  → routes/files.js, db.js
/api/files/batch                → routes/files.js, db.js
/api/files/favorites            → routes/files.js, db.js
/api/files/folders/:id          → server.js (inline handler) → mediaEngine
/file/:id                       → routes/file.js, db.js
/thumbnails/:id.jpg             → routes/thumbnails.js, utils/thumbnailUtils.js
/api/playlists                  → routes/playlists.js, utils/xspfParser.js
/api/playlists/:id              → routes/playlists.js
/api/playlists/:id/play         → routes/playlists.js
/api/playlists/scan             → routes/playlists.js, utils/playlistScanner.js
/api/playlists/:id/refresh      → routes/playlists.js
/api/playlists/:id DELETE        → routes/playlists.js
/api/playlists/create/manual    → routes/playlists.js
/api/playlists/create/folder    → routes/playlists.js
/api/playlists/import           → routes/playlists.js, utils/xspfParser.js
/api/metadata/:id               → routes/metadata.js
/api/metadata/:id/cover         → routes/metadata.js, utils/coverSources.js
/api/metadata/:id/cover/upload  → routes/metadata.js
/api/metadata/:id/lyrics        → routes/metadata.js, utils/lyricsSources.js
/api/metadata/cover-art/search  → routes/metadata.js, utils/musicbrainz.js
/api/metadata/lyrics/search     → routes/metadata.js, utils/lrclib.js
/api/video-cache/search         → routes/videoCache.js, utils/youtube.js
/api/video-cache/save-id/:fileId → routes/videoCache.js
/api/video-cache/stream/:youtubeId → routes/videoCache.js, utils/videoCache.js
/api/video-cache/download/:youtubeId → routes/videoCache.js, utils/videoCache.js
/api/video-cache/progress/:youtubeId → routes/videoCache.js
/api/video-cache/auto-detect/:fileId → routes/videoCache.js
/api/video-cache/:youtubeId DELETE → routes/videoCache.js
/api/listening/sync             → routes/listening.js, syncUtils.js
/api/listening/migrate          → routes/listening.js, syncUtils.js
/api/sync-verify/snapshot       → routes/syncVerify.js, syncUtils.js
/api/services                   → routes/services.js, services/registry.js
/api/services/:name/:action     → routes/services.js, services/registry.js
/health                         → server.js (inline)
/api/ready                      → server.js (inline)
```

---

## Files Removed (31 total)

### monitor/ directory (17 files)
1. `src/monitor/alerts.js`
2. `src/monitor/collectors/cpu.js`
3. `src/monitor/collectors/disk.js`
4. `src/monitor/collectors/gpu.js`
5. `src/monitor/collectors/memory.js`
6. `src/monitor/collectors/network.js`
7. `src/monitor/collectors/system.js`
8. `src/monitor/docker.js`
9. `src/monitor/engine.js`
10. `src/monitor/historical.js`
11. `src/monitor/logs.js`
12. `src/monitor/monitoringCache.js`
13. `src/monitor/platdetect.js`
14. `src/monitor/processes.js`
15. `src/monitor/services.js`
16. `src/monitor/websocket.js`
17. `src/monitor/webStats.js`

### Dead utilities (3 files)
18. `src/utils/uploadManager.js`
19. `src/utils/logCapture.js`
20. `src/utils/sessionTracker.js`

### Stream/playback engine chain (4 files)
21. `src/routes/stream.js`
22. `src/utils/playbackEngine.js`
23. `src/utils/hlsGenerator.js`
24. `src/utils/avSync.js`

---

## Files Modified (4 total)

1. `src/utils/maintenance.js` — Remove `playbackEngine` import, remove `../monitor/historical.js` dynamic import, remove playback cleanup and metrics cleanup intervals/functions
2. `src/routes/services.js` — Remove `../monitor/engine.js` import, remove monitor service registration and status refresh
3. `src/middleware/serviceGuard.js` — Simplify `SERVICE_LABELS` to only `mediaVault` and `playlists`
4. `src/server.js` — Remove `/stream` route registration

---

## Files Kept (43 total)

```
src/config/paths.js
src/db.js
src/fts-rebuild-worker.mjs
src/middleware/serviceGuard.js
src/repository/sqliteMediaRepository.js
src/routes/file.js
src/routes/files.js
src/routes/listening.js
src/routes/metadata.js
src/routes/playlists.js
src/routes/services.js
src/routes/syncVerify.js
src/routes/thumbnails.js
src/routes/videoCache.js
src/server.js
src/services/registry.js
src/syncUtils.js
src/utils/adaptiveController.js
src/utils/coverSources.js
src/utils/deterministicShuffle.js
src/utils/genius.js
src/utils/lrcParser.js
src/utils/lrclib.js
src/utils/lrcmux.js
src/utils/logger.js
src/utils/lyricsSources.js
src/utils/maintenance.js
src/utils/metadataWriter.js
src/utils/musicbrainz.js
src/utils/netease.js
src/utils/playlistScanner.js
src/utils/pyjlyric.js
src/utils/pyjlyric_search.py
src/utils/resourceManager.js
src/utils/romaji.js
src/utils/runtimeSettings.js
src/utils/sseManager.js
src/utils/thumbnailQueue.js
src/utils/thumbnailUtils.js
src/utils/videoCache.js
src/utils/xspfParser.js
src/utils/youtube.js
src/utils/ytdlp.js
```
