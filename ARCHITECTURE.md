# Neko2Neko Music — Architecture & Requirements

## Core Principle

> **Frontend owns intent. Engines own concerns.**

The Music web app is a consumer of three standalone engines. It must not reimplement persistence, media boundary, or sync logic. It only coordinates UI intent into engine calls.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (Frontend)                          │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Music.jsx (Full Player)                    │  │
│  │  - Playback state, queue, lyrics, cover, video               │  │
│  │  - Calls engines through thin adapters                       │  │
│  └───────────────┬──────────────────────────────────────────────┘  │
│                  │                                                  │
│  ┌───────────────▼──────────────────────────────────────────────┐  │
│  │              createMusicSync()                                │  │
│  │  - Audio (master) ↔ MV + BG triangle sync                    │  │
│  │  - tick() per animation frame                                │  │
│  │  - drift correction: rate / seek / stall recovery            │  │
│  └───────────────┬──────────────────────────────────────────────┘  │
│                  │                                                  │
│  ┌───────────────▼──────────────────────────────────────────────┐  │
│  │              AudioVisualizer                                  │  │
│  │  - Web Audio API: AnalyserNode                               │  │
│  │  - FFT bars, adaptive rolloff, gain normalization            │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                            │
                     opaque IDs / tokens
                            │
┌───────────────────────────▼─────────────────────────────────────────┐
│                     Express Backend (Gateway)                        │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                   MediaEngine Gateway                         │  │
│  │  - resolve(id) → metadata without paths                       │  │
│  │  - getServeTarget(id) → signed stream token                   │  │
│  │  - handleStreamRequest(token) → 206 Range stream              │  │
│  │  - searchFiles / listFiles / FTS                              │  │
│  │  - Policy enforcement per web app                             │  │
│  │  - Scanner + watcher + thumbnail callbacks                     │  │
│  └──────────────────────────┬───────────────────────────────────┘  │
│                             │                                        │
│  ┌──────────────────────────▼───────────────────────────────────┐  │
│  │                   SqliteMediaRepository                       │  │
│  │  - files, folders, visibility, changesets                     │  │
│  │  - FTS5 search, cursor pagination, batch ops                  │  │
│  └──────────────────────────┬───────────────────────────────────┘  │
│                             │                                        │
│  ┌──────────────────────────▼───────────────────────────────────┐  │
│  │                      DB Engine                                 │  │
│  │  - owns better-sqlite3 connection lifecycle                    │  │
│  │  - schema, WAL, prepared statements, health                   │  │
│  │  - backup, checkpoint, batch transaction, retry               │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
                  ┌──────────────────┐
                  │   Filesystem     │
                  │ /media/music     │
                  │ /media/videos    │
                  └──────────────────┘
```

---

## Requirements by Layer

### 1. Frontend — Full Player (`Music.jsx`)

**Role:** Express intent only. Own playback UI, queue, lyrics, cover, video panels, and audio visualizer.

**Requirements:**
- Must NOT read raw media paths from backend responses.
- Must use opaque IDs (`fileId`) for every media operation.
- Must request stream targets from backend, never construct stream URLs locally.
- Must call `sync.tick()` in its animation loop for A/V sync.
- Must handle audio visualizer through Web Audio API only; no filesystem access.
- Must pass user gesture events to visualizer init (`play`, `playing`, `canplay`, `click`, `touchstart`, `keydown`).

**Must import from engines:**
- `@homelab/sync-engine` → `createMusicSync()`
- Local adapters only; never import `better-sqlite3` or filesystem utils.

---

### 2. Frontend — Sync Surface (`NowPlayingPanel.jsx`, `MiniPlayer.jsx`)

**Role:** Lightweight sync surface for mini video and background video.

**Requirements:**
- Use `createSyncSurfaceIntegration()` with `type: 'mv'` or `type: 'bg'`.
- Must call `sync.attach()` on mount, `sync.detach()` on unmount.
- Must forward media events (`playing`, `loadedmetadata`, `canplay`) to sync engine.
- Must not implement custom drift correction; engine owns that.

---

### 3. Backend — Media Gateway

**Role:** Single media boundary. Owns all filesystem, streaming, scanning, search, and visibility concerns.

**Requirements:**
- Must be the ONLY component that touches media paths, `fs`, and storage internals.
- Must expose `resolve()`, `getServeTarget()`, `handleStreamRequest()`, `listFiles()`, `searchFiles()`.
- Must enforce per-web-app policies from `config.toml` (`allowed_roots`, `types`, `web_id`).
- Must return signed, time-limited stream tokens to frontend; never raw paths.
- Must support `206 Partial Content` for video seeking.
- Must run `MediaScanner` with watcher + periodic rescan + callbacks.
- Must delegate ALL persistence to DB Engine; no direct `better-sqlite3` usage outside engine.

---

### 4. Backend — DB Engine Adapter

**Role:** Thin compatibility layer between legacy backend code and DB Engine.

**Requirements:**
- Must be the ONLY file allowed to `require('better-sqlite3')`.
- Must delegate all CRUD, transactions, health, WAL, backup to DB Engine.
- Must preserve legacy `stmts.*` API surface for existing consumers.
- Must fail build if any application file imports `better-sqlite3` directly (architecture guard).

---

### 5. DB Engine

**Role:** Owns SQLite connection lifecycle, schema, transactions, health, WAL, backup.

**Requirements:**
- Must manage `better-sqlite3` connection with correct pragmas (`WAL`, `busy_timeout=5000`, `synchronous=NORMAL`, `cache_size=-80000`, `mmap_size=4GB`, `page_size=32768`).
- Must prepare and registry 150+ named statements.
- Must provide `engine.transaction()`, `engine.batchTransaction()`, `engine.runWithRetry()`.
- Must expose `engine.health()`, `engine.walCheckpoint()`, `engine.backupAsync()`.
- Must hide raw connection (`getSqliteConnection()` forbidden).
- Must own schema versioning and migrations.
- Must track lock telemetry (`getLockStats()`).

---

### 6. Media Engine

**Role:** Single media boundary between web apps and filesystem.

**Requirements:**
- Must own path resolution, symlink safety, traversal protection.
- Must enforce per-user visibility (`PRESENT` / `DELETED` per `webId`).
- Must support multi-web gateway mode with `config.toml` policies.
- Must issue signed HMAC stream tokens; never expose real paths.
- Must support HTTP Range requests (`206 Partial Content`).
- Must provide incremental scanner with debounced watcher and adaptive backpressure.
- Must expose FTS5 search with visibility filtering and cursor pagination.
- Must support changeset promotion across environments.

---

### 7. Triangle Sync Engine

**Role:** Frame-accurate A/V sync between Audio, MV, and BG in browser.

**Requirements:**
- Must treat Audio as master clock (`HTMLAudioElement`).
- Must measure 3 drifts per tick: `audioMvMs`, `audioBgMs`, `mvBgMs`.
- Must maintain triangle consistency: `|audioMvMs + mvBgMs - audioBgMs| <= 1ms`.
- Must correct drift via playback rate, seek, or stall recovery.
- Must use `requestVideoFrameCallback` for timing.
- Must have zero external dependencies in core.
- Must expose integration facades: `createMusicSync()`, `createSyncSurfaceIntegration()`.

---

## Why Each Engine Exists

| Engine | Why It Exists | What Happens If You Skip It |
|--------|---------------|----------------------------|
| **DB Engine** | Application must not decide SQLite internals, WAL, backup, recovery. Engine owns persistence boundary. | Scattered `better-sqlite3` usage, inconsistent pragmas, no health/backup, architecture violations. |
| **Media Engine** | Web apps must not touch filesystem paths, leak media roots, or duplicate resolution/streaming logic. | Path traversal risks, inconsistent policy, duplicated scanner code, tests requiring real filesystem. |
| **Triangle Sync Engine** | Audio → MV → BG chain causes cascading drift. Triangle sync measures all legs independently. | AV drift compounds, BG ends up 2x off from audio, seeking breaks sync, mini player desyncs from full player. |

---

## Data Flow: Play a Song

```
User clicks play
       │
       ▼
Music.jsx
  - setState({ isPlaying: true })
  - sync.tick() starts in rAF loop
  - backend.resolve(fileId) → metadata
  - backend.getServeTarget(fileId, 'music') → { streamUrl, metadata }
  - audio.src = streamUrl
  - audio.play()
       │
       ▼
Triangle Sync Engine
  - audio is master clock
  - MV and BG independently track audio drift
  - correct via rate/seek/stall
       │
       ▼
Media Engine Gateway
  - resolve() strips paths, returns { id, name, type, mimeType }
  - getServeTarget() returns signed token
  - handleStreamRequest() verifies token, streams file with Range support
       │
       ▼
DB Engine
  - query visibility: is this file visible for webId 'music'?
  - upsert listening history
  - return file metadata from SQLite
       │
       ▼
Filesystem
  - media-engine streams /media/music/...
```

---

## Configuration

| Component | Config Location | Purpose |
|-----------|-----------------|---------|
| **Media Engine** | `backend/src/gateway/media-engine/config.toml` | Web app policies, HMAC secret, scan interval, thumbnail root |
| **DB Engine** | `backend/src/gateway/db/config.toml` | DB path, pragma overrides |
| **Sync Engine** | `frontend/src/engines/audioEngine.js` + runtime tuning | Drift thresholds, rate limits, stall timeouts |

---

## Non-Negotiable Boundaries

```
Frontend  ──(opaque IDs / tokens)──▶  Backend
Backend   ──(streams / metadata)──▶  Media Engine
Media Engine  ──(repository)──▶  DB Engine
DB Engine  ──(SQL)──▶  SQLite
Triangle Sync  ──(timing)──▶  Audio / MV / BG (browser only)
```

**Violations:**
- Frontend constructs stream URLs → forbidden
- Backend touches `fs` directly → forbidden
- Backend imports `better-sqlite3` directly → forbidden
- Frontend implements custom drift correction → forbidden
- Media Engine exposes `fullPath` to web apps → forbidden

---

## Requirements Summary

1. **Frontend** must be UI-only: state, routing, playback intent, sync tick, audio visualizer.
2. **Backend** must be media-boundary-only: resolve, stream, search, scan, policy.
3. **DB Engine** must own ALL SQLite concerns: connection, schema, WAL, backup, transactions.
4. **Media Engine** must own ALL filesystem concerns: paths, streaming, visibility, scanner.
5. **Triangle Sync Engine** must own ALL A/V timing concerns: drift measurement, correction, stall recovery.
6. No component may bypass its engine boundary.
7. No component may expose raw paths, raw connections, or raw filesystem handles across boundaries.
