import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Bell, X, Heart, SlidersHorizontal, CheckSquare, Trash2, Menu, Search } from 'lucide-react';
import { fetchFolder, fetchFileById, clearResponseCache, toggleFavorite, fetchPlaylistPlay } from '../utils/api';
import { loadFavorites } from '../utils/playlistApi';
import { safeParseTrackFilter, safeParseTrackSearchQuery, applyTrackFilter, applyTrackSearch } from '../utils/trackFilter';
import { cancelAutoPlayPending } from '../utils/autoPlayPending';

let hasRestoredFromSnapshot = false;
import MusicLayout from '../music/MusicLayout';
import MusicPlayer from '../music/Music';
import MiniPlayer from '../music/MiniPlayer';
import ServiceStoppedBanner from '../shared/ServiceStoppedBanner';
import FilterPanel from '../music/FilterPanel';
import { useToast } from '../shared/Toast';
import usePlaybackStore from '../store/playbackStore';
import useFavoritesStore from '../store/favoritesStore';
import usePlaylistStore from '../store/playlistStore';
import { applySink, getStoredDevice } from '../utils/audioOutput';
import { getAudioEngine } from '../engines/audioEngine';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { parseHash, LOVED_PLAYLIST_ID } from '../utils/routeParser';
import { listeningTracker } from '../utils/listeningTracker.js';

function safeParseTrackSort() {
  try {
    const s = JSON.parse(localStorage.getItem('trackSort') || '{}');
    if (s && typeof s === 'object' && s.by) return { by: s.by, order: s.order || 'asc' };
  } catch { /* ignore */ }
  return { by: null, order: 'asc' };
}

export default function App() {
  const [view, setView] = useState(() => {
    const initialRoute = parseHash(window.location.hash, sessionStorage);
    if (initialRoute.type === 'playlists' || initialRoute.type === 'playlist-detail' || initialRoute.type === 'root') return 'playlists';
    return 'audio';
  });

  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  const [playlistQueue, setPlaylistQueue] = useState(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [playlistMetadata, setPlaylistMetadata] = useState(null);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [panelFilterType, setPanelFilterType] = useState('all');
  const [panelSortBy, setPanelSortBy] = useState(null);
  const [panelSortOrder, setPanelSortOrder] = useState('asc');
  const [menuSidebarOpen, setMenuSidebarOpen] = useState(false);

  const playlistQueueRef = useRef(playlistQueue);
  const playlistMetadataRef = useRef(playlistMetadata);
  useEffect(() => { playlistQueueRef.current = playlistQueue; }, [playlistQueue]);
  useEffect(() => { playlistMetadataRef.current = playlistMetadata; }, [playlistMetadata]);

  const playerMode = usePlaybackStore(s => s.playerMode);
  const hasActivePlayback = usePlaybackStore(s => s.queue?.length > 0);
  const queue = usePlaybackStore(s => s.queue || []);
  const storeCurrentTrackIndex = usePlaybackStore(s => s.currentTrackIndex);
  const setAudioRef = usePlaybackStore(s => s.setAudioRef);
  const [audioReady, setAudioReady] = useState(false);
  const sharedAudioRef = useRef(null);
  const sharedPrevFileIdRef = useRef(null);

  const { toasts: appToasts, showToast, removeToast } = useToast();

  const syncAudioUrl = useCallback((newIndex) => {
    const st = usePlaybackStore.getState();
    const q = st.queue;
    const meta = playlistMetadata;
    const idx = (newIndex != null ? newIndex : st.currentTrackIndex) ?? 0;
    let playlistId = meta?.id;
    if (!playlistId) {
      const m = window.location.hash.match(/#\/music\/playlists\/([^/]+)/);
      if (m) playlistId = m[1];
    }
    if (playlistId) {
      const currentTrack = q?.[idx];
      const fid = currentTrack?.file_id || currentTrack?.id;
      const url = fid ? `#/music/playlists/${playlistId}/track/${fid}` : `#/music/playlists/${playlistId}`;
      if (window.location.hash !== url) {
        history.replaceState({ view: 'audio', playlistId, trackFileId: fid || null }, '', url);
      }
    } else {
      const hash = window.location.hash;
      if (!hash.startsWith('#/music/player') && !hash.startsWith('#/music/playlists')) {
        const url = '#/music/player';
        if (hash !== url) history.replaceState({ view: 'audio' }, '', url);
      }
    }
  }, [playlistMetadata]);

  useEffect(() => {
    const audio = getAudioEngine().getElement();
    if (!audio) return;
    sharedAudioRef.current = audio;
    setAudioRef(audio);
    setAudioReady(true);

    const onTrackEnded = () => syncAudioUrl();
    getAudioEngine().on('trackEnded', onTrackEnded);
    return () => getAudioEngine().off('trackEnded', onTrackEnded);
  }, [setAudioRef, syncAudioUrl]);

  useEffect(() => {
    const saveSnapshot = () => {
      try {
        const audio = getAudioEngine().getElement();
        const store = usePlaybackStore.getState();
        const meta = playlistMetadataRef.current;
        const sanitizedMeta = meta
          ? (typeof meta.image === 'string' && meta.image.startsWith('data:')
              ? { ...meta, image: null }
              : meta)
          : meta;

        const snapshot = {
          queue: store.queue,
          currentTrackIndex: store.currentTrackIndex,
          activePlaybackId: store.activePlaybackId,
          position: audio ? audio.currentTime : store.position,
          wasPlaying: audio ? !audio.paused : store.isPlaying,
          playlistQueue: playlistQueueRef.current,
          playlistMetadata: sanitizedMeta,
        };

        try {
          sessionStorage.setItem('audioReloadResumeAt', String(Date.now() + 2000));
          sessionStorage.setItem('audioReloadWasPlaying', String(snapshot.wasPlaying));
        } catch { /* ignore quota */ }

        try {
          sessionStorage.setItem('playbackResumeSnapshot', JSON.stringify(snapshot));
        } catch (e) {
          try {
            const current = store.queue?.[store.currentTrackIndex] ?? null;
            sessionStorage.setItem('playbackResumeSnapshot', JSON.stringify({
              queue: current ? [current] : [],
              currentTrackIndex: current ? 0 : store.currentTrackIndex,
              activePlaybackId: store.activePlaybackId,
              position: audio ? audio.currentTime : store.position,
              wasPlaying: false,
              playlistQueue: null,
              playlistMetadata: null,
            }));
          } catch (e2) {
            console.error('[saveSnapshot] compact quota/write error:', e2);
          }
        }
      } catch (e) {
        console.error('[saveSnapshot] Error:', e);
      }
    };

    const timer = setInterval(saveSnapshot, 5000);
    window.addEventListener('beforeunload', saveSnapshot);
    window.addEventListener('pagehide', saveSnapshot);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveSnapshot();
    });
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', saveSnapshot);
      window.removeEventListener('pagehide', saveSnapshot);
      document.removeEventListener('visibilitychange', saveSnapshot);
    };
  }, []);

  useEffect(() => {
    if (hasRestoredFromSnapshot) return;
    (async () => {
      try {
        const raw = sessionStorage.getItem('playbackResumeSnapshot');
        if (raw) {
          const snapshot = JSON.parse(raw);
          const store = usePlaybackStore.getState();
          if (snapshot.queue?.length > 0) {
            store.setQueue(snapshot.queue, snapshot.currentTrackIndex);
            store.setActiveFile(snapshot.activePlaybackId);
            store.setPosition(snapshot.position);
            const restoredMeta = snapshot.playlistMetadata;
            if (restoredMeta) {
              store.setActivePlaylist(restoredMeta.id ?? restoredMeta._id ?? null, restoredMeta, snapshot.queue);
            }
            store.pause();
            setPlaylistQueue(snapshot.playlistQueue);
            setPlaylistMetadata(snapshot.playlistMetadata);
          }
          sessionStorage.setItem('audioReloadWasPlaying', String(snapshot.wasPlaying));
          sessionStorage.setItem('audioReloadResumeAt', String(Date.now() + 2000));
          sessionStorage.removeItem('playbackResumeSnapshot');
          sessionStorage.removeItem('audioReloadPosition');
          hasRestoredFromSnapshot = true;
        }
      } catch (e) {
        console.error('[mount effect] Failed to restore snapshot:', e);
      }
    })();
  }, []);

  useEffect(() => {
    const nav = performance.getEntriesByType?.('navigation')?.[0];
    const isReload = nav?.type === 'reload' || performance.navigation?.type === 1;
    if (!isReload) return;
    const wasPlaying = sessionStorage.getItem('audioReloadWasPlaying') === 'true';
    const timer = setTimeout(() => {
      if (wasPlaying) {
        usePlaybackStore.getState().play();
      }
      sessionStorage.removeItem('audioReloadWasPlaying');
      sessionStorage.removeItem('audioReloadResumeAt');
      window.dispatchEvent(new CustomEvent('audio-reload-resume'));
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const initialRoute = parseHash(window.location.hash, sessionStorage);
    if (initialRoute.type === 'playlists' || initialRoute.type === 'playlist-detail' || initialRoute.type === 'root') {
      setView('playlists');
      return;
    }
    if (initialRoute.type === 'audio') {
      setView('audio');
      const st = usePlaybackStore.getState();
      if ((initialRoute.playlistId || initialRoute.fileId) && (!st.queue || st.queue.length === 0)) {
        (async () => {
          try {
            if (initialRoute.playlistId) {
              const data = await fetchPlaylistPlay(initialRoute.playlistId);
              if (data?.queue?.length) {
                const idx = initialRoute.trackFileId ? data.queue.findIndex(t => String(t.file_id || t.id) === String(initialRoute.trackFileId)) : -1;
                const resolved = idx >= 0 ? idx : 0;
                setPlaylistQueue(data.queue);
                setPlaylistMetadata(data.playlist);
                setCurrentTrackIndex(resolved);
                st.setQueue(data.queue, resolved);
              }
            } else if (initialRoute.fileId) {
              const file = await fetchFileById(initialRoute.fileId);
              if (file) {
                const queue = [{ file_id: file.id, title: file.display_name || file.name, artist: file.artist || '', album: file.album || '', duration: file.duration || 0, path: file.path, exists: true, type: file.type || 'audio' }];
                setPlaylistQueue(queue);
                st.setQueue(queue, 0);
              }
            }
          } catch (e) { console.error('[App] audio route restore failed:', e); }
        })();
      }
      return;
    }
    setView('audio');
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const route = parseHash(window.location.hash, sessionStorage);
        if (route.type === 'playlists' || route.type === 'playlist-detail' || route.type === 'root') {
         if (viewRef.current === 'audio') {
           getAudioEngine().pause();
           sharedPrevFileIdRef.current = null;
           cancelAutoPlayPending();
           usePlaybackStore.getState().clearPlayback();
           usePlaylistStore.getState().clearPlaylistDetail();
         }
         setView('playlists');
         return;
       }
      if (route.type === 'audio') {
        setView('audio');
        return;
      }
      setView('playlists');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleToggleFavorite = useCallback(async (item) => {
    if (!item?.id) return;
    const favStore = useFavoritesStore.getState();
    const currentStored = favStore.map[item.id];
    const fallback = item.is_favorite ? 1 : 0;
    const currentFav = currentStored !== undefined ? currentStored : fallback;
    const optimisticFav = currentFav === 1 ? 0 : 1;
    favStore.set(item.id, optimisticFav);
    try {
      const result = await toggleFavorite(item.id);
      favStore.set(item.id, result.is_favorite);
      const pStore = usePlaybackStore.getState();
      if (pStore.queue && pStore.queue.length > 0) {
        const newQueue = pStore.queue.map(t =>
          (t.file_id === item.id || t.id === item.id)
            ? { ...t, is_favorite: result.is_favorite }
            : t
        );
        pStore.setQueue(newQueue, pStore.currentTrackIndex);
      }
      setPlaylistQueue(prev => {
        if (!prev || prev.length === 0) return prev;
        return prev.map(t =>
          (t.file_id === item.id || t.id === item.id)
            ? { ...t, is_favorite: result.is_favorite }
            : t
        );
      });
    } catch (err) {
      favStore.set(item.id, currentFav);
      console.error('[App] Failed to toggle favorite:', err);
    }
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      const target = e.target;
      const isTyping = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      if (isTyping) return;

      if (e.key === ' ' || e.code === 'Space') {
        if (viewRef.current === 'audio') {
          e.preventDefault();
          e.stopPropagation();
          const engine = getAudioEngine();
          try {
            if (engine.getElement()?.paused) {
              engine.play().catch(() => {});
              usePlaybackStore.getState().play();
            } else {
              engine.pause();
              usePlaybackStore.getState().pause();
            }
          } catch {}
        }
        return;
      }

      if (e.key === 'l' || e.key === 'L') {
        const pStore = usePlaybackStore.getState();
        const track = pStore.queue?.[pStore.currentTrackIndex];
        const item = track;
        if (item?.id) handleToggleFavorite(item);
        return;
      }

      if (e.key === 'm' || e.key === 'M') {
        if (e.repeat) return;
        e.preventDefault();
        e.stopPropagation();
        if (viewRef.current === 'audio') {
          window.dispatchEvent(new Event('music-skip-next'));
        }
        return;
      }

      if (e.key === 'n' || e.key === 'N') {
        if (e.repeat) return;
        e.preventDefault();
        e.stopPropagation();
        if (viewRef.current === 'audio') {
          window.dispatchEvent(new Event('music-skip-prev'));
        }
        return;
      }

      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        e.stopPropagation();
        const pStore = usePlaybackStore.getState();
        pStore.setShuffle(!pStore.shuffle);
        return;
      }

      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        e.stopPropagation();
        const pStore = usePlaybackStore.getState();
        const modes = ['off', 'all', 'one'];
        const idx = modes.indexOf(pStore.loopMode);
        const next = modes[(idx + 1) % modes.length];
        pStore.setLoopMode(next);
        return;
      }

      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        e.stopPropagation();
        const engine = getAudioEngine();
        const ct = engine.getElement()?.currentTime || 0;
        engine.seek(Math.max(0, ct - 5));
        return;
      }

      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        e.stopPropagation();
        const engine = getAudioEngine();
        const ct = engine.getElement()?.currentTime || 0;
        const dur = engine.getElement()?.duration || 0;
        engine.seek(Math.min(dur, ct + 5));
        return;
      }
    };
    document.addEventListener('keydown', handleKey, { capture: true });
    return () => document.removeEventListener('keydown', handleKey, { capture: true });
  }, [handleToggleFavorite]);

  const handleTrackIndexChange = useCallback((newIndex) => {
    setCurrentTrackIndex(newIndex);
    syncAudioUrl(newIndex);
  }, [syncAudioUrl]);

  const handleCloseAudioPlayer = useCallback(() => {
    getAudioEngine().pause();
    sharedPrevFileIdRef.current = null;
    cancelAutoPlayPending();
    usePlaybackStore.getState().clearPlayback();
    usePlaylistStore.getState().clearPlaylistDetail();
    sessionStorage.removeItem('playlistQueue');
    sessionStorage.removeItem('playlistMetadata');
    sessionStorage.removeItem('currentTrackIndex');
    setPlaylistQueue(null);
    setPlaylistMetadata(null);
    setCurrentTrackIndex(0);
    const meta = playlistMetadata;
    const playlistId = meta?.id;
    if (playlistId) {
      sessionStorage.setItem('selectedPlaylistId', playlistId);
      setView('playlists');
      const url = `#/music/playlists/${playlistId}`;
      if (window.location.hash !== url) {
        history.replaceState({ view: 'playlists', playlistId }, '', url);
      }
    } else {
      setView('playlists');
      const url = '#/music';
      if (window.location.hash !== url) {
        history.replaceState({ view: 'playlists' }, '', url);
      }
    }
  }, [playlistMetadata]);

  const expandToAudio = useCallback(() => {
    setView('audio');
    const meta = playlistMetadata;
    const playlistId = meta?.id;
    const st = usePlaybackStore.getState();
    const currentTrack = st.queue?.[st.currentTrackIndex];
    const currentFileId = currentTrack?.file_id || currentTrack?.id;
    if (playlistId) {
      const url = currentFileId ? `#/music/playlists/${playlistId}/track/${currentFileId}` : `#/music/playlists/${playlistId}`;
      if (window.location.hash !== url) {
        history.pushState({ view: 'audio', playlistId, trackFileId: currentFileId || null }, '', url);
      }
    } else if (currentFileId) {
      const url = `#/music/single/${currentFileId}`;
      if (window.location.hash !== url) {
        history.pushState({ view: 'audio', fileId: currentFileId }, '', url);
      }
    } else {
      const url = '#/music/player';
      if (window.location.hash !== url) {
        history.pushState({ view: 'audio' }, '', url);
      }
    }
  }, [playlistMetadata]);

  const handleDeletePlaylist = useCallback(async (playlistId) => {
    if (!playlistId) return;
    if (window.confirm('Apakah Anda yakin ingin menghapus playlist ini?')) {
      try {
        await deletePlaylist(playlistId);
        showToast('Playlist deleted', 'success');
        usePlaylistStore.getState().removePlaylist(playlistId);
        if (playlistMetadata?.id === playlistId) {
          setView('playlists');
          setPlaylistMetadata(null);
          setPlaylistQueue([]);
          setCurrentTrackIndex(0);
        }
      } catch (err) {
        console.error('Failed to delete playlist:', err);
        showToast('Gagal menghapus playlist', 'error');
      }
    }
  }, [playlistMetadata, showToast]);

  return (
    <ErrorBoundary title="Something went wrong" reloadLabel="Reload">
      <div
        className="h-screen flex flex-col bg-black"
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={(e) => e.preventDefault()}
        onDragLeave={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        {(view === 'playlists' || view === 'audio') && menuSidebarOpen && (
          <>
            <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setMenuSidebarOpen(false)} />
            <div className="absolute inset-y-0 left-3 z-50 w-64 flex-shrink-0 bg-neutral-900 rounded-r-2xl border border-neutral-800 border-l-0 overflow-hidden flex flex-col shadow-2xl">
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 flex-shrink-0">
                <span className="text-sm font-semibold text-neutral-200">Menu</span>
                <button onClick={() => setMenuSidebarOpen(false)} className="p-1 rounded-lg text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
              <nav className="p-2 space-y-1 overflow-y-auto flex-1 min-h-0">
                <button
                  onClick={() => { setView('playlists'); setMenuSidebarOpen(false); history.pushState({ view: 'playlists' }, '', '#/music'); }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${view === 'playlists' ? 'text-sky-400 bg-sky-500/10 font-medium' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'}`}
                >
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                  Music
                </button>
              </nav>
            </div>
          </>
        )}

        <div className="flex-1 flex overflow-hidden relative gap-8">
          {(view === 'playlists' || view === 'audio') && (
            <div className="flex-1 flex flex-col overflow-hidden relative">
              <div className="flex-1 overflow-hidden" style={{ display: view === 'audio' ? 'none' : 'flex', flexDirection: 'column' }}>
                <MusicLayout
                  onMenuOpen={() => setMenuSidebarOpen(true)}
                  menuSidebarOpen={menuSidebarOpen}
                  setMenuSidebarOpen={setMenuSidebarOpen}
                  onPlayPlaylist={async (data) => {
                    cancelAutoPlayPending();
                    usePlaybackStore.getState().clearPlayback();
                    sharedPrevFileIdRef.current = null;
                    usePlaybackStore.getState().setQueue(data.queue, 0);
                    usePlaybackStore.getState().setActivePlaylist(data.playlist?.id ?? data.playlist?._id ?? null, data.playlist, data.queue);
                    usePlaybackStore.getState().play();
                    setPlaylistQueue(data.queue);
                    setPlaylistMetadata(data.playlist);
                    setCurrentTrackIndex(0);
                    showToast(`Playing: ${data.playlist.title}`, 'success');
                  }}
                  onPlayTrack={(file, fullQueue, clickedIdx, playlist) => {
                    if (!file?.file_id && !file?.id) return;
                    if (!playlist) {
                      setView('audio');
                    }
                    cancelAutoPlayPending();
                    usePlaybackStore.getState().clearPlayback();
                    sharedPrevFileIdRef.current = null;
                    const queue = fullQueue && fullQueue.length > 0 ? fullQueue : [{
                      file_id: file.file_id || file.id,
                      track_index: 0,
                      title: file.display_name || file.displayName || file.name?.replace(/\.[^/.]+$/, ''),
                      artist: file.artist || '',
                      album: file.album || '',
                      duration: file.duration || 0,
                      path: file.resolved_path || file.path || (file.dir_path ? `${file.dir_path}/${file.name}` : file.name),
                      exists: true,
                      name: file.display_name || file.name,
                      type: file.type || 'audio',
                    }];
                    const trackIdx = clickedIdx != null ? clickedIdx : 0;
                    usePlaybackStore.getState().setQueue(queue, trackIdx);
                    usePlaybackStore.getState().setCurrentTrackIndex(trackIdx);
                    usePlaybackStore.getState().play();
                    setPlaylistQueue(queue);
                    setPlaylistMetadata(playlist || { title: file.display_name || file.name, creator: '' });
                    setCurrentTrackIndex(trackIdx);
                    showToast(`Playing: ${file.display_name || file.name}`, 'success');
                  }}
                  onDeletePlaylist={handleDeletePlaylist}
                  onBackToPlaylistList={() => {
                    setPlaylistQueue(null);
                    setPlaylistMetadata(null);
                    setCurrentTrackIndex(0);
                    sessionStorage.removeItem('playlistQueue');
                    sessionStorage.removeItem('playlistMetadata');
                    sessionStorage.removeItem('currentTrackIndex');
                  }}
                />
              </div>
              <div className="flex-1 flex overflow-hidden animate-in fade-in duration-300" style={{ display: view === 'audio' ? 'flex' : 'none' }}>
                <MusicPlayer
                  file={null}
                  favoriteOnly={favoriteOnly}
                  onClose={handleCloseAudioPlayer}
                    onMinimize={() => {
                      const playlistId = playlistMetadata?.id;
                      usePlaylistStore.getState().clearPlaylistDetail();
                      if (playlistId) {
                        sessionStorage.setItem('selectedPlaylistId', playlistId);
                        setView('playlists');
                        const url = `#/music/playlists/${playlistId}`;
                        if (window.location.hash !== url) {
                          history.replaceState({ view: 'playlists', playlistId }, '', url);
                        }
                      } else {
                        setView('playlists');
                        const url = '#/music';
                        if (window.location.hash !== url) {
                          history.replaceState({ view: 'playlists' }, '', url);
                        }
                      }
                    }}
                  playlistQueue={playlistQueue}
                  currentTrackIndex={currentTrackIndex}
                  playlistTitle={playlistMetadata?.title || null}
                  trackSort={safeParseTrackSort()}
                  onTrackIndexChange={handleTrackIndexChange}
                  onFavoriteToggle={handleToggleFavorite}
                  sharedAudioRef={sharedAudioRef}
                  sharedPrevFileIdRef={sharedPrevFileIdRef}
                  audioReady={audioReady}
                  folderFiles={[]}
                />
              </div>
            </div>
          )}
        </div>

        <FilterPanel
          open={showFilterPanel}
          onClose={() => setShowFilterPanel(false)}
          title="Filters"
          filterTypeOptions={[
            { key: 'all', label: 'All' },
            { key: 'love', label: 'Love' },
            { key: 'audio', label: 'Audio' },
          ]}
          filterType={panelFilterType}
          onFilterTypeChange={setPanelFilterType}
          sortOptions={[
            { key: null, label: 'None' },
            { key: 'name', label: 'Name' },
            { key: 'mtime', label: 'Modified' },
            { key: 'created_at', label: 'Created' },
            { key: 'size', label: 'Size' },
            { key: 'duration', label: 'Duration' },
          ]}
          sortBy={panelSortBy}
          sortOrder={panelSortOrder}
          onApply={async (newSortBy, newSortOrder) => {
            clearResponseCache();
            const path = '/';
            setPanelFilterType(panelFilterType);
            setPanelSortBy(newSortBy);
            setPanelSortOrder(newSortOrder);
          }}
        />

        {hasActivePlayback && view !== 'audio' && (
          <MiniPlayer view={view} onExpand={expandToAudio} sharedAudioRef={sharedAudioRef} sharedPrevFileIdRef={sharedPrevFileIdRef} audioReady={audioReady} onFavoriteToggle={handleToggleFavorite} onClose={() => {
            cancelAutoPlayPending();
            usePlaybackStore.getState().clearPlayback();
          }} />
        )}
      </div>
    </ErrorBoundary>
  );
}
