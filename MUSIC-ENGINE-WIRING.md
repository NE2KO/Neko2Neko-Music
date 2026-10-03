# MUSIC ENGINE WIRING

## Phase 14.4 — Music Web Engine Wiring

### Objective
Wire Music Web to consume external Engine packages from `/home/CATIAA/Engine/` without copying engine source into Music.

---

## 1. Engine Audit

### DB Engine
```
Package: @homelab/db-engine
Location: /home/CATIAA/Engine/db-engine/
Status: NOT CONSUMED BY MAIN WEB
Main Web uses: better-sqlite3 directly
Music uses: better-sqlite3 directly (same pattern as Main Web)
```

**Decision**: Music follows Main Web's architecture and uses `better-sqlite3` directly. The `@homelab/db-engine` package exists but is not consumed by either Main Web or Music. Music's `db.js` contains custom persistence logic (FTS rebuild workers, schema migrations, deferred init) that is not compatible with db-engine's simpler API. No wiring performed.

### Media Engine
```
Package: @homelab/media-engine
Location: /home/CATIAA/Engine/media-engine/
Status: WIRED
Consumer: Music Backend
Resolution: file:../../Engine/media-engine (symlinked in node_modules/@homelab/)
```

**Decision**: Media Engine is already wired. Music backend imports `MediaEngine`, `MediaScanner`, and visibility utilities from `@homelab/media-engine`. This matches Main Web's consumption pattern.

### Sync Engine
```
Package: @homelab/sync-engine
Location: /home/CATIAA/Engine/sync-engine/
Status: NOT USED
Consumer: None in Music
```

**Decision**: Sync Engine is NOT USED by Music. All sync engine code was removed in Phase 14.3. Music does not have any A/V sync, video playback, or MV functionality requiring sync engine. No dependency added.

---

## 2. Wiring Changes

### Files Modified
- `backend/package.json` — Already contains `@homelab/media-engine: "file:/home/CATIAA/Engine/media-engine"` (from Phase 14.2)
- No new wiring changes required

### Package Resolution
```
Music Backend
  ├── @homelab/media-engine → /home/CATIAA/Engine/media-engine/ (via file: symlink)
  ├── better-sqlite3 → direct dependency (following Main Web pattern)
  └── Other dependencies: express, busboy, compression, cors, etc.
```

---

## 3. Removed Local Engine Copies

No local engine copies exist in Music:
- ❌ `frontend/src/sync-engine/` — removed in Phase 14.3
- ❌ `backend/src/sync-engine/` — never existed
- ❌ `frontend/src/engines/syncEngine.js` — removed in Phase 14.3
- ❌ Copied db-engine — never existed
- ❌ Copied media-engine — never existed

**Remaining local engine code**:
- `frontend/src/engines/audioEngine.js` — Music-specific audio playback logic, NOT a copy of external engine

---

## 4. Package Dependencies

### Backend (`backend/package.json`)
```json
{
  "dependencies": {
    "@homelab/media-engine": "file:/home/CATIAA/Engine/media-engine",
    "better-sqlite3": "^12.9.0",
    "busboy": "^1.6.0",
    "compression": "^1.8.1",
    "cors": "^2.8.5",
    "express": "^4.21.0",
    "fast-xml-parser": "^5.8.0",
    "music-metadata": "^10.6.0",
    "node-fetch": "^3.3.2",
    "ws": "^8.21.0"
  }
}
```

### Frontend (`frontend/package.json`)
```json
{
  "dependencies": {
    "framer-motion": "^12.40.0",
    "hls.js": "^1.5.17",
    "lucide-react": "^1.16.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-intersection-observer": "^9.16.0",
    "react-markdown": "^10.1.0",
    "react-router-dom": "^7.15.1",
    "react-virtualized-auto-sizer": "^1.0.26",
    "react-window": "^1.8.11",
    "recharts": "^3.8.1",
    "rehype-highlight": "^7.0.2",
    "remark-gfm": "^4.0.1",
    "tailwindcss-animate": "^1.0.7",
    "zustand": "^5.0.13"
  }
}
```

---

## 5. Sync Engine Decision

**NOT USED**

Reason:
- All sync engine code was removed in Phase 14.3 aggressive cleanup
- Music currently does not have A/V sync, video playback, or MV functionality
- No sync-related imports or references remain in the codebase
- Main Web also does not consume `@homelab/sync-engine`
- Adding sync engine would require re-implementing frontend video sync infrastructure that was intentionally removed

---

## 6. Main Web Leakage

**NONE**

No runtime dependencies on Main Web source code. All imports reference:
- Local Music packages (`./`, `../`)
- External engine packages (`@homelab/media-engine`)
- Standard npm dependencies

---

## 7. Build Verification

```
pnpm install: PASS
pnpm build: PASS
  ✓ 1963 modules transformed
  ✓ built in 8.34s
  dist/assets/index-CoMJZrUf.js       464.99 kB
```

---

## 8. Startup Verification

```
Port 4000: PASS
Health: PASS ({"status":"ok","uptime":3.92})
Server: Running http://0.0.0.0:4000
DB: /home/CATIAA/WEB/Music/backend/data/media.db
Media roots: /home/CATIAA/homelab, /home/CATIAA/Music
```

---

## 9. Architecture Diagram

```
/home/CATIAA/
├── Engine/
│   ├── db-engine/          (not consumed by Music or Main Web)
│   ├── media-engine/       (consumed by Music via file: symlink)
│   └── sync-engine/        (not consumed by Music)
│
├── WEB/
│   └── Music/
│       ├── frontend/
│       │   └── src/
│       │       ├── engines/audioEngine.js  (Music-specific)
│       │       ├── music/
│       │       ├── shared/
│       │       ├── store/
│       │       └── utils/
│       │
│       └── backend/
│           └── src/
│               ├── db.js                  (better-sqlite3 direct, Main Web pattern)
│               ├── server.js
│               ├── routes/
│               ├── utils/
│               └── repository/
│
└── homelab-media-server/  (reference implementation, untouched)
```

### Data Flow
```
Browser :4000
  ↓
Music Backend
  ↓
  ├── @homelab/media-engine → /home/CATIAA/Engine/media-engine/
  │     ├── MediaEngine (media gateway, path resolver, visibility)
  │     └── MediaScanner (file system scanner)
  │
  ├── better-sqlite3 (direct, following Main Web pattern)
  │     └── SQLite DB at backend/data/media.db
  │
  └── Express routes (files, playlists, metadata, listening, thumbnails, video-cache)
```

---

## 10. Remaining Issues

None. Architecture is clean:
- No copied engines
- No Main Web runtime dependency
- Media Engine properly wired
- Build passes
- Server starts on port 4000
- Health endpoint responds
