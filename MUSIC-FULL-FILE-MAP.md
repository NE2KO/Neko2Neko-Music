# Music Web — Full File Map & Suspicious Files Audit

> Analisis lengkap direktori `/home/CATIAA/WEB/Music/` tanpa editing apapun.

---

## 1. Full File Tree

```
/home/CATIAA/WEB/Music/
├── backend/
│   ├── cache/videos/                  (kosong)
│   ├── data/                          (kosong)
│   ├── metadata_cache/youtube/        (4 file cache JSON)
│   ├── package.json
│   ├── pnpm-lock.yaml
│   └── src/
│       ├── config/paths.js
│       ├── context.js
│       ├── db.js
│       ├── fts-rebuild-worker.mjs
│       ├── gateway/
│       │   ├── adapters/express.js
│       │   ├── config.toml
│       │   ├── core/policy.js, token.js
│       │   ├── handlers/file.js, files.js, resolve.js, stream.js
│       │   ├── index.js
│       │   ├── routes/batch.js, file.js, files.js, folders.js, health.js, search.js, stream.js, stream-token.js, thumbnails.js
│       │   └── types/index.js
│       ├── middleware/serviceGuard.js
│       ├── repository/sqliteMediaRepository.js
│       ├── routes/file.js, files.js, listening.js, metadata.js, playlists.js, services.js, thumbnails.js, videoCache.js
│       ├── server.js
│       ├── services/registry.js
│       └── utils/
│           ├── adaptiveController.js
│           ├── coverSources.js
│           ├── deterministicShuffle.js
│           ├── genius.js
│           ├── logger.js
│           ├── lrclib.js
│           ├── lrcmux.js
│           ├── lrcParser.js
│           ├── lyricsSources.js
│           ├── maintenance.js
│           ├── metadataWriter.js
│           ├── musicbrainz.js
│           ├── netease.js
│           ├── playlistScanner.js
│           ├── pyjlyric.js
│           ├── pyjlyric_search.py
│           ├── resourceManager.js
│           ├── romaji.js
│           ├── runtimeSettings.js
│           ├── sseManager.js
│           ├── thumbnailQueue.js
│           ├── thumbnailUtils.js
│           ├── videoCache.js
│           ├── xspfParser.js
│           ├── youtube.js
│           └── ytdlp.js
├── cache/
│   ├── downloader/                    (kosong)
│   ├── hls/                           (kosong)
│   ├── metadata/                      (kosong)
│   ├── playback/
│   │   ├── faststart/                 (kosong)
│   │   ├── lru.json
│   │   ├── remux/                     (kosong)
│   │   └── transcode/                 (kosong)
│   ├── temp/                          (kosong)
│   ├── thumbnail/                     (256 subdir 00-ff + list/)
│   └── video/                         (60+ file .sgop.mp4)
├── data/                              (kosong)
├── dist/
│   ├── assets/index-CBUfd2sF.js, source-map-B1l1Kl2Q.js, index-DvmfPgz2.css
│   └── index.html
├── frontend/
│   ├── dist/                          (build output)
│   ├── index.html
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx                   (entry point)
│       ├── index.css
│       ├── theme.js
│       ├── app/App.jsx
│       ├── debug/                     (inspectors, providers)
│       ├── engines/audioEngine.js
│       ├── hooks/useServiceControl.js
│       ├── music/                     (komponen player)
│       │   ├── Music.jsx
│       │   ├── MusicLayout.jsx
│       │   ├── MiniPlayer.jsx
│       │   ├── CachedVideoPlayer.jsx
│       │   ├── SyncOverlay.jsx
│       │   ├── LyricsDisplay.jsx, LyricsEditor.jsx
│       │   ├── QueuePanel.jsx, NowPlayingPanel.jsx
│       │   ├── FilterPanel.jsx, CoverArtSearch.jsx
│       │   ├── CropTool.jsx, MetadataEditor.jsx
│       │   ├── PlaylistView.jsx, PlaylistSidebar.jsx, dll.
│       │   └── icons/
│       ├── shared/                    (komponen bersama)
│       │   ├── DebugProvider.jsx, DebugTooltip.jsx
│       │   ├── MediaControls.jsx, Carousel.jsx
│       │   ├── Toast.jsx, ConfirmModal.jsx
│       │   ├── NetworkImage.jsx, ErrorBoundary.jsx
│       │   └── icons/
│       ├── store/
│       │   ├── playbackStore.js
│       │   ├── playlistStore.js
│       │   ├── favoritesStore.js
│       │   ├── folderSortStore.js
│       │   └── folderMetaSortStore.js
│       ├── utils/
│       │   ├── api.js                 (API service utama)
│       │   ├── playlistApi.js         (playlist API wrapper)
│       │   ├── adbApi.js              (ADB API wrapper)
│       │   ├── audioOutput.js
│       │   ├── routeParser.js
│       │   ├── trackFilter.js
│       │   ├── listeningTracker.js
│       │   ├── syncCore.js
│       │   ├── syncTelemetry.js
│       │   ├── miniContinuity.js
│       │   ├── videoSyncEngine.js
│       │   ├── autoPlayPending.js
│       │   ├── playlistWindow.js
│       │   ├── workerPool.js
│       │   ├── mediaRepository.js
│       │   ├── validation/SensorValidator.js, ReasonCodes.js
│       │   ├── sensor/SensorSnapshot.js, index.js
│       │   ├── memory/DerivedMetrics.js, LearningMemory.js, DecoderMemory.js, MemorySnapshot.js, DriftMemory.js, SchedulerMemory.js, GlobalMemory.js, PipelineMemory.js, index.js
│       │   ├── decision/DecisionEngine.js, ActionRequest.js, ConstraintProvider.js, index.js, ExecutionQueue.js
│       │   ├── replay/SyncReplayEngine.js
│       │   ├── analyzers/DriftAnalyzer.js, SchedulerAnalyzer.js, DecoderAnalyzer.js, ConsistencyAnalyzer.js, PipelineAnalyzer.js, index.js
│       │   ├── syncCapture/index.js
│       │   ├── syncVerification/index.js
│       │   ├── syncHelpers.js
│       │   ├── format.js
│       │   ├── codec.js
│       │   ├── groupBy.js
│       │   ├── trackSyncProfile.js
│       │   ├── thumbCache.js
│       │   ├── playlistQueue.js
│       │   └── ...
│       └── workers/mediaWorker.js
├── logs/
│   ├── system/                        (5 file .log)
│   └── maintenance/                   (5 file .log)
├── node_modules/                      (394 entry)
├── package.json
├── package-lock.json
├── pnpm-lock.yaml
├── public/                            (kosong)
└── [markdown docs]
    ├── MUSIC-BACKEND-DEPENDENCY-AUDIT.md
    ├── MUSIC-ENGINE-WIRING.md
    ├── MUSIC-STANDALONE-ARCHITECTURE.md
    └── MUSIC-STANDALONE-EXTRACTION-REPORT.md
```

---

## 2. Backend Analysis

### Entry Point
- **`backend/src/server.js`** — Main Express server. Creates `MediaEngine` and `MediaScanner`, mounts all routes, and exposes `globalThis.mediaEngine` / `globalThis.mediaScanner`.

### Database
- **`backend/src/db.js`** — SQLite connection via `better-sqlite3`.
- **`backend/src/repository/sqliteMediaRepository.js`** — Repository layer for media queries.

### Routes
| Route File | Purpose | Engine/DB Usage |
|------------|---------|-----------------|
| `routes/files.js` | List files with pagination | DB + engine |
| `routes/file.js` | Single file metadata | engine.resolve() |
| `routes/thumbnails.js` | Thumbnail serving (full/list) | globalThis.mediaEngine |
| `routes/playlists.js` | Playlist CRUD | DB only |
| `routes/listening.js` | Listening stats/sync | DB only |
| `routes/videoCache.js` | Video cache/MV | DB + engine |
| `routes/metadata.js` | Cover art, lyrics, upload | engine + external APIs |
| `routes/services.js` | Service control | registry only |

### Middleware
- **`middleware/serviceGuard.js`** — Guard for service endpoints.

### Utils (Selected)
| Utils File | Purpose | Notes |
|------------|---------|-------|
| `youtube.js` | YouTube API integration | External API |
| `ytdlp.js` | yt-dlp wrapper | Binary dependency |
| `videoCache.js` | Video cache management | Backend-specific |
| `playlistScanner.js` | Scan playlists | DB + engine |
| `metadataWriter.js` | Write metadata to files | Uses Python script |
| `thumbnailQueue.js` | Queue thumbnail generation | globalThis.mediaScanner |
| `thumbnailUtils.js` | Thumbnail utilities | globalThis.mediaEngine |
| `genius.js`, `lrclib.js`, `netease.js` | Lyrics sources | External APIs |
| `pyjlyric.js` + `pyjlyric_search.py` | Japanese lyrics scraping | Python script |

### Gateway (Internal)
- **`backend/src/gateway/`** — Self-contained gateway implementation inside backend.
  - Routes: batch, file, files, folders, health, search, stream, stream-token, thumbnails
  - Handlers: file, files, resolve, stream
  - Core: policy, token
  - **Not yet wired** to server.js (based on MUSIC-GATEWAY-ADAPTATION.md)

---

## 3. Frontend Analysis

### Entry Point
- **`frontend/src/main.jsx`** — React app entry, mounts App.jsx.

### App Structure
- **`app/App.jsx`** — Root component.
- **`music/`** — Player components (Music.jsx, MusicLayout.jsx, MiniPlayer.jsx, CachedVideoPlayer.jsx, etc.)
- **`shared/`** — Shared UI components (MediaControls, Carousel, Toast, etc.)
- **`debug/`** — Debug inspectors/providers

### Stores (Zustand?)
- `playbackStore.js` — Playback state
- `playlistStore.js` — Playlist state
- `favoritesStore.js` — Favorites
- `folderSortStore.js` — Folder sorting
- `folderMetaSortStore.js` — Folder meta sorting

### API Services
| File | Endpoints Called | Notes |
|------|-----------------|-------|
| `utils/api.js` | `/api/files`, `/file/:id`, `/thumbnails/full/:id.jpg`, `/thumbnails/list/:id.jpg`, `/api/search` | Main API service |
| `utils/playlistApi.js` | `/api/playlists/*` | Playlist wrapper |
| `utils/adbApi.js` | `/api/adb/*` | ADB push/pull |

### Engines/Workers
- **`engines/audioEngine.js`** — Audio playback engine
- **`workers/mediaWorker.js`** — Web Worker for media processing

### Utilities (Selected)
| File | Purpose |
|------|---------|
| `syncCore.js` | A/V sync core logic |
| `syncTelemetry.js` | Sync telemetry (snapshots) |
| `videoSyncEngine.js` | Video sync engine |
| `listeningTracker.js` | Listening stats tracking |
| `audioOutput.js` | Audio output handling |
| `routeParser.js` | Parse route/track info |
| `trackFilter.js` | Filter tracks |
| `miniContinuity.js` | Mini player continuity |
| `autoPlayPending.js` | Auto-play pending queue |
| `playlistWindow.js` | Playlist windowing |
| `workerPool.js` | Worker pool management |
| `mediaRepository.js` | Frontend media data layer |
| `thumbCache.js` | Thumbnail cache |
| `playlistQueue.js` | Playlist queue |
| `format.js`, `codec.js`, `groupBy.js` | Format helpers |

### Vite Config
- **`vite.config.js`** — Proxies `/api/*`, `/file/*`, `/thumbnails/*` to `http://127.0.0.1:4000`.

---

## 4. Suspicious Files Table

| File / Folder | Alasan | Saran |
|---------------|--------|-------|
| `node_modules/` | 394 entry, tidak perlu di-version control | **Remove** from repo |
| `dist/` (root) | Build output Vite, bisa di-generate ulang | **Remove** from repo |
| `frontend/dist/` | Build output Vite, bisa di-generate ulang | **Remove** from repo |
| `cache/thumbnail/full/` + `list/` | 256 subfolder + ribuan file .jpg, cache yang sudah di-generate | **Remove** — akan ter-generate ulang otomatis |
| `cache/video/*.sgop.mp4` | 60+ file video cache YouTube, data besar | **Remove** — data transient |
| `cache/playback/lru.json` | State cache playback | **Remove** — bisa di-reset |
| `backend/metadata_cache/youtube/*.json` | 4 file cache hasil pencarian YouTube (hex-encoded query) | **Remove** — transient data |
| `logs/system/*.log` + `logs/maintenance/*.log` | File log operasional | **Remove** — tidak perlu di-commit |
| `backend/cache/videos/` | Direktori cache video backend yang kosong | **Remove** — unused |
| `backend/data/` | Direktori data backend yang kosong | **Remove** — unused |
| `data/` (root) | Direktori data root yang kosong | **Remove** — unused |
| `public/` | Direktori public frontend yang **kosong** | **Remove** — tidak ada asset statik |
| `package-lock.json` (root) | Lock file npm, sedangkan project menggunakan **pnpm** (`pnpm-lock.yaml`) | **Remove** — redundant |
| `backend/src/utils/pyjlyric_search.py` | Script Python standalone untuk scraping lyrics Jepang, dependen `pyjlyric` yang tidak ada di package.json | **Confirm with user** — apakah masih dipakai? |
| **MISSING:** `backend/src/utils/embed_cover.py` | Direferensikan di `metadataWriter.js` baris 79, **TIDAK DITEMUKAN** | **CRITICAL** — akan menyebabkan runtime error saat embed cover |
| **MISSING:** `backend/src/utils/romaji_convert.py` | Direferensikan di `romaji.js` baris 6, **TIDAK DITEMUKAN** | **CRITICAL** — akan menyebabkan runtime error saat romaji conversion |
| `backend/src/gateway/config.toml` | Berisi **hardcoded secret key**: `secret_key = "dev-only-change-in-production"` | **SECURITY RISK** — seharusnya pakai environment variable |
| `frontend/src/utils/adbApi.js` + endpoint `/api/adb/*` | Fungsi ADB (Android Debug Bridge) untuk push/pull file ke perangkat Android | **Confirm with user** — apakah fitur ini masih dipakai? |
| `frontend/src/utils/syncTelemetry.js` + endpoint `/api/sync-verify/snapshot` | Sistem telemetry A/V sync yang mengirim snapshot ke backend | **Confirm with user** — apakah masih dipakai untuk production? |
| `backend/src/gateway/` (seluruh folder) | Gateway implementation yang **belum di-wire** di server.js (sesuai MUSIC-GATEWAY-ADAPTATION.md) | **Keep for now** — akan dipakai saat integrasi gateway |
| `MUSIC-BACKEND-DEPENDENCY-AUDIT.md`, `MUSIC-ENGINE-WIRING.md`, `MUSIC-STANDALONE-ARCHITECTURE.md`, `MUSIC-STANDALONE-EXTRACTION-REPORT.md` | Dokumentasi audit/arsitektur lama | **Keep** — referensi historis |

---

## 5. Summary

### Cleanup Candidates (High Confidence)
- `node_modules/`, `dist/`, `frontend/dist/`, `package-lock.json` — standard build artifacts
- `cache/thumbnail/`, `cache/video/*.sgop.mp4`, `cache/playback/lru.json` — transient runtime data
- `backend/metadata_cache/youtube/*.json` — transient API cache
- `logs/` — operational logs
- `backend/cache/videos/`, `backend/data/`, `data/`, `public/` — empty directories

### Critical Issues
- **Missing Python scripts:** `embed_cover.py`, `romaji_convert.py` — akan menyebabkan runtime error
- **Hardcoded secret key** di `backend/src/gateway/config.toml`

### Needs Confirmation
- `pyjlyric_search.py` — apakah masih dipakai?
- `adbApi.js` + `/api/adb/*` — apakah fitur ADB masih dibutuhkan?
- `syncTelemetry.js` + `/api/sync-verify/snapshot` — apakah telemetry A/V sync masih dipakai?

### Keep As-Is
- `backend/src/gateway/` — akan dipakai untuk integrasi gateway
- Semua route files, utils, frontend components — sedang dipakai
- Dokumentasi MD — referensi historis

---

*Generated by automated exploration. No files were modified.*
