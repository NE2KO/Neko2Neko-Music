# Backend Migration & Architecture Redesign — Changelog

## Overview

This document records all changes made to the homelab-media-server backend ecosystem during the DB split, thumbnail restructuring, and bug-fix migration from a monolithic single-DB architecture to a per-function multi-DB architecture.

---

## 1. Database Migration

### 1.1 New DB Files

The monolithic `/home/CATIAA/WEB/db/Music/media.db` was split into 6 functional databases:

| DB File | Tables | Row Counts |
|---------|--------|------------|
| `music.db` | folders, files, folder_generation, files_fts, media_visibility, media_changes, media_changesets, media_changeset_items | 169 folders, 1422 files |
| `playlist.db` | playlists, playlist_tracks | 4 playlists, 4413 tracks |
| `leaderboard.db` | listening_stats, listening_sessions | 234 stats, 9059 sessions |
| `settings.db` | settings, settings_history | 104 settings |
| `social.db` | conversations, messages, ai_*, send_*, telegram_*, uploads, etc. | 10 conversations |
| `uploads.db` | uploads | 42 uploads |

### 1.2 Migration Script

**File:** `/home/CATIAA/WEB/Music/backend/migrate_v2.js`

Key fixes applied to the migration script:
- Used `INSERT OR REPLACE INTO` instead of `INSERT INTO` to handle UNIQUE constraint violations
- Used `CREATE TRIGGER IF NOT EXISTS` to avoid "trigger already exists" errors
- Used source DB's `PRAGMA table_info()` columns (not target DB's) for SELECT queries
- Skipped `folder_generation` data migration (triggers rebuild it automatically)
- Removed manual FTS5 data insertion (triggers handle it)
- Fixed `send_queue` schema to match source DB (removed non-existent `file_name`, `file_type`, `codec_info` columns)

### 1.3 Cross-DB Query Support

**File:** `/home/CATIAA/WEB/Music/backend/src/db.js`

Added `ATTACH DATABASE` to enable cross-DB queries:
```js
musicDb.exec(`ATTACH DATABASE '${DB_DIR}/playlist.db' AS playlist`);
```

This allows `musicDb` to query `playlist.playlist_tracks` for the `refreshPlaylistTrackDurations` statement.

---

## 2. WEB/Music Backend (`/home/CATIAA/WEB/Music/backend/`)

### 2.1 `src/db.js` — Complete Rewrite

**Before:** Single `Database` instance with all tables, 1037 lines of monolithic schema/statements.

**After:** 6 separate `better-sqlite3` `Database` instances with per-function schemas and prepared statements.

Key changes:
- `createDb(name)` helper creates each DB with WAL pragmas
- `musicDb`, `playlistDb`, `leaderboardDb`, `settingsDb`, `socialDb`, `uploadsDb` exported as named exports
- `musicStmts`, `playlistStmts`, `leaderboardStmts`, `settingsStmts`, `socialStmts` exported as named exports
- `setupMusicFTS()` and `deferredDbInit()` exported as named functions
- Default export changed to `musicDb` (was the monolithic `db`)
- `ATTACH DATABASE 'playlist.db' AS playlist` for cross-DB queries
- All schema definitions split by function
- All `ALTER TABLE` migrations preserved
- FTS5 triggers preserved

### 2.2 `src/context.js` — Updated Imports

**Before:**
```js
import db, { stmts, setupFTS, deferredDbInit } from './db.js';
```

**After:**
```js
import { musicDb, musicStmts, setupMusicFTS, deferredDbInit } from './db.js';
```

- `SqliteMediaRepository` now uses `musicDb` and `musicStmts`
- `setupMusicFTS()` called instead of `setupFTS()`
- `deferredDbInit()` called for music DB migrations
- Export changed: `export { musicDb as db, musicStmts, PATHS }`

### 2.3 `src/server.js` — Updated Imports

**Before:**
```js
import { mediaEngine, mediaScanner, db, MEDIA_ROOT, ... } from './context.js';
import { deferredDbInit, setupFTS } from './db.js';
globalThis.stmts = db.stmts || {};
```

**After:**
```js
import { mediaEngine, mediaScanner, db, musicStmts, MEDIA_ROOT, ... } from './context.js';
import { deferredDbInit, setupMusicFTS } from './db.js';
globalThis.stmts = musicStmts;
```

### 2.4 `src/routes/playlists.js` — `stmts` → `playlistStmts`

All 48 references to `stmts.` changed to `playlistStmts.`.

Import changed from:
```js
import db, { stmts } from '../db.js';
```
to:
```js
import db, { playlistStmts } from '../db.js';
```

### 2.5 `src/routes/files.js` — `stmts` → `musicStmts`

All `stmts.` references changed to `musicStmts.`.

Import changed from:
```js
import db, { stmts } from '../db.js';
```
to:
```js
import db, { musicStmts } from '../db.js';
```

Also fixed `engine.resolve()` → `resolveFileForEngine()` for thumbnail generation (lines 181, 269).

### 2.6 `src/routes/thumbnails.js` — `stmts` → `musicStmts`

Import changed from:
```js
import { stmts } from '../db.js';
```
to:
```js
import { musicStmts } from '../db.js';
```

All `stmts.updateThumbStatus`, `stmts.updateThumbCachePath`, `stmts.skipThumbStatus` changed to `musicStmts.*`.

### 2.7 `src/routes/videoCache.js` — `stmts` → `musicStmts`

Import changed from:
```js
import { stmts } from '../db.js';
```
to:
```js
import { musicStmts } from '../db.js';
```

### 2.8 `src/utils/playlistScanner.js` — `stmts` → `playlistStmts`

All `stmts.` references changed to `playlistStmts.`.

### 2.9 `src/utils/thumbnailQueue.js` — `stmts` → `musicStmts`

All `stmts.` references changed to `musicStmts.`.

Also fixed old thumbnail path references:
- `join('full', f.id.slice(0, 2), f.id + '.jpg')` → `join('full', f.id + '.jpg')`
- `join(s.name, item.id.slice(0, 2), item.id + '.jpg')` → `join(s.name, item.id + '.jpg')`

### 2.10 `src/utils/maintenance.js` — `stmts` → `musicStmts`

All `stmts.` references changed to `musicStmts.`.

### 2.11 `src/utils/deterministicShuffle.js` — `stmts` → `musicStmts`

Import changed and `stmts.getFolder` → `musicStmts.getFolder`.

### 2.12 `src/utils/runtimeSettings.js` — `db` → `settingsDb`

Import changed from:
```js
import db from '../db.js';
```
to:
```js
import { settingsDb } from '../db.js';
```

All `db.prepare(...)` → `settingsDb.prepare(...)`.

### 2.13 `src/routes/listening.js` — `db` → `leaderboardDb`

Import changed from:
```js
import db from '../db.js';
```
to:
```js
import { leaderboardDb } from '../db.js';
```

All `db.prepare(...)` → `leaderboardDb.prepare(...)`.

### 2.14 `src/utils/thumbnailUtils.js` — Flat Thumbnail Path

**Before:**
```js
export function getThumbPath(id, size = 'full') {
  if (!id || id.length < 6) {
    return join(THUMBNAIL_DIR, size, id + '.jpg');
  }
  return join(THUMBNAIL_DIR, size, id.slice(0, 2), id + '.jpg');
}
```

**After:**
```js
export function getThumbPath(id, size = 'full') {
  if (!id || id.length < 6) {
    return join(THUMBNAIL_DIR, size, id + '.jpg');
  }
  return join(THUMBNAIL_DIR, size, id + '.jpg');
}
```

---

## 3. Thumbnail Structure Redesign

### 3.1 Flat Shared Storage

**Before:** `{THUMBNAIL_DIR}/{size}/{id.slice(0,2)}/{id}.jpg` (257 subdirectories)

**After:** `{THUMBNAIL_DIR}/{size}/{id}.jpg` (flat structure)

### 3.2 `ThumbnailService` (`/home/CATIAA/Engine/media-engine/src/thumbnail/ThumbnailService.js`)

- `_thumbPath()`: Removed `fileId.slice(0, 2)` subdirectory
- `_rebuildCache()`: Now scans `join(this.thumbnailsDir, 'full')` and `join(this.thumbnailsDir, 'list')` separately instead of recursive walk

### 3.3 `getThumbPath()` in homelab-media-server

**File:** `/home/CATIAA/homelab-media-server/.kilo/worktrees/media-engine/backend/src/utils/thumbnailUtils.js`

**Before:**
```js
return join(THUMBNAIL_DIR, id.slice(0, 2), id.slice(2, 4), id.slice(4, 6), id + '.jpg');
```

**After:**
```js
return join(THUMBNAIL_DIR, id + '.jpg');
```

---

## 4. `engine.resolve()` → `resolveFileForEngine()` Fix

### 4.1 Root Cause

`MediaEngine.resolve()` strips `fullPath` via `STRIPPED_FIELDS = new Set(['fullPath'])` for security. Code that called `engine.resolve()` and checked `resolved.fullPath` always got `undefined`, preventing thumbnail generation.

### 4.2 Files Fixed

**WEB/Music:**
- `src/routes/playlists.js` (line 233): `engine.resolve(t.file_id)` → `resolveFileForEngine(t.file_id, engine.repository, engine.mediaRoots)`
- `src/routes/files.js` (lines 181, 269): Same fix

**homelab-media-server:**
- `src/routes/playlists.js` (line 232): Same fix
- `src/routes/files.js` (lines 181, 269): Same fix
- `src/routes/thumbnails.js` (line 238): Same fix
- `src/utils/thumbnailQueue.js` (line 128): Same fix
- `src/utils/uploadManager.js` (lines 401, 454): Same fix

---

## 5. homelab-media-server Backend (`/home/CATIAA/homelab-media-server/.kilo/worktrees/media-engine/backend/`)

### 5.1 Files Modified

- `src/routes/playlists.js` — `engine.resolve()` → `resolveFileForEngine()`
- `src/routes/files.js` — `engine.resolve()` → `resolveFileForEngine()`
- `src/routes/thumbnails.js` — `engine.resolve()` → `resolveFileForEngine()`
- `src/utils/thumbnailQueue.js` — `engine.resolve()` → `resolveFileForEngine()`
- `src/utils/uploadManager.js` — `engine.resolve()` → `resolveFileForEngine()`
- `src/utils/thumbnailUtils.js` — `getThumbPath()` flat structure

### 5.2 Not Yet Updated

- `src/db.js` — Still monolithic, points to `../../data/media.db`. Needs split into per-function DBs similar to WEB/Music.

---

## 6. Bug Fixes

### 6.1 `getSubfolderIds` SQL Syntax

**File:** `src/db.js`

**Before:** Missing closing parenthesis in CTE:
```js
`WITH RECURSIVE subs(id) AS (SELECT id FROM folders WHERE id = ? UNION ALL SELECT f.id FROM folders f JOIN subs s ON f.parent_id = s.id SELECT id FROM subs`
```

**After:**
```js
`WITH RECURSIVE subs(id) AS (SELECT id FROM folders WHERE id = ? UNION ALL SELECT f.id FROM folders f JOIN subs s ON f.parent_id = s.id) SELECT id FROM subs`
```

### 6.2 `refreshPlaylistTrackDurations` Cross-DB Query

**File:** `src/db.js`

Uses `ATTACH DATABASE` to update `playlist.playlist_tracks` from `musicDb`:
```js
refreshPlaylistTrackDurations: musicDb.prepare(`UPDATE playlist.playlist_tracks SET duration = COALESCE((SELECT f.duration FROM files f JOIN folders fo ON f.dir_id = fo.id WHERE fo.path || '/' || f.name = playlist.playlist_tracks.resolved_path LIMIT 1), duration) WHERE duration = 0 OR duration IS NULL`)
```

---

## 7. Files Not Modified

### 7.1 `db-engine` (`/home/CATIAA/Engine/db-engine/`)

Not used by either WEB/Music or homelab-media-server. Both projects use raw `better-sqlite3`. No changes needed.

### 7.2 `MediaEngine.resolve()` STRIPPED_FIELDS

`/home/CATIAA/Engine/media-engine/src/MediaEngine.js` still has `STRIPPED_FIELDS = new Set(['fullPath'])`. This is intentional — `fullPath` should not be exposed in API responses. `openMedia()` and thumbnail generation code use `resolveFileForEngine()` instead.

---

## 8. Verification

### 8.1 DB Row Counts

```
music.db:    169 folders, 1422 files
playlist.db: 4 playlists, 4413 tracks
leaderboard.db: 234 listening_stats, 9059 listening_sessions
settings.db: 104 settings
social.db:   10 conversations
uploads.db:  42 uploads
```

### 8.2 Syntax Checks

All modified files pass `node --check`:
- WEB/Music: `src/db.js`, `src/context.js`, `src/server.js`, `src/routes/playlists.js`, `src/routes/files.js`, `src/routes/thumbnails.js`, `src/routes/videoCache.js`, `src/routes/listening.js`, `src/utils/playlistScanner.js`, `src/utils/thumbnailQueue.js`, `src/utils/maintenance.js`, `src/utils/deterministicShuffle.js`, `src/utils/runtimeSettings.js`, `src/utils/videoCache.js`, `src/utils/thumbnailUtils.js`
- homelab-media-server: `src/routes/playlists.js`, `src/routes/files.js`, `src/routes/thumbnails.js`, `src/utils/thumbnailQueue.js`, `src/utils/uploadManager.js`, `src/utils/thumbnailUtils.js`
- media-engine: `src/thumbnail/ThumbnailService.js`, `src/resolver/resolveFile.js`

### 8.3 Backend Startup

WEB/Music backend starts successfully:
```
[db] Deferred init complete in 2ms
[server] Running: http://0.0.0.0:4000
[server] Media roots: /home/CATIAA/Music
[scanner] Starting file watcher on: /home/CATIAA/Music
```

---

## 9. Remaining Work

### 9.1 homelab-media-server `db.js` Split

The homelab-media-server `db.js` (`/home/CATIAA/homelab-media-server/.kilo/worktrees/media-engine/backend/src/db.js`) is still monolithic (1515 lines). It needs to be split into per-function DB instances similar to WEB/Music `db.js`.

Current state:
- `media.db` has ALL tables (files, folders, playlists, conversations, messages, etc.)
- `music.db` has: listening_sessions, playlist_tracks, playlists, settings
- `shared.db` has: conversations, messages, ai_*, send_*, telegram_*, uploads, settings
- `vault.db` has: same as media.db

### 9.2 Thumbnail Cache Cleanup

Old thumbnail files in `{THUMBNAIL_DIR}/{size}/{id.slice(0,2)}/` subdirectories should be cleaned up and moved to flat structure.

### 9.3 `db-engine` Multi-DB Support

Optional: Add `createMultiDbEngine()` to `/home/CATIAA/Engine/db-engine/src/index.js` for future use.

---

## 10. File Change Summary

| File | Change Type | Lines Changed |
|------|-------------|---------------|
| `migrate_v2.js` | Fixed migration script | ~30 |
| `src/db.js` | Complete rewrite (6 DBs) | ~548 |
| `src/context.js` | Updated imports | ~10 |
| `src/server.js` | Updated imports | ~5 |
| `src/routes/playlists.js` | `stmts` → `playlistStmts`, `engine.resolve` → `resolveFileForEngine` | ~48 |
| `src/routes/files.js` | `stmts` → `musicStmts`, `engine.resolve` → `resolveFileForEngine` | ~10 |
| `src/routes/thumbnails.js` | `stmts` → `musicStmts` | ~5 |
| `src/routes/videoCache.js` | `stmts` → `musicStmts` | ~2 |
| `src/routes/listening.js` | `db` → `leaderboardDb` | ~20 |
| `src/utils/playlistScanner.js` | `stmts` → `playlistStmts` | ~10 |
| `src/utils/thumbnailQueue.js` | `stmts` → `musicStmts`, flat paths | ~10 |
| `src/utils/maintenance.js` | `stmts` → `musicStmts` | ~5 |
| `src/utils/deterministicShuffle.js` | `stmts` → `musicStmts` | ~2 |
| `src/utils/runtimeSettings.js` | `db` → `settingsDb` | ~5 |
| `src/utils/videoCache.js` | `db` → `musicDb` (default) | 0 |
| `src/utils/thumbnailUtils.js` | Flat `getThumbPath` | ~3 |
| `src/utils/uploadManager.js` (hms) | `engine.resolve` → `resolveFileForEngine` | ~4 |
| `src/utils/thumbnailQueue.js` (hms) | `engine.resolve` → `resolveFileForEngine` | ~3 |
| `src/utils/thumbnailUtils.js` (hms) | Flat `getThumbPath` | ~3 |
| `src/routes/playlists.js` (hms) | `engine.resolve` → `resolveFileForEngine` | ~3 |
| `src/routes/files.js` (hms) | `engine.resolve` → `resolveFileForEngine` | ~6 |
| `src/routes/thumbnails.js` (hms) | `engine.resolve` → `resolveFileForEngine` | ~3 |
| `media-engine/src/thumbnail/ThumbnailService.js` | Flat thumbnail paths | ~10 |
