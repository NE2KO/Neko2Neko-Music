# MUSIC STANDALONE EXTRACTION REPORT

## Phase 14.2 — Backend Dependency Closure & Pruning
## Phase 14.3 — Aggressive Cleanup

## 1. Target Path
`/home/CATIAA/WEB/Music`

## 2. Source
`/home/CATIAA/homelab-media-server/.kilo/worktrees/homelab-media-server/frontend/`

## 3. Files Adopted

### Music Components (29 files)
- Music.jsx
- PlaylistView.jsx
- MusicLayout.jsx
- NowPlayingPanel.jsx
- MiniPlayer.jsx
- PlaylistBackdrop.jsx
- PlaylistLeftModule.jsx
- PlaylistMiddleModule.jsx
- PlaylistRightModule.jsx
- PlaylistRow.jsx
- PlaylistListRow.jsx
- PlaylistListItemRow.jsx
- PlaylistTrackGridInner.jsx
- PlaylistGridCard.jsx
- PlaylistSidebar.jsx
- QueuePanel.jsx
- LeaderboardPanel.jsx
- AddMusicPanel.jsx
- FilterPanel.jsx
- HeaderComponents.jsx
- CachedVideoPlayer.jsx
- LyricsDisplay.jsx
- LyricsEditor.jsx
- LyricsScrollController.js
- MetadataEditor.jsx
- CoverArtSearch.jsx
- CropTool.jsx
- SpeakerOutputButton.jsx
- SyncOverlay.jsx

### Shared Components (11 files)
- Carousel.jsx
- MediaControls.jsx
- NetworkImage.jsx
- Toast.jsx
- ErrorBoundary.jsx
- GroupDivider.jsx
- ConfirmModal.jsx
- ServiceStoppedBanner.jsx
- DebugProvider.jsx (simplified stub)
- DebugTooltip.jsx
- useDebugStore.js

### Utilities (20 files)
- audioOutput.js
- trackFilter.js
- listeningTracker.js
- playlistApi.js
- playlistQueue.js
- routeParser.js (Music routes only)
- format.js
- miniContinuity.js
- autoPlayPending.js
- lrcParser.js
- filenameSearch.js
- playlistWindow.js
- grouping.js
- pageCache.js
- resourceManager.js
- thumbCache.js
- workerPool.js
- mediaWorker.js
- mediaRepository.js
- api.js (Music/playlist subset only)

### Stores (3 files)
- playbackStore.js
- playlistStore.js
- favoritesStore.js

### Engines (1 file)
- audioEngine.js

### Sync Engine (36 files)
- syncCore.js
- videoSyncEngine.js
- trackProfileStore.js
- trackSyncProfile.js
- syncHelpers.js
- syncTelemetry.js
- syncVerification.js
- TriangleCalculator.js
- transientDetector.js
- memory/ (8 files)
- decision/ (4 files)
- analyzers/ (6 files)
- sensor/ (2 files)
- syncCapture/ (1 file)
- syncVerification/ (1 file)
- validation/ (2 files)
- replay/ (1 file)

### CSS (4 files)
- index.css
- theme.js
- PlaylistView.css
- SyncOverlay.css
- MediaControls.css

### Icons (6 files)
- icons/* (all icon components)

## 4. Shared Dependencies Adopted
- Carousel.jsx
- MediaControls.jsx + MediaControls.css
- NetworkImage.jsx
- Toast.jsx
- ErrorBoundary.jsx
- GroupDivider.jsx
- ConfirmModal.jsx
- ServiceStoppedBanner.jsx
- format.js
- grouping.js
- pageCache.js
- resourceManager.js
- thumbCache.js
- workerPool.js
- mediaWorker.js
- mediaRepository.js
- playbackStore.js
- favoritesStore.js
- icons/*

## 5. Engines Wired
- Audio Engine: `src/engines/audioEngine.js`
- Sync Engine: `src/sync-engine/` (all files)

## 6. API Dependencies
- `fetchFolder` - folder listing
- `fetchFileById` - file metadata
- `fetchPlaylists` - playlist list
- `fetchPlaylistById` - playlist detail
- `fetchPlaylistPlay` - playlist queue
- `scanPlaylists` - scan playlists
- `refreshPlaylist` - refresh playlist
- `deletePlaylist` - delete playlist
- `createManualPlaylist` - create manual playlist
- `createFolderPlaylist` - create folder playlist
- `importXSPFPlaylist` - import XSPF
- `toggleFavorite` - toggle favorite
- `getThumbnailUrl` - thumbnail URL builder
- `clearResponseCache` - clear API cache

## 7. Package Dependencies
- react, react-dom
- react-router-dom
- zustand
- lucide-react
- react-window
- react-virtualized-auto-sizer
- framer-motion
- recharts
- hls.js
- react-markdown
- rehype-highlight
- remark-gfm
- react-intersection-observer
- tailwindcss-animate
- vite, @vitejs/plugin-react
- tailwindcss, postcss, autoprefixer

## 8. Main Web Dependencies Removed
- MonitoringView.jsx
- AdbTransfer.jsx
- GitView.jsx
- ScrcpyView.jsx
- SendQueueView.jsx
- WhatsAppView.jsx
- MediaGrid.jsx
- MediaModal.jsx
- VaultAudioPlayer.jsx
- VideoPlayer.jsx
- ImageViewer.jsx
- MediaLayout.jsx
- VaultActionBar.jsx
- VaultBottomCluster.jsx
- SendProgressPills.jsx
- SendStatusPill.jsx
- QueueActionBar.jsx
- WaSendPopover.jsx
- RescheduleModal.jsx
- UploadsMonitor.jsx
- CaptionEditorModal.jsx
- DuplicateConfirmModal.jsx
- CarouselLockToggle.jsx
- folderSortStore.js
- folderMetaSortStore.js
- lockedStore.js
- adbApi.js
- All monitoring/** files
- All scrcpy endpoints
- All whatsapp endpoints
- All sendqueue endpoints
- All adb endpoints

## 9. Mixed Files Handling
- **api.js**: Created Music-specific subset. Kept only Music/playlist endpoints. Removed scrcpy, sendqueue, adb, whatsapp, telegram, bulk lock/delete, download endpoints.
- **routeParser.js**: Created Music-specific subset. Kept only audio, playlists, vault-audio routes. Removed monitoring, downloader, adb, scrcpy, whatsapp, sendqueue, media routes.

## 10. Build Result
**SUCCESS**
```
✓ 1997 modules transformed
✓ built in 10.12s
dist/index.html                       0.39 kB
dist/assets/index-DvmfPgz2.css       19.07 kB
dist/assets/source-map-B1l1Kl2Q.js   28.83 kB
dist/assets/index-CBUfd2sF.js       635.03 kB
```

## 11. Runtime Verification Result
**SUCCESS**
- Dev server starts successfully
- HTML entry point served correctly
- JS modules load without 404s
- No console errors during initial load

## 12. Leakage Audit Results
**CLEAN**
- No imports of MonitoringView, AdbTransfer, GitView, ScrcpyView, SendQueueView, WhatsAppView
- No imports of MediaGrid, MediaModal, VaultAudioPlayer, VideoPlayer, ImageViewer
- No imports of folderSortStore, folderMetaSortStore, lockedStore, adbApi
- No references to original Main Web paths
- Comments containing "MediaGrid", "VaultAudioPlayer" are harmless documentation references

## 13. Import Rewiring Summary
Rewired all imports from original Main Web paths to local Music paths:
- `../../utils/` → appropriate local `../utils/`, `../sync-engine/`
- `../store/` → `../store/`
- `./` local components → `./` or `../shared/` as appropriate
- Sync engine imports: `../utils/syncCore` → `../sync-engine/syncCore`
- Shared component imports: `./NetworkImage` → `../shared/NetworkImage`
- ServiceStoppedBanner import: `./ServiceStoppedBanner` → `../shared/ServiceStoppedBanner`

## 14. Remaining Warnings
1. **DebugProvider is a simplified stub** - The original DebugProvider imported monitoring stores and debug utilities that don't exist in Music. Replaced with a minimal passthrough.
2. **Chunk size warning** - The build output includes a 635KB JS chunk. This is expected for a full Music app with sync engine. Consider code-splitting for production optimization.
3. **useServiceControl is adopted** - ServiceStoppedBanner uses this hook for service control. Copied to Music hooks even though it's primarily a Main Web feature.

## 15. Cleanup Candidates
- `monitor/` directory — REMOVED in Phase 14.2 (17 files: engine, websocket, collectors, etc.)
- `utils/playbackEngine.js`, `utils/hlsGenerator.js`, `utils/avSync.js` — REMOVED in Phase 14.2
- `utils/uploadManager.js`, `utils/logCapture.js`, `utils/sessionTracker.js` — REMOVED in Phase 14.2
- `routes/stream.js` — REMOVED in Phase 14.2
- Unused icon components if any are not rendered by Music
- Consider extracting sync engine as separate package in future

## 16. Final Status (Phase 14.2)
**COMPLETE**

The standalone Music Web application has been successfully extracted at `/home/CATIAA/WEB/Music`. All Music-specific components, utilities, stores, and engines have been copied and rewired. The build succeeds and the dev server runs without errors.

---

## Phase 14.3 — Aggressive Cleanup

### Objective
Remove all non-Music code from `/home/CATIAA/WEB/Music/` to create a clean standalone Music product.

### Files Removed

#### Backend Files
- `src/syncUtils.js` — Sync verification utilities
- `src/routes/syncVerify.js` — Sync verification API endpoints

#### Frontend Code Removed (from existing files)
- `Music.jsx` — ~2600 lines of sync engine code removed (syncCore, mvEngine, bgEngine, CachedVideoPlayer, SyncOverlay, sensor/analyzer/memory/decision pipelines, telemetry, RVFC tracking)
- `MiniPlayer.jsx` — Sync engine imports and background video sync removed
- `NowPlayingPanel.jsx` — Sync engine imports and video sync effects removed
- `App.jsx` — `vault-audio` view handling removed
- `routeParser.js` — `vault-audio` route parsing removed
- `ServiceStoppedBanner.jsx` — Non-Music service configs removed

### Database Tables Removed (db.js)
18 non-Music tables removed:
- `send_counters`, `send_rate_limit`, `send_queue`, `send_settings`
- `telegram_allowed_chats`, `telegram_bot_tasks`, `telegram_task_link`, `telegram_ephemeral`, `telegram_processed`
- `telegram_audio_bot_tasks`, `telegram_audio_task_link`, `telegram_audio_ephemeral`, `telegram_audio_processed`
- `adb_transactions`, `adb_jobs`
- `conversations`, `messages`
- `ai_provider_status`, `ai_conversation_settings`, `ai_memories`, `ai_context_summaries`, `ai_pinned_messages`, `ai_model_preferences`
- `uploads`

63 prepared statements removed from `stmts` object.

### Settings Removed
Non-Music settings seeds removed from `deferredDbInit()`:
- All `monitor.*` settings
- All `downloader.*` settings
- All `ai.*` settings
- All `dashboard.*` settings
- All `alerts.*` settings
- All `retention.*` settings
- All `system.*` settings
- `whatsapp.*` settings
- `upload.*` settings

### Config Cleanup
- `config/paths.js` — Removed `downloader`, `logsDownloader`, `logsMonitoring` paths
- `utils/logger.js` — Removed `downloader` and `monitoring` log directory mappings

### Service Rename
- `mediaVault` → `music` across backend (server.js, serviceGuard.js, routes/services.js)

### User-Agent Updates
Updated from `MediaVault/1.0` to `Music/1.0` in:
- `utils/lrclib.js`
- `utils/coverSources.js`
- `utils/netease.js`
- `utils/genius.js`
- `utils/lrcmux.js`
- `utils/musicbrainz.js`

### Build Result
**SUCCESS**
```
✓ 1963 modules transformed
✓ built in 8.15s
dist/assets/index-CoMJZrUf.js       464.99 kB
```

### Remaining Source Files
- Frontend: ~70 JSX/JS source files
- Backend: ~43 JS source files

### Remaining Suspicious Items (benign)
- `Carousel.jsx` comment mentions "SendQueue" — harmless documentation reference
- `sqliteMediaRepository.js` comment mentions "monitor" — refers to scanner aggregation
- `resourceManager.js` `ioReadBytes` — generic I/O tracking used by scanner

---
