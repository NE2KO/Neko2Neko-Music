import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { VariableSizeList as List, FixedSizeList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { Music, Trash2, Plus, Upload, X, Check, ChevronDown, Shuffle, Heart, Image as ImageIcon, ListMusic, Play, Pause, Search, SlidersHorizontal, Grid, ArrowLeft, ChevronLeft, ChevronRight, Menu } from 'lucide-react';
import usePlaylistStore from '../store/playlistStore';
import usePlaybackStore from '../store/playbackStore';
import { loadPlaylists, loadPlaylist, getPlaylistQueue, refreshPlaylists, importXSPFPlaylist, createEmptyPlaylist, removeTrackFromPlaylist, bulkRemoveTracksFromPlaylist, loadFavorites, uploadPlaylistCover, playlistImageUrl } from '../utils/playlistApi';
import { deletePlaylist } from '../utils/api';
import { buildPlayableQueue, resolveClickedIndex } from '../utils/playlistQueue';
import { LOVED_PLAYLIST_ID } from '../utils/routeParser';
import { useToast } from '../shared/Toast';
import NetworkImage from '../shared/NetworkImage';
import PlaylistRow from './PlaylistRow';
import ServiceStoppedBanner from '../shared/ServiceStoppedBanner';
import PlaylistListRow, { injectPlaylistListRowStyles } from './PlaylistListRow';
import PlaylistListItemRow, { injectPlaylistListItemRowStyles } from './PlaylistListItemRow';
import AddMusicPanel from './AddMusicPanel';
import FilterPanel from './FilterPanel';
import { PlaylistListHeader, PlaylistDetailHeader } from './HeaderComponents';
import { listeningTracker, formatDuration as formatListeningDuration } from '../utils/listeningTracker.js';
import PlaylistLeftModule from './PlaylistLeftModule';
import PlaylistMiddleModule from './PlaylistMiddleModule';
import PlaylistRightModule from './PlaylistRightModule';


import './PlaylistView.css';

injectPlaylistListRowStyles();
injectPlaylistListItemRowStyles();

const API_BASE = import.meta.env.VITE_API_URL || '';

const TYPE_COLORS = {
  '.flac': 'text-yellow-400 bg-yellow-500/15',
  '.mp3': 'text-purple-400 bg-purple-500/15',
  '.m4a': 'text-pink-400 bg-pink-500/15',
  '.opus': 'text-slate-300 bg-slate-500/15',
  '.aac': 'text-green-400 bg-green-500/15',
  '.wav': 'text-cyan-400 bg-cyan-500/15',
};

const COLORS = {
  bg: {
    primary: '#0a0a0a',
    secondary: '#171717',
    tertiary: '#0a0a0a',
  },
  border: {
    primary: '#262626',
    secondary: '#404040',
  },
  text: {
    primary: '#e5e5e5',
    secondary: '#a3a3a3',
    tertiary: '#737373',
  },
  accent: '#0ea5e9',
};

const CONTAINER_MAX = 1600;
const MIN_CARD = 135;
const MAX_CARD = 165;
const MAX_COLUMNS = 10;
const GUTTER = 8;
const QUEUE_ITEM_HEIGHT = 46;

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTotalDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} jam ${m} menit`;
  if (m > 0) return `${m} menit ${sec} detik`;
  return `${sec} detik`;
}

// Lazily resolve a track's real duration by probing the audio stream metadata.
// Used as a fallback when the DB has no duration for a file. Only the metadata
// is fetched (preload='metadata'), so we don't download the whole file.
function loadAudioDuration(fileId) {
  return new Promise((resolve) => {
    try {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.src = `${API_BASE}/file/${fileId}`;
      let settled = false;
      const finish = (d) => {
        if (settled) return;
        settled = true;
        audio.removeAttribute('src');
        audio.load();
        resolve(d);
      };
      audio.addEventListener('loadedmetadata', () => {
        const d = audio.duration && isFinite(audio.duration) ? Math.round(audio.duration) : 0;
        finish(d);
      });
      audio.addEventListener('error', () => finish(0));
    } catch {
      resolve(0);
    }
  });
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ========== SPOTIFY-STYLE HERO HEADER ==========
const ctrlBtn = {
  height: 40, padding: '0 12px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13,
  transition: 'background .15s, border-color .15s',
};

function PlaylistHeroHeader({
  playlist, trackCount, totalDurationSeconds, onCoverChange, isLoved,
}) {
  const rawCover = isLoved ? null : playlistImageUrl(playlist);
  const cover = rawCover
    ? (rawCover.startsWith('/') && !rawCover.startsWith('//') ? `${API_BASE}${rawCover}` : rawCover)
    : null;
  const durationLabel = formatTotalDuration(totalDurationSeconds);
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{
          position: 'relative', width: 192, height: 192, flexShrink: 0, borderRadius: 8,
          overflow: 'hidden', background: 'linear-gradient(135deg,#989FF8,#76B2E7)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {cover ? (
            <img src={cover} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} />
          ) : isLoved ? (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#4f46e5,#db2777)' }}>
              <Heart size={70} color="#fff" fill="#fff" />
            </div>
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Music size={62} color="rgba(255,255,255,0.85)" />
            </div>
          )}
          {!isLoved && (
            <button
              onClick={onCoverChange}
              title="Ubah cover"
              style={{
                position: 'absolute', right: 8, bottom: 8, width: 34, height: 34, borderRadius: '50%',
                background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <ImageIcon size={16} />
            </button>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
            color: COLORS.text.secondary,
          }}>{isLoved ? 'Loved' : 'Playlist'}</div>
          <h1 style={{
            margin: '8px 0 0', fontSize: 'clamp(28px, 5vw, 48px)', fontWeight: 800, color: '#fff',
            lineHeight: 1.1, wordBreak: 'break-word',
          }}>{playlist?.title || ''}</h1>
          <div style={{ marginTop: 10, fontSize: 14, color: COLORS.text.secondary }}>
            {trackCount} lagu • {durationLabel}
          </div>
        </div>
      </div>
      {/* Action buttons moved to PlaylistToolbar (section 2) */}
    </div>
  );
}

function PlaylistToolbar({
  playlist, onPlay, onShuffle, onFilter, filterType, onToggleView, displayMode, onAdd, onEnterSelectMode,
}) {
  const playbackIsPlaying = usePlaybackStore(s => s.isPlaying);
  const playbackShuffle = usePlaybackStore(s => s.shuffle);
  const playbackPlaylistId = usePlaybackStore(s => s.playlistId);
  const isThisPlaylist = !!playlist && String(playbackPlaylistId) === String(playlist.id || playlist._id);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <button
        onClick={onPlay}
        title={isThisPlaylist && playbackIsPlaying ? 'Jeda' : 'Putar'}
        style={{
          width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg,#0EA5E9,#8892E6)', border: 'none',
          color: '#000', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 16px rgba(14,165,233,0.4)',
        }}
      >
        {isThisPlaylist && playbackIsPlaying
          ? <Pause size={24} fill="#000" />
          : <Play size={26} fill="#000" style={{ marginLeft: 3 }} />}
      </button>
      <button
        onClick={onShuffle}
        title={playbackShuffle ? 'Matikan Acak' : 'Acak'}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          width: 44, height: 44, borderRadius: 8,
          background: 'transparent',
          border: 'none',
          color: playbackShuffle ? '#8892E6' : '#fff', cursor: 'pointer',
        }}
      >
        <Shuffle size={20} />
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: playbackShuffle ? '#8892E6' : 'transparent',
        }} />
      </button>
      <div style={{ flex: 1 }} />
      <button
        onClick={onFilter}
        title="Filter"
        style={{
          ...ctrlBtn,
          ...(filterType !== 'all' ? { borderColor: 'rgba(56,189,248,0.5)', color: '#38bdf8' } : {}),
        }}
      >
        <SlidersHorizontal size={16} />
        <span className="hidden md:inline">Filter</span>
      </button>
      <button
        onClick={onToggleView}
        title="Ubah tampilan"
        style={ctrlBtn}
      >
        {displayMode === 'grid' ? <Grid size={16} /> : <ListMusic size={16} />}
        <span className="hidden md:inline">{displayMode === 'grid' ? 'Grid' : 'List'}</span>
      </button>
      <button
        onClick={onAdd}
        title="Tambah musik"
        style={{ ...ctrlBtn, background: 'linear-gradient(135deg,#0EA5E9,#8892E6)', borderColor: 'transparent', color: '#000' }}
      >
        <Plus size={16} />
        <span className="hidden md:inline">Tambah</span>
      </button>
      <button
        onClick={onEnterSelectMode}
        title="Pilih untuk dihapus"
        style={ctrlBtn}
      >
        <Check size={16} />
        <span className="hidden md:inline">Pilih</span>
      </button>
    </div>
  );
}
export default function PlaylistView({ onMenuOpen, onPlayPlaylist, onPlayTrack, onBackToPlaylistList, playerOpen = false, menuSidebarOpen, setMenuSidebarOpen, trackSearchQuery, setTrackSearchQuery }) {
  const { playlists, setPlaylists, setLoading, setError, loading,
    currentPlaylist, currentPlaylistTracks,
    setCurrentPlaylist, setCurrentPlaylistTracks, clearCurrentPlaylist, clearPlaylistDetail,
  } = usePlaylistStore();
  const { showToast } = useToast();
  const [selectedPlaylist, setSelectedPlaylist] = useState(() => {
    const savedId = sessionStorage.getItem('selectedPlaylistId');
    if (!savedId) return null;
    const hasImage = sessionStorage.getItem('selectedPlaylistHasImage') === '1';
    return { id: savedId, title: '', has_image: hasImage };
  });
  const [playlistTracks, setPlaylistTracks] = useState([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [viewMode, setViewMode] = useState(() => sessionStorage.getItem('selectedPlaylistId') ? 'detail' : 'list');
  const [displayMode, setDisplayMode] = useState(() => sessionStorage.getItem('playlistDisplayMode') || 'list');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
   const [showAddMusicPanel, setShowAddMusicPanel] = useState(false);

  // Listening statistics
  const [listeningLeaderboardMetric, setListeningLeaderboardMetric] = useState(() => {
    try { return localStorage.getItem('listeningLeaderboardMetric') || 'plays'; } catch { return 'plays'; }
  });

  // Persist listening metric preference
  useEffect(() => {
    try { localStorage.setItem('listeningLeaderboardMetric', listeningLeaderboardMetric); } catch {}
  }, [listeningLeaderboardMetric]);

  // Sort/Filter states
  const PLAYLIST_SORT_OPTIONS = [
    { key: null, label: 'None', order: 'asc' },
    { key: 'name', label: 'Name', order: 'asc' },
    { key: 'created_at', label: 'Created', order: 'desc' },
  ];
  const TRACK_FILTER_OPTIONS = [
    { key: 'all', label: 'All' },
    { key: 'is_favorite', label: 'Love' },
    { key: 'flac', label: 'FLAC' },
    { key: 'mp3', label: 'MP3' },
    { key: 'm4a', label: 'M4A' },
    { key: 'opus', label: 'OPUS' },
    { key: 'aac', label: 'AAC' },
    { key: 'wav', label: 'WAV' },
  ];
  const TRACK_SORT_OPTIONS = [
    { key: null, label: 'None', order: 'asc' },
    { key: 'track_num', label: 'Track #', order: 'asc' },
    { key: 'track_index', label: 'Added', order: 'asc' },
    { key: 'title', label: 'Title', order: 'asc' },
    { key: 'artist', label: 'Artist', order: 'asc' },
    { key: 'album', label: 'Album', order: 'asc' },
    { key: 'duration', label: 'Duration', order: 'desc' },
    { key: 'created_at', label: 'Created', order: 'desc' },
    { key: 'mtime', label: 'Modified', order: 'desc' },
    { key: 'size', label: 'Size', order: 'desc' },
  ];
  const [playlistSort, setPlaylistSort] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('playlistSort')); return s || { by: 'name', order: 'asc' }; } catch { return { by: 'name', order: 'asc' }; }
  });
  const [trackSort, setTrackSort] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('trackSort')); return s || { by: 'track_num', order: 'asc' }; } catch { return { by: 'track_num', order: 'asc' }; }
  });
  const [trackFilterType, setTrackFilterType] = useState(() => {
    try { return localStorage.getItem('trackFilterType') || 'all'; } catch { return 'all'; }
  });

   const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filterPanelType, setFilterPanelType] = useState('playlist');

  // Delete mode states
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState(new Set());
  const [selectAllForDelete, setSelectAllForDelete] = useState(false);
  const [deletingTrackIds, setDeletingTrackIds] = useState(new Set());
  const [playlistDeleteMode, setPlaylistDeleteMode] = useState(false);
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, playlistId: null });

  const fileInputRef = useRef(null);
  const restoreAttemptedRef = useRef(false);
  const playAllGuardRef = useRef(false);
  const playTrackGuardRef = useRef(false);
  const cachedPlaylistRef = useRef(null);
  const cachedTracksRef = useRef(null);
  const cachedPlaylistIdRef = useRef(null);
  const gridColsRef = useRef(0);

  // ---- Spotify-style layout state ----
  const mainRowRef = useRef(null);
  const coverInputRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem('playlist_leftSidebarOpen');
    if (stored !== null) return stored === 'true';
    return window.innerWidth >= 760;
  });
  const [showLoved, setShowLoved] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [lovedLoading, setLovedLoading] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('playlist_rightSidebarOpen');
    return stored !== null ? stored === 'true' : false;
  });
  const [rightSidebarMode, setRightSidebarMode] = useState('nowplaying');
  const [leaderboardDisplayMode, setLeaderboardDisplayMode] = useState('list');
  const [leaderboardTick, setLeaderboardTick] = useState(0);
  const [leftHovered, setLeftHovered] = useState(false);
  const [rightHovered, setRightHovered] = useState(false);
  const userClosedSidebarRef = useRef(false);
  const userClosedLeftSidebarRef = useRef(false);
  const leftHoverTimer = useRef(null);
  const rightHoverTimer = useRef(null);

  useEffect(() => { localStorage.setItem('playlist_leftSidebarOpen', leftSidebarOpen); }, [leftSidebarOpen]);
  useEffect(() => { localStorage.setItem('playlist_rightSidebarOpen', rightSidebarOpen); }, [rightSidebarOpen]);
  const showSidebar = containerWidth >= 760;

  const [leftSidebarWidth, setLeftSidebarWidth] = useState(260);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return 300;
    const stored = parseInt(localStorage.getItem('playlist_rightSidebarWidth'), 10);
    return Number.isFinite(stored) ? Math.min(360, Math.max(200, stored)) : 300;
  });
  useEffect(() => { localStorage.setItem('playlist_rightSidebarWidth', String(rightSidebarWidth)); }, [rightSidebarWidth]);
  const dragRef = useRef(null); // { side: 'left'|'right', startX, startWidth }
  const [isResizing, setIsResizing] = useState(false);
  const PEEK_WIDTH = 64;
  const RIGHT_PEEK_WIDTH = 200;
  const PANEL_GAP = 8;
  const BAR_WIDTH = 28;

  const leftReveal = leftSidebarOpen ? leftSidebarWidth : leftHovered ? PEEK_WIDTH : 0;
  const rightPeeking = rightHovered && !rightSidebarOpen;
  // Right edge-bar width: idle 28 → expands to 40 on hover → collapses to 0
  // once the sidebar is fully open so the panel content sits flush.
  const barW = rightSidebarOpen ? 0 : rightHovered ? 40 : BAR_WIDTH;

  // Keep the right panel content mounted through the exit animation —
  // unmounting it synchronously would make the fade-out look instant.
  const [previewMounted, setPreviewMounted] = useState(rightSidebarOpen);
  useEffect(() => {
    if (rightSidebarOpen || rightPeeking) {
      setPreviewMounted(true);
      return undefined;
    }
    const t = setTimeout(() => setPreviewMounted(false), 320); // ≥ slide (300ms) + fade (250ms)
    return () => clearTimeout(t);
  }, [rightSidebarOpen, rightPeeking]);

  const [leftResizeHover, setLeftResizeHover] = useState(false);
  const [rightResizeHover, setRightResizeHover] = useState(false);

  const handleResizeStart = useCallback((side, e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    const startWidth = side === 'left' ? leftSidebarWidth : rightSidebarWidth;
    dragRef.current = { side, startX: e.clientX, startWidth };
    const onMouseMove = (ev) => {
      if (!dragRef.current) return;
      const { side: s, startX, startWidth: sw } = dragRef.current;
      const delta = s === 'left' ? ev.clientX - startX : startX - ev.clientX;
      const newWidth = Math.min(360, Math.max(200, sw + delta));
      if (s === 'left') setLeftSidebarWidth(newWidth);
      else setRightSidebarWidth(newWidth);
    };
    const onMouseUp = () => {
      setIsResizing(false);
      dragRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [leftSidebarWidth, rightSidebarWidth]);

  // Force leaderboard re-render every second while open so stats update live.
  useEffect(() => {
    if (!rightSidebarOpen || rightSidebarMode !== 'leaderboard') return;
    const id = setInterval(() => setLeaderboardTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [rightSidebarOpen, rightSidebarMode]);

  // Width of the detail content area (used so the track list can be virtualized
  // while the whole detail view — hero + toolbar + list — scrolls as one tab).
  const detailScrollRef = useRef(null);
  const [detailWidth, setDetailWidth] = useState(0);
  useEffect(() => {
    const el = detailScrollRef.current;
    if (!el) return;
    const update = () => setDetailWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [selectedPlaylist]);

  // Persist displayMode
  useEffect(() => {
    sessionStorage.setItem('playlistDisplayMode', displayMode);
  }, [displayMode]);

  // Persist sort state
  useEffect(() => {
    localStorage.setItem('playlistSort', JSON.stringify(playlistSort));
  }, [playlistSort]);
  useEffect(() => {
    localStorage.setItem('trackSort', JSON.stringify(trackSort));
  }, [trackSort]);
  useEffect(() => {
    if (trackFilterType) localStorage.setItem('trackFilterType', trackFilterType);
  }, [trackFilterType]);

  async function handleImportXSPF(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      await importXSPFPlaylist(file);
      showToast('Playlist imported successfully', 'success');
      const data = await loadPlaylists();
      setPlaylists(data.playlists || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleCreateManualPlaylist() {
    if (!createTitle.trim()) return;
    setIsCreating(true);
    try {
      const result = await createEmptyPlaylist(createTitle.trim());
      showToast('Playlist created successfully', 'success');
      setShowCreateModal(false);
      setCreateTitle('');
      const data = await loadPlaylists();
      setPlaylists(data.playlists || []);
      if (result.id) {
        handleSelectPlaylist({ id: result.id, title: createTitle.trim() });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsCreating(false);
    }
  }

  // Restore playlist detail — Bug #9: validate URL hash before restoring
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;

    const savedId = sessionStorage.getItem('selectedPlaylistId');

    // Validate URL hash: only restore if URL explicitly targets this playlist
    const hash = window.location.hash;
    const playlistMatch = hash.match(/\/playlists\/(loved|\d+)/);
    const hashId = playlistMatch ? playlistMatch[1] : null;

    // PlaylistView is also mounted (hidden, display:none) behind the full audio
    // player. Don't run restoration there: it would corrupt the audio URL
    // (selectLoved() rewrites it to #/playlists/loved) and re-trigger playlist
    // loads, leaving the playlist stuck on its spinner when you return to the
    // mini player. We only restore when the URL is actually a playlists route.
    // Defensively clear any loading flags before bailing: because PlaylistView
    // is remounted (via the key swap in App.jsx) with the audio URL still in the
    // hash, the spinner would otherwise never be cleared and stay stuck.
    if (/\/audio\//.test(hash)) {
      setLoadingTracks(false);
      setLovedLoading(false);
      return;
    }

    // Loved is a virtual (favorites) playlist, not a server-side one. Restore it
    // from favorites instead of calling the playlist API (which would 404 on id
    // 'loved'). This handles both a stored selection and a deep link to
    // #/playlists/loved.
    if (savedId === LOVED_PLAYLIST_ID || hashId === LOVED_PLAYLIST_ID) {
      setViewMode('detail');
      selectLoved();
      return;
    }

    if (!savedId) return;

    if (!hashId || String(hashId) !== String(savedId)) {
      // If URL has no /playlists/ segment (e.g. audio URL), we're rendered in
      // background — leave selectedPlaylistId alone so it survives for later.
      if (hashId === null) return;
      // URL targets a different playlist — clear stale state and stay on list view
      sessionStorage.removeItem('selectedPlaylistId');
      clearPlaylistDetail();
      setSelectedPlaylist(null);
      setPlaylistTracks([]);
      setViewMode('list');
      return;
    }

    setViewMode('detail');

    const cached = cachedPlaylistRef.current;
    if (cached && String(cached.id) === String(savedId)) {
      setSelectedPlaylist(cached);
      setCurrentPlaylist(cached);
      if (cachedTracksRef.current) {
        setPlaylistTracks(cachedTracksRef.current);
        setCurrentPlaylistTracks(cachedTracksRef.current);
        resolveMissingDurations(cachedTracksRef.current);
      } else {
        setLoadingTracks(true);
        loadPlaylist(savedId).then(data => {
          cachedTracksRef.current = data.tracks || [];
          setPlaylistTracks(data.tracks || []);
          setCurrentPlaylistTracks(data.tracks || []);
          resolveMissingDurations(data.tracks || []);
        }).catch(() => {}).finally(() => setLoadingTracks(false));
      }
      return;
    }

    setLoadingTracks(true);
    loadPlaylist(savedId).then(data => {
      cachedPlaylistRef.current = data;
      cachedTracksRef.current = data.tracks || [];
      setSelectedPlaylist(data);
      setCurrentPlaylist(data);
      setPlaylistTracks(data.tracks || []);
      setCurrentPlaylistTracks(data.tracks || []);
      resolveMissingDurations(data.tracks || []);
    }).catch(() => {
      sessionStorage.removeItem('selectedPlaylistId');
      clearPlaylistDetail();
      setSelectedPlaylist(null);
      setPlaylistTracks([]);
      setViewMode('list');
    }).finally(() => setLoadingTracks(false));
  }, [viewMode, clearPlaylistDetail]);

  useEffect(() => {
    loadPlaylists().then(data => {
      setPlaylists(data.playlists || []);
    }).catch(() => {});
  }, []);

  // Track available width so the left sidebar only shows when the tab is wide enough.
  useEffect(() => {
    const el = mainRowRef.current;
    if (!el) return;
    const update = () => {
      const width = el.getBoundingClientRect().width;
      setContainerWidth(width);
      if (width >= 760 && !leftSidebarOpen && !userClosedLeftSidebarRef.current) {
        setLeftSidebarOpen(true);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [leftSidebarOpen]);

  // Load loved tracks once for the sidebar count (and reuse when Loved is opened).
  const refreshFavorites = useCallback(() => {
    loadFavorites().then(setFavorites).catch(() => {});
  }, []);
  useEffect(() => { refreshFavorites(); }, [refreshFavorites]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      await refreshPlaylists();
      const data = await loadPlaylists();
      setPlaylists(data.playlists || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [setLoading, setPlaylists, setError]);

  const handleSelectPlaylist = useCallback((playlist) => {
    setShowLoved(false);
    cachedPlaylistRef.current = playlist;
    sessionStorage.setItem('selectedPlaylistId', playlist.id);
    const hasImage = playlist.has_image === true || !!playlist.image;
    sessionStorage.setItem('selectedPlaylistHasImage', hasImage ? '1' : '0');
    // Keep has_image through so the hero can resolve the cover immediately via
    // the GET image endpoint (the list payload only carries the boolean).
    setSelectedPlaylist({ ...playlist, has_image: hasImage });
    setCurrentPlaylist({ ...playlist, has_image: hasImage });
    setViewMode('detail');
    const url = `#/music/playlists/${playlist.id}`;
    if (window.location.hash !== url) {
      window.history.pushState({}, '', url);
    }
    // Reuse cached tracks for an instant open (mirrors how the Loved section is
    // instant because its favorites are already cached). Refresh in the
    // background so the list still stays fresh.
    const cached = cachedPlaylistIdRef.current === playlist.id ? cachedTracksRef.current : null;
    if (cached && cached.length > 0) {
      setPlaylistTracks(cached);
      setCurrentPlaylistTracks(cached);
      setLoadingTracks(false);
      resolveMissingDurations(cached);
      loadPlaylist(playlist.id).then(data => {
        const tracks = data.tracks || [];
        cachedTracksRef.current = tracks;
        cachedPlaylistIdRef.current = playlist.id;
        // Apply full playlist payload (incl. cover image) so the hero shows the
        // set cover, not the default. The list item only carries has_image.
        setSelectedPlaylist(prev => prev ? { ...prev, image: data.image, title: data.title ?? prev.title } : prev);
        setCurrentPlaylist(prev => prev ? { ...prev, image: data.image, title: data.title ?? prev.title } : prev);
        setPlaylistTracks(tracks);
        setCurrentPlaylistTracks(tracks);
        resolveMissingDurations(tracks);
      }).catch(() => {});
      return;
    }
    // Clear tracks immediately so stale data doesn't leak into queue
    cachedTracksRef.current = null;
    cachedPlaylistIdRef.current = null;
    setPlaylistTracks([]);
    setCurrentPlaylistTracks([]);
    setLoadingTracks(true);
    loadPlaylist(playlist.id).then(data => {
      const tracks = data.tracks || [];
      cachedTracksRef.current = tracks;
      cachedPlaylistIdRef.current = playlist.id;
      // Apply full playlist payload (incl. cover image) so the hero shows the
      // set cover, not the default. The list item only carries has_image.
      setSelectedPlaylist(prev => prev ? { ...prev, image: data.image, title: data.title ?? prev.title } : prev);
      setCurrentPlaylist(prev => prev ? { ...prev, image: data.image, title: data.title ?? prev.title } : prev);
      setPlaylistTracks(tracks);
      setCurrentPlaylistTracks(tracks);
      resolveMissingDurations(tracks);
    }).catch(err => {
      console.error('Failed to load playlist:', err);
      setPlaylistTracks([]);
      setCurrentPlaylistTracks([]);
    }).finally(() => setLoadingTracks(false));
  }, [setCurrentPlaylist, setCurrentPlaylistTracks]);

  const handleBackToList = useCallback(() => {
    sessionStorage.removeItem('selectedPlaylistId');
    sessionStorage.removeItem('selectedPlaylistHasImage');
    cachedPlaylistRef.current = null;
    setSelectedPlaylist(null);
    setPlaylistTracks([]);
    setShowLoved(false);
    clearCurrentPlaylist();
    setViewMode('list');
    onBackToPlaylistList?.();
    const url = '#/music';
    if (window.location.hash !== url) {
      window.history.pushState({}, '', url);
    }
  }, [clearCurrentPlaylist, onBackToPlaylistList]);

  const selectLoved = useCallback(async () => {
    setShowLoved(true);
    setLovedLoading(true);
    setSelectedPlaylist({ id: 'loved', title: 'Loved', isLoved: true, image: null, track_count: favorites.length });
    sessionStorage.setItem('selectedPlaylistId', LOVED_PLAYLIST_ID);
    if (window.location.hash !== '#/music/playlists/loved') {
      window.history.pushState({ view: 'playlists', playlistId: LOVED_PLAYLIST_ID }, '', '#/music/playlists/loved');
    }
    try {
      const favs = await loadFavorites();
      setFavorites(favs);
      cachedTracksRef.current = favs;
      setPlaylistTracks(favs);
      setCurrentPlaylistTracks(favs);
      resolveMissingDurations(favs);
      setSelectedPlaylist({ id: 'loved', title: 'Loved', isLoved: true, image: null, track_count: favs.length });
    } catch {
      showToast('Gagal memuat musik yang disukai', 'error');
    } finally {
      setLovedLoading(false);
    }
  }, [favorites, setCurrentPlaylistTracks, showToast]);

  const handleCoverFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file || !selectedPlaylist || selectedPlaylist.isLoved) return;
    try {
      const image = await uploadPlaylistCover(selectedPlaylist.id, file);
      setSelectedPlaylist(prev => prev ? { ...prev, image } : prev);
      setCurrentPlaylist(prev => prev ? { ...prev, image } : prev);
      setPlaylists(prev => prev.map(p => p.id === selectedPlaylist.id ? { ...p, image } : p));
      cachedPlaylistRef.current = { ...(cachedPlaylistRef.current || {}), image };
      showToast('Cover diperbarui', 'success');
    } catch {
      showToast('Gagal mengunggah cover', 'error');
    }
  }, [selectedPlaylist, setCurrentPlaylist, showToast]);

  const handleDeletePlaylist = useCallback((playlistId, e) => {
    if (e) e.stopPropagation();
    setDeleteConfirm({ open: true, playlistId });
  }, []);

  const confirmDeletePlaylist = useCallback(async () => {
    const playlistId = deleteConfirm.playlistId;
    if (!playlistId) return;
    try {
      await fetch(`${import.meta.env.VITE_API_URL || ''}/api/playlists/${playlistId}`, { method: 'DELETE' });
      showToast('Playlist deleted', 'success');
      setPlaylists(prev => prev.filter(p => p.id !== playlistId));
      if (String(selectedPlaylist?.id) === String(playlistId)) {
        handleBackToList();
      }
    } catch (err) {
      showToast('Failed to delete playlist', 'error');
    } finally {
      setDeleteConfirm({ open: false, playlistId: null });
    }
  }, [deleteConfirm.playlistId, selectedPlaylist?.id, setPlaylists, showToast, handleBackToList]);

  const handleRemoveTrack = useCallback(async (trackId, e) => {
    if (e) e.stopPropagation();
    if (!selectedPlaylist) return;
    try {
      await removeTrackFromPlaylist(selectedPlaylist.id, trackId);
      setPlaylistTracks(prev => prev.filter(t => t.id !== trackId));
      showToast('Track removed', 'success');
      loadPlaylist(selectedPlaylist.id).then(data => {
        setSelectedPlaylist(prev => prev ? { ...prev, track_count: data.track_count, total_duration: data.total_duration } : prev);
      });
    } catch (err) {
      showToast('Failed to remove track', 'error');
    }
  }, [selectedPlaylist, showToast]);

  const toggleSelectForDelete = useCallback((trackId) => {
    setSelectedForDelete(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);

  // Sorted data
  const sortedPlaylists = useMemo(() => {
    const list = Array.isArray(playlists) ? [...playlists] : [];
    const { by, order } = playlistSort;
    list.sort((a, b) => {
      let valA = a[by] ?? '';
      let valB = b[by] ?? '';
      if (by === 'created_at') {
        valA = new Date(valA).getTime() || 0;
        valB = new Date(valB).getTime() || 0;
      } else {
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
      }
      if (valA < valB) return order === 'asc' ? -1 : 1;
      if (valA > valB) return order === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [playlists, playlistSort]);

  const sortedTracks = useMemo(() => {
    let list = [...playlistTracks];
    if (trackFilterType === 'is_favorite') {
      list = list.filter(t => t.is_favorite === 1);
    } else if (trackFilterType !== 'all') {
      list = list.filter(t => {
        const filePath = t.resolved_path || t.location || '';
        const ext = filePath.split('.').pop().toLowerCase();
        return ext === trackFilterType;
      });
    }
    const query = trackSearchQuery.trim().toLowerCase();
    if (query) {
      list = list.filter(t => {
        const name = (t.display_name || t.title || t.name || '').toLowerCase();
        const artist = (t.artist || '').toLowerCase();
        return name.includes(query) || artist.includes(query);
      });
    }
    const { by, order } = trackSort;
    list.sort((a, b) => {
      let valA = a[by] ?? '';
      let valB = b[by] ?? '';
      if (by === 'duration' || by === 'track_num' || by === 'track_index' || by === 'created_at' || by === 'mtime' || by === 'size') {
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
      } else {
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
      }
      if (valA < valB) return order === 'asc' ? -1 : 1;
      if (valA > valB) return order === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [playlistTracks, trackSort, trackFilterType, trackSearchQuery]);

  const totalDurationSeconds = useMemo(
    () => sortedTracks.reduce((sum, t) => sum + (Number(t.duration) || 0), 0),
    [sortedTracks]
  );

  // ---- Search filter animation (fade-out + slide) ----
  // Keeps the previously-rendered list for ~200ms after a filter/search change,
  // marks the removed tracks as "leaving" (fade out) and shifts the remaining
  // tracks up by the number of leaving rows above them (slide). Only the visible
  // rows are ever rendered (react-window), so this stays lightweight.
  const trackKey = (t) => (t?.id ?? t?.file_id ?? '');
  const [displayTracks, setDisplayTracks] = useState(() => sortedTracks);
  const [leavingTrackIds, setLeavingTrackIds] = useState(new Set());
  const [shiftAbove, setShiftAbove] = useState(new Map());
  const [enteringTrackIds, setEnteringTrackIds] = useState(new Set());
  const displayRef = useRef(sortedTracks);
  const filterAnimTimerRef = useRef(null);

  useEffect(() => {
    if (filterAnimTimerRef.current) {
      clearTimeout(filterAnimTimerRef.current);
      filterAnimTimerRef.current = null;
    }
    const prev = displayRef.current;
    if (!prev || prev.length === 0 || prev === sortedTracks) {
      displayRef.current = sortedTracks;
      setDisplayTracks(sortedTracks);
      setLeavingTrackIds(new Set());
      setShiftAbove(new Map());
      setEnteringTrackIds(new Set());
      return;
    }
    const prevKeys = new Set(prev.map(trackKey));
    const newKeys = new Set(sortedTracks.map(trackKey));
    const leaving = new Set(prev.filter(t => !newKeys.has(trackKey(t))).map(trackKey));
    const entering = new Set(sortedTracks.filter(t => !prevKeys.has(trackKey(t))).map(trackKey));

    if (leaving.size > 0) {
      // Exit phase: keep the old list, fade out removed items, slide remaining.
      // For grid view, skip the exit phase (instantly swap) because CSS grid
      // reflow can't be smoothly transitioned — the remaining cards look wrong
      // when they slide while leaving cards still occupy their cells.
      if (displayMode !== 'grid') {
        const shift = new Map();
        let count = 0;
        for (const t of prev) {
          const k = trackKey(t);
          if (leaving.has(k)) count++;
          else shift.set(k, count);
        }
        setDisplayTracks(prev);
        setLeavingTrackIds(leaving);
        setShiftAbove(shift);
        setEnteringTrackIds(new Set());
        filterAnimTimerRef.current = setTimeout(() => {
          displayRef.current = sortedTracks;
          setDisplayTracks(sortedTracks);
          setLeavingTrackIds(new Set());
          setShiftAbove(new Map());
        }, 220);
      } else {
        // Grid: swap instantly, no exit animation. Still animate new items in.
        displayRef.current = sortedTracks;
        setDisplayTracks(sortedTracks);
        setLeavingTrackIds(new Set());
        setShiftAbove(new Map());
        if (entering.size > 0) {
          setEnteringTrackIds(entering);
          filterAnimTimerRef.current = setTimeout(() => {
            setEnteringTrackIds(new Set());
          }, 260);
        } else {
          setEnteringTrackIds(new Set());
        }
      }
    } else {
      // Enter phase (e.g. clearing search): swap immediately, animate new items in.
      displayRef.current = sortedTracks;
      setDisplayTracks(sortedTracks);
      setLeavingTrackIds(new Set());
      setShiftAbove(new Map());
      if (entering.size > 0) {
        setEnteringTrackIds(entering);
        filterAnimTimerRef.current = setTimeout(() => {
          setEnteringTrackIds(new Set());
        }, 260);
      } else {
        setEnteringTrackIds(new Set());
      }
    }
  }, [sortedTracks, displayMode]);

  const handleBulkDelete = useCallback(async () => {
    if (!selectedPlaylist) return;
    const ids = selectAllForDelete
      ? sortedTracks.map(t => t.id).filter(id => !selectedForDelete.has(id))
      : Array.from(selectedForDelete);
    if (ids.length === 0) return;
    setDeletingTrackIds(new Set(ids));
    await new Promise(r => setTimeout(r, 400));
    try {
      const result = await bulkRemoveTracksFromPlaylist(selectedPlaylist.id, ids);
      const remainingTracks = sortedTracks.filter(t => !ids.includes(t.id));
      setPlaylistTracks(remainingTracks);
      setCurrentPlaylistTracks(remainingTracks);
      cachedTracksRef.current = remainingTracks;
      const updatedPlaylist = {
        ...selectedPlaylist,
        track_count: result.track_count ?? remainingTracks.length,
        total_size: remainingTracks.reduce((sum, t) => sum + (t.size || 0), 0),
      };
      cachedPlaylistRef.current = updatedPlaylist;
      setSelectedPlaylist(updatedPlaylist);
      setCurrentPlaylist(updatedPlaylist);
      setPlaylists(prev => prev.map(p => p.id === updatedPlaylist.id ? { ...p, ...updatedPlaylist } : p));
      showToast(`${ids.length} track(s) deleted`, 'success');
    } catch (err) {
      showToast('Failed to delete from server', 'error');
    } finally {
      setSelectedForDelete(new Set());
      setDeleteMode(false);
      setSelectAllForDelete(false);
      setDeletingTrackIds(new Set());
    }
  }, [selectedPlaylist, sortedTracks, selectedForDelete, selectAllForDelete, showToast, setCurrentPlaylist, setCurrentPlaylistTracks]);

  const handleCancelDeleteMode = useCallback(() => {
    setDeleteMode(false);
    setSelectedForDelete(new Set());
    setSelectAllForDelete(false);
    setDeletingTrackIds(new Set());
  }, []);

  const bulkSelectedCount = deleteMode
    ? (selectAllForDelete ? sortedTracks.length - selectedForDelete.size : selectedForDelete.size)
    : 0;

  // Filter panel handlers
  const handleOpenPlaylistFilters = useCallback(() => {
    setFilterPanelType('playlist');
    setShowFilterPanel(true);
  }, []);

  const handleOpenTrackFilters = useCallback(() => {
    setFilterPanelType('track');
    setShowFilterPanel(true);
  }, []);

  const handleFilterApply = useCallback((key, order) => {
    if (filterPanelType === 'playlist') {
      setPlaylistSort({ by: key, order: order || 'asc' });
    } else {
      setTrackSort({ by: key, order: order || 'asc' });
    }
  }, [filterPanelType]);

  const handleTrackFilterTypeChange = useCallback((type) => {
    setTrackFilterType(type);
  }, []);

  const handlePlaylistOrderToggle = useCallback(() => {
    setPlaylistSort(prev => ({ ...prev, order: prev.order === 'asc' ? 'desc' : 'asc' }));
  }, []);

  const togglePlaylistSelect = useCallback((playlistId) => {
    setSelectedPlaylistIds(prev => {
      const next = new Set(prev);
      if (next.has(playlistId)) next.delete(playlistId);
      else next.add(playlistId);
      return next;
    });
  }, []);

  // Stable select handler so PlaylistGrid / PlaylistListItemRow memoization
  // actually holds across selection toggles (inline arrows would re-create the
  // callback every render and force every visible card to re-render per click).
  const handlePlaylistGridSelect = useCallback((playlist) => {
    if (playlistDeleteMode) togglePlaylistSelect(playlist.id);
    else handleSelectPlaylist(playlist);
  }, [playlistDeleteMode, togglePlaylistSelect, handleSelectPlaylist]);

  const handlePlaylistListSelect = useCallback((playlist) => {
    if (playlistDeleteMode) togglePlaylistSelect(playlist.id);
    else handleSelectPlaylist(playlist);
  }, [playlistDeleteMode, togglePlaylistSelect, handleSelectPlaylist]);

  const fullQueueMemo = useMemo(() => {
    return sortedTracks.map((t, i) => ({
      file_id: t.file_id,
      track_index: i,
      display_name: t.display_name,
      artist: t.artist || '',
      album: t.album || '',
      duration: t.duration || 0,
      path: t.resolved_path || t.location || '',
      resolved_path: t.resolved_path,
      location: t.location,
      exists: !!t.exists && !!t.file_id,
      type: 'audio',
      ext: t.resolved_path ? t.resolved_path.split('.').pop()?.toLowerCase() || '' : '',
      size: t.size || 0,
      is_favorite: t.is_favorite || 0,
      youtube_id: t.youtube_id || null,
      video_offset: t.video_offset || 0,
    }));
  }, [sortedTracks]);
  
  // Currently-playing file id (from the shared playback store) so the list and
  // grid can mark which track is active while the MiniPlayer is in the background.
  const queue = usePlaybackStore(s => s.queue);
  const currentTrackIndex = usePlaybackStore(s => s.currentTrackIndex);
  const playingFileId = usePlaybackStore(s => {
    const q = s.queue;
    const idx = s.currentTrackIndex;
    const item = q && q.length > 0 ? q[idx] : null;
    return item ? (item.file_id || item.id || null) : null;
  });
  const isPlayingActive = usePlaybackStore(s => s.isPlaying);

   const hasActivePlayback = useMemo(() => {
     return queue && queue.length > 0 && currentTrackIndex < queue.length;
   }, [queue, currentTrackIndex]);

    useEffect(() => {
      if (hasActivePlayback && !rightSidebarOpen && !userClosedSidebarRef.current) {
        setRightSidebarOpen(true);
      }
    }, [hasActivePlayback, rightSidebarOpen]);

   const [toggleHovered, setToggleHovered] = useState(false);

  const handlePlay = useCallback(() => {
    if (playAllGuardRef.current) return;
    if (loadingTracks || sortedTracks.length === 0) return;
    const store = usePlaybackStore.getState();
    const active = !!selectedPlaylist && String(store.playlistId) === String(selectedPlaylist.id || selectedPlaylist._id);
    if (active) {
      // Same playlist already loaded -> toggle play/pause (follows player state)
      if (store.isPlaying) store.pause();
      else store.play();
      return;
    }
    playAllGuardRef.current = true;
    setTimeout(() => { playAllGuardRef.current = false; }, 1000);

    const queue = fullQueueMemo.filter(t => t.exists);
    if (queue.length === 0) return;
    onPlayPlaylist({ queue, playlist: selectedPlaylist });
  }, [fullQueueMemo, sortedTracks, selectedPlaylist, onPlayPlaylist, loadingTracks]);

  const handlePlayShuffle = useCallback(() => {
    if (lovedLoading || sortedTracks.length === 0) return;
    const store = usePlaybackStore.getState();
    store.setShuffle(!store.shuffle);
  }, [lovedLoading, sortedTracks]);

  const handlePlayTrack = useCallback((track, index) => {
    if (playTrackGuardRef.current) return;
    if (loadingTracks || lovedLoading) return;
    const fileId = track?.file_id || track?.id;
    if (!fileId) return;
    playTrackGuardRef.current = true;
    setTimeout(() => { playTrackGuardRef.current = false; }, 500);

    // Build the playable queue from the SAME ordered list the user sees
    // (displayTracks) so the clicked track's index maps directly into this
    // queue — the old code built it from sortedTracks (which can diverge from
    // the displayed/animating order) and then fell back to index 0 on any
    // mismatch, which is why clicking the 3rd track played the 1st.
    const playableTracks = buildPlayableQueue(displayTracks);
    if (playableTracks.length === 0) return;

    // Resolve the clicked track by the VISUAL row the user actually clicked.
    // The grid/list passes `index` (position in displayTracks); we map that
    // through the exists-filtered playable subset so the Nth visible row plays
    // the Nth track — never the first one. Fall back to an id-based match only
    // when no visual index is available.
    let clickedIdx;
    if (index != null && index >= 0 && index < displayTracks.length) {
      const visual = displayTracks[index];
      const byVisual = playableTracks.findIndex(t =>
        (t.id != null && t.id === visual.id) || (t.file_id != null && t.file_id === visual.file_id));
      clickedIdx = byVisual >= 0 ? byVisual : index;
    } else {
      clickedIdx = resolveClickedIndex(track, playableTracks);
    }

    if (clickedIdx < 0 || clickedIdx >= playableTracks.length) {
      showToast('Lagu belum tersedia', 'error');
      return;
    }
    console.log('[PlaylistView] onPlayTrack', { fileId, clickedIdx, queueLen: playableTracks.length, trackName: track?.display_name || track?.name });
    onPlayTrack(track, playableTracks, clickedIdx, selectedPlaylist);
  }, [selectedPlaylist, onPlayTrack, loadingTracks, lovedLoading, displayTracks, showToast]);

  // ---- Duration resolution ----
  // Not every playlist track stores a duration (some were added before the
  // scanner filled `duration` in, or the field was never synced from the files
  // table). To show a duration for those tracks, we resolve it once: first via
  // the cheap batched file-metadata endpoint, then (for any still-missing) by
  // probing the audio stream metadata. Resolved values are written back into
  // the track objects so the list/grid + header totals update.
  const durationResolvedRef = useRef(new Set());
  const durationPendingRef = useRef(new Set());
  const probeQueueRef = useRef([]);
  const probeInFlightRef = useRef(0);
  const MAX_PROBES = 4;

  const applyResolvedDuration = useCallback((fileId, seconds) => {
    if (!fileId || !seconds) return;
    setPlaylistTracks(prev => prev.map(t => {
      if (t.duration && t.duration > 0) return t;
      if (t.file_id === fileId || t.id === fileId) return { ...t, duration: seconds };
      return t;
    }));
    setCurrentPlaylistTracks(prev => prev.map(t => {
      if (t.duration && t.duration > 0) return t;
      if (t.file_id === fileId || t.id === fileId) return { ...t, duration: seconds };
      return t;
    }));
    if (cachedTracksRef.current) {
      cachedTracksRef.current = cachedTracksRef.current.map(t => {
        if (t.duration && t.duration > 0) return t;
        if (t.file_id === fileId || t.id === fileId) return { ...t, duration: seconds };
        return t;
      });
    }
  }, []);

  // Bounded, FIFO scheduler for audio-duration probes. At most MAX_PROBES run
  // concurrently so opening a playlist never floods the server with hundreds of
  // /file/:id requests at once. A probe is considered "resolved" once it settles
  // (success OR 0/error) so a track whose probe fails is never re-queued on scroll.
  const pumpProbeQueue = useCallback(() => {
    while (probeInFlightRef.current < MAX_PROBES && probeQueueRef.current.length > 0) {
      const fileId = probeQueueRef.current.shift();
      if (!fileId) continue;
      if (durationResolvedRef.current.has(fileId)) { durationPendingRef.current.delete(fileId); continue; }
      probeInFlightRef.current++;
      loadAudioDuration(fileId).then((d) => {
        probeInFlightRef.current--;
        durationResolvedRef.current.add(fileId);
        durationPendingRef.current.delete(fileId);
        if (d) applyResolvedDuration(fileId, d);
        pumpProbeQueue();
      });
    }
  }, [applyResolvedDuration]);

  const requestDurationProbe = useCallback((fileId) => {
    if (!fileId) return;
    if (durationResolvedRef.current.has(fileId)) return;
    if (durationPendingRef.current.has(fileId)) return;
    durationPendingRef.current.add(fileId);
    probeQueueRef.current.push(fileId);
    pumpProbeQueue();
  }, [pumpProbeQueue]);

  // Cheap batched lookup of durations already stored in the DB (most tracks once
  // the backend has enriched them). Tracks whose duration is still 0 are NOT
  // probed here — probing is driven lazily by the visible rows (onItemsRendered)
  // so only on-screen tracks ever hit /file/:id, at most MAX_PROBES at a time.
  const resolveMissingDurations = useCallback((tracks) => {
    if (!Array.isArray(tracks)) return;
    const need = [];
    for (const t of tracks) {
      if (t.duration && t.duration > 0) continue;
      const fileId = t.file_id || t.id;
      if (!fileId || durationResolvedRef.current.has(fileId)) continue;
      need.push(fileId);
    }
    if (need.length === 0) return;
    const chunks = [];
    for (let i = 0; i < need.length; i += 100) chunks.push(need.slice(i, i + 100));
    Promise.all(chunks.map(ids =>
      fetch(`${API_BASE}/api/files/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
    )).then(results => {
      for (const res of results) {
        if (!res || !Array.isArray(res.items)) continue;
        for (const item of res.items) {
          const dur = item.duration || 0;
          if (dur) {
            applyResolvedDuration(item.id, dur);
            durationResolvedRef.current.add(item.id);
          }
        }
      }
    }).catch(() => {});
  }, [applyResolvedDuration]);

  const listRowData = useMemo(() => ({
    tracks: displayTracks,
    deleteMode,
    selectedForDelete,
    deletingTrackIds,
    leavingTrackIds,
    shiftAbove,
    enteringTrackIds,
    itemSize: 64,
    playingFileId,
    isPlayingActive,
    onSelect: (track, index) => {
      if (deleteMode) { toggleSelectForDelete(track.id); return; }
      if (track.file_id || track.id) handlePlayTrack(track, index);
    },
    onRemove: handleRemoveTrack,
  }), [displayTracks, deleteMode, selectedForDelete, deletingTrackIds, leavingTrackIds, shiftAbove, enteringTrackIds, handlePlayTrack, handleRemoveTrack, toggleSelectForDelete, playingFileId, isPlayingActive]);

  const listItemSize = useCallback(() => 64, []);

  const playlistListItemSize = useCallback(() => 72, []);

  const playlistListRowData = useMemo(() => ({
    playlists: sortedPlaylists,
    playlistDeleteMode,
    selectedPlaylistIds,
    onSelect: playlistDeleteMode
      ? handlePlaylistListSelect
      : handleSelectPlaylist,
    onDelete: handleDeletePlaylist,
    onToggleSelect: togglePlaylistSelect,
  }), [sortedPlaylists, playlistDeleteMode, selectedPlaylistIds, handleSelectPlaylist, handleDeletePlaylist, togglePlaylistSelect, handlePlaylistListSelect]);

  const gridItems = useMemo(() => {
    return displayTracks.map((track, i) => ({
      id: track.file_id || `track-${i}`,
      _trackId: track.id || track.file_id || `track-${i}`,
      _flattenIndex: i,
      _cardTitle: track.display_name,
      _cardSubtitle: track.duration > 0 ? formatDuration(track.duration) : (track.artist || ''),
       _cardThumbnail: track.file_id ? `/thumbnails/full/${track.file_id}.jpg` : null,
      _cardHasImage: true,
      _typeLabel: 'AUDIO',
      _trackIndex: i,
      _track: track,
      _leaving: leavingTrackIds.has(track.id ?? track.file_id),
      _entering: enteringTrackIds.has(track.id ?? track.file_id),
      _exists: !!(track.exists && track.file_id),
      _file_id: track.file_id,
      _is_favorite: track.is_favorite || 0,
      _youtube_id: track.youtube_id || null,
    }));
  }, [displayTracks, leavingTrackIds, enteringTrackIds]);

  const handleTrackGridSelect = useCallback((item) => {
    if (deleteMode) {
      const realTrack = item?._track || sortedTracks[item?._trackIndex] || item;
      if (realTrack?.id) toggleSelectForDelete(realTrack.id);
      return;
    }
    const realTrack = item?._track || sortedTracks[item?._trackIndex] || item;
    handlePlayTrack(realTrack, item?._trackIndex);
  }, [deleteMode, handlePlayTrack, sortedTracks, toggleSelectForDelete]);

  // Lazy probe: only rows currently rendered get a duration probe. This keeps the
  // concurrent /file/:id requests bounded to the visible window (see pumpProbeQueue /
  // MAX_PROBES) so scrolling stays smooth and opening a playlist never floods.
  const handleListItemsRendered = useCallback(({ overscanStartIndex, overscanStopIndex }) => {
    for (let i = overscanStartIndex; i <= overscanStopIndex; i++) {
      const t = displayTracks[i];
      if (t) requestDurationProbe(t.file_id || t.id);
    }
  }, [displayTracks, requestDurationProbe]);

  const handleGridItemsRendered = useCallback((ids) => {
    for (const id of ids) requestDurationProbe(id);
  }, [requestDurationProbe]);

  // Create modal
  const createModal = showCreateModal && (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: COLORS.bg.primary,
        borderRadius: '16px',
        border: `1px solid ${COLORS.border.primary}`,
        width: '100%',
        maxWidth: '420px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px',
          borderBottom: `1px solid ${COLORS.border.primary}`,
        }}>
          <h2 style={{ margin: 0, fontSize: '16px', color: COLORS.text.primary, fontWeight: 600 }}>
            Create New Playlist
          </h2>
          <button
            onClick={() => { setShowCreateModal(false); setCreateTitle(''); }}
            style={{
              background: 'none',
              border: 'none',
              color: COLORS.text.secondary,
              cursor: 'pointer',
              fontSize: '20px',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={20} />
          </button>
        </div>
        <div style={{ padding: '20px' }}>
          <label style={{ display: 'block', fontSize: '12px', color: COLORS.text.secondary, marginBottom: '8px', fontWeight: 500 }}>
            Playlist Title
          </label>
          <input
            type="text"
            value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
            placeholder="My Awesome Playlist"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && createTitle.trim()) handleCreateManualPlaylist(); }}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '8px',
              background: COLORS.bg.secondary,
              border: `1px solid ${COLORS.border.primary}`,
              color: COLORS.text.primary,
              fontSize: '14px',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '12px',
          padding: '20px',
          borderTop: `1px solid ${COLORS.border.primary}`,
        }}>
          <button
            onClick={() => { setShowCreateModal(false); setCreateTitle(''); }}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              background: 'transparent',
              border: `1px solid ${COLORS.border.primary}`,
              color: COLORS.text.secondary,
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreateManualPlaylist}
            disabled={!createTitle.trim() || isCreating}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              background: COLORS.accent,
              border: 'none',
              color: 'white',
              cursor: !createTitle.trim() || isCreating ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 600,
              opacity: !createTitle.trim() || isCreating ? 0.5 : 1,
            }}
          >
            {isCreating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );

  const deleteConfirmModal = deleteConfirm.open && (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: COLORS.bg.primary,
        borderRadius: '16px',
        border: `1px solid ${COLORS.border.primary}`,
        width: '100%',
        maxWidth: '420px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          padding: '20px',
          borderBottom: `1px solid ${COLORS.border.primary}`,
        }}>
          <h2 style={{ margin: 0, fontSize: '16px', color: COLORS.text.primary, fontWeight: 600 }}>
            Delete Playlist
          </h2>
          <p style={{ margin: '8px 0 0 0', fontSize: '14px', color: COLORS.text.secondary }}>
            Are you sure you want to delete this playlist? This action cannot be undone.
          </p>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '12px',
          padding: '20px',
        }}>
          <button
            onClick={() => setDeleteConfirm({ open: false, playlistId: null })}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              background: 'transparent',
              border: `1px solid ${COLORS.border.primary}`,
              color: COLORS.text.secondary,
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            onClick={confirmDeletePlaylist}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              background: '#ef4444',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div
      ref={mainRowRef}
      className="pv-no-focus"
      onClickCapture={(e) => {
        const t = e.target;
        if (t && t.tagName === 'BUTTON') {
          requestAnimationFrame(() => t.blur());
        }
      }}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <ServiceStoppedBanner service="playlists" />

      <div style={{ flex: 1, margin: 4, borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden', position: 'relative', background: '#000' }}>

        {/* ── Left sidebar assembly (decoupled: bar translates, module masked from its LEFT edge) ── */}
        <div
          style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: BAR_WIDTH + leftReveal,
            overflow: 'hidden',
            zIndex: 10,
            background: '#121212',
            borderRadius: 12,
            transition: isResizing ? 'none' : 'width 0.3s cubic-bezier(0.22, 0.61, 0.36, 1)',
            pointerEvents: leftSidebarOpen || leftHovered ? 'auto' : 'none',
          }}
        >
          {/* Preview content — fixed in place, revealed from its LEFT edge (playlist name shows during peek) */}
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: leftSidebarWidth,
            WebkitMaskImage: 'linear-gradient(#000, #000)',
            maskImage: 'linear-gradient(#000, #000)',
            WebkitMaskSize: `${leftReveal}px 100%`,
            maskSize: `${leftReveal}px 100%`,
            WebkitMaskPosition: 'left top',
            maskPosition: 'left top',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            transition: isResizing ? 'none' : 'mask-size 0.3s cubic-bezier(0.22, 0.61, 0.36, 1), -webkit-mask-size 0.3s cubic-bezier(0.22, 0.61, 0.36, 1)',
          }}>
            <PlaylistLeftModule
              showSidebar={leftSidebarOpen}
              sidebarWidth={leftSidebarWidth}
              leftHovered={leftHovered}
              setLeftHovered={setLeftHovered}
              onToggleSidebar={() => setLeftSidebarOpen(prev => !prev)}
              onClose={() => { userClosedLeftSidebarRef.current = true; setLeftSidebarOpen(false); }}
              sortedPlaylists={sortedPlaylists}
              favoritesCount={favorites.length}
              selectedPlaylist={selectedPlaylist}
              showLoved={showLoved}
              handleSelectPlaylist={handleSelectPlaylist}
              selectLoved={selectLoved}
            />
          </div>
           {/* Edge bar + chevron — translates with the same timeline as before (closed [0,28] → open [260,288]). When open, shows a clickable collapse control. */}
           <div
             onClick={() => { if (leftSidebarOpen) { userClosedLeftSidebarRef.current = true; setLeftSidebarOpen(false); } }}
             style={{
               position: 'absolute', top: 0, bottom: 0,
               width: BAR_WIDTH,
               transform: `translateX(${leftReveal}px)`,
               transition: isResizing ? 'none' : 'transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.3s cubic-bezier(0.22, 0.61, 0.36, 1)',
               background: '#121212',
               display: 'flex', alignItems: 'center', justifyContent: 'center',
               opacity: 1,
               cursor: leftSidebarOpen ? 'pointer' : 'default',
               pointerEvents: leftSidebarOpen ? 'auto' : 'none',
             }}
           >
             {leftSidebarOpen
               ? <ChevronLeft size={16} strokeWidth={2.5} style={{ color: '#fff', opacity: 0.7 }} />
               : <ChevronRight size={16} strokeWidth={2.5} style={{ color: '#fff', opacity: 0.45 }} />}
           </div>
          {/* Resize is handled by the invisible gap strip rendered after the assemblies */}
        </div>

        {/* ── Left hit-area (only when !open) — events for bar + peek region ── */}
        {!leftSidebarOpen && (
          <div
            onMouseEnter={() => { clearTimeout(leftHoverTimer.current); setLeftHovered(true); }}
            onMouseLeave={() => { leftHoverTimer.current = setTimeout(() => setLeftHovered(false), 100); }}
            onClick={() => { clearTimeout(leftHoverTimer.current); userClosedLeftSidebarRef.current = false; setLeftSidebarOpen(true); }}
            style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: BAR_WIDTH + PEEK_WIDTH,
              zIndex: 30,
              cursor: 'pointer',
            }}
          />
        )}

        {/* ── Middle ── */}
         <div style={{
            flex: '1 1 0%',
            background: '#121212',
            borderRadius: 12,
            overflow: 'hidden',
            position: 'relative',
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
             marginLeft: (leftSidebarOpen ? BAR_WIDTH + leftSidebarWidth : BAR_WIDTH + (leftHovered ? PEEK_WIDTH : 0)) + PANEL_GAP,
             marginRight: (rightSidebarOpen ? barW + rightSidebarWidth : barW + (rightHovered ? RIGHT_PEEK_WIDTH : 0)) + PANEL_GAP,
            transition: isResizing ? 'none' : 'margin 0.3s cubic-bezier(0.22, 0.61, 0.36, 1)',
          }}>
            <PlaylistMiddleModule
              selectedPlaylist={selectedPlaylist}
              loadingTracks={loadingTracks}
              displayMode={displayMode}
              setDisplayMode={setDisplayMode}
              playerOpen={playerOpen}
              handlePlay={handlePlay}
              handlePlayShuffle={handlePlayShuffle}
              handlePlayTrack={handlePlayTrack}
              rawOnPlayTrack={onPlayTrack}
              handlePlayPlaylist={onPlayPlaylist}
              handleSelectPlaylist={handleSelectPlaylist}
              handleBackToList={handleBackToList}
              handleBulkDelete={handleBulkDelete}
              handleCancelDeleteMode={handleCancelDeleteMode}
              handleOpenPlaylistFilters={handleOpenPlaylistFilters}
              handleOpenTrackFilters={handleOpenTrackFilters}
              handleImportXSPF={handleImportXSPF}
              handleRefresh={handleRefresh}
              handleCreateManualPlaylist={handleCreateManualPlaylist}
              fileInputRef={fileInputRef}
              coverInputRef={coverInputRef}
              playlistSort={playlistSort}
              trackSort={trackSort}
              trackFilterType={trackFilterType}
              playlistSortOptions={PLAYLIST_SORT_OPTIONS}
              trackSortOptions={TRACK_SORT_OPTIONS}
              trackFilterOptions={TRACK_FILTER_OPTIONS}
              onPlaylistSortChange={setPlaylistSort}
              onTrackSortChange={setTrackSort}
              onTrackFilterTypeChange={setTrackFilterType}
              onFilterApply={handleFilterApply}
              showFilterPanel={showFilterPanel}
              setShowFilterPanel={setShowFilterPanel}
              filterPanelType={filterPanelType}
              setFilterPanelType={setFilterPanelType}
              deleteMode={deleteMode}
              setDeleteMode={setDeleteMode}
              selectedForDelete={selectedForDelete}
              selectAllForDelete={selectAllForDelete}
              deletingTrackIds={deletingTrackIds}
              playlistDeleteMode={playlistDeleteMode}
              selectedPlaylistIds={selectedPlaylistIds}
              isImporting={isImporting}
              loading={loading}
              playlists={playlists}
              favorites={favorites}
              sortedPlaylists={sortedPlaylists}
              displayTracks={displayTracks}
              sortedTracks={sortedTracks}
              totalDurationSeconds={totalDurationSeconds}
              listItemSize={listItemSize}
              gridItems={gridItems}
              leavingTrackIds={leavingTrackIds}
              enteringTrackIds={enteringTrackIds}
              shiftAbove={shiftAbove}
              playingFileId={playingFileId}
              isPlayingActive={isPlayingActive}
              detailScrollRef={detailScrollRef}
              trackCount={sortedTracks.length}
              isLoved={!!selectedPlaylist?.isLoved}
              showAddMusicPanel={showAddMusicPanel}
              setShowAddMusicPanel={setShowAddMusicPanel}
              showCreateModal={showCreateModal}
              setShowCreateModal={setShowCreateModal}
              createTitle={createTitle}
              setCreateTitle={setCreateTitle}
              isCreating={isCreating}
              onMenuOpen={onMenuOpen}
              onToggleOrder={handlePlaylistOrderToggle}
              toggleSelectForDelete={toggleSelectForDelete}
              handleRemoveTrack={handleRemoveTrack}
              handleListItemsRendered={handleListItemsRendered}
              handleGridItemsRendered={handleGridItemsRendered}
              handleTrackGridSelect={handleTrackGridSelect}
              PlaylistHeroHeader={PlaylistHeroHeader}
              PlaylistToolbar={PlaylistToolbar}
            />
        </div>

        {/* ── Right sidebar assembly (ONE seamless surface: expandable bar at LEFT edge, preview fades in beside it, grows leftward via translate) ── */}
         <div
           style={{
             position: 'absolute', right: 0, top: 0, bottom: 0,
             width: rightSidebarOpen ? barW + rightSidebarWidth : rightPeeking ? barW + RIGHT_PEEK_WIDTH : barW,
             display: 'flex',
             flexDirection: 'row-reverse',
             transition: isResizing ? 'none' : 'width 0.3s cubic-bezier(0.22, 0.61, 0.36, 1)',
             zIndex: 10,
             background: '#121212',
             borderRadius: 12,
             overflow: 'hidden',
             pointerEvents: rightSidebarOpen || rightHovered ? 'auto' : 'none',
           }}
         >
           {/* Edge bar + chevron — expands slightly on hover, collapses when fully open */}
           <div style={{
             width: barW,
             flexShrink: 0,
             background: '#121212',
             display: 'flex', alignItems: 'center', justifyContent: 'center',
             opacity: rightSidebarOpen ? 0 : 1,
             transition: isResizing ? 'none' : 'opacity 0.3s cubic-bezier(0.22, 0.61, 0.36, 1)',
             overflow: 'hidden',
             pointerEvents: 'none',
           }}>
             <ChevronLeft
               size={16}
               strokeWidth={2.5}
               style={{ color: '#fff', opacity: rightHovered ? 1 : 0.45, transition: 'opacity 0.3s cubic-bezier(0.22, 0.61, 0.36, 1)', flexShrink: 0 }}
             />
           </div>
           {/* Preview content — fades in parallel with the slide so it feels like one surface */}
           <div style={{
             flex: 1,
             minWidth: 0,
             height: '100%',
             overflow: 'hidden',
             background: '#121212',
             opacity: rightSidebarOpen || rightPeeking ? 1 : 0,
             transition: isResizing ? 'none' : 'opacity 0.3s cubic-bezier(0.22, 0.61, 0.36, 1)',
           }}>
            <PlaylistRightModule
              open={previewMounted}
              width={rightSidebarWidth}
              mode={rightSidebarMode}
              onModeChange={setRightSidebarMode}
              onClose={() => { userClosedSidebarRef.current = true; setRightSidebarOpen(false); }}
              hasActivePlayback={hasActivePlayback}
              queue={queue}
              currentTrackIndex={currentTrackIndex}
              listeningLeaderboardMetric={listeningLeaderboardMetric}
              onMetricChange={setListeningLeaderboardMetric}
              leaderboardDisplayMode={leaderboardDisplayMode}
              onDisplayModeChange={setLeaderboardDisplayMode}
              formatListeningDuration={formatListeningDuration}
            />
          </div>
          {/* Resize is handled by the invisible gap strip rendered after the assemblies */}
        </div>

        {/* ── Right hit-area (only when !open) — events for bar + peek region ── */}
        {!rightSidebarOpen && (
          <div
            onMouseEnter={() => { clearTimeout(rightHoverTimer.current); setRightHovered(true); }}
            onMouseLeave={() => { rightHoverTimer.current = setTimeout(() => setRightHovered(false), 100); }}
            onClick={() => { clearTimeout(rightHoverTimer.current); userClosedSidebarRef.current = false; setRightSidebarMode(hasActivePlayback ? 'nowplaying' : 'leaderboard'); setRightSidebarOpen(true); }}
            style={{
              position: 'absolute', right: 0, top: 0, bottom: 0,
              width: BAR_WIDTH + RIGHT_PEEK_WIDTH,
              zIndex: 30,
              cursor: 'pointer',
            }}
          />
        )}

        {/* ── Left resize strip (invisible; thin accent line on hover/hold, in the gap) ── */}
        {leftSidebarOpen && (
          <div
            onMouseDown={(e) => handleResizeStart('left', e)}
            onMouseEnter={() => setLeftResizeHover(true)}
            onMouseLeave={() => setLeftResizeHover(false)}
            style={{
              position: 'absolute', top: 0, bottom: 0,
              left: (BAR_WIDTH + leftSidebarWidth) - 6,
              width: 12,
              zIndex: 20,
              cursor: 'col-resize',
              background: 'transparent',
              pointerEvents: 'auto',
            }}
          >
            <div style={{
              position: 'absolute', left: 5, top: 0, bottom: 0,
              width: 2,
              borderRadius: 2,
              background: (leftResizeHover || isResizing) ? 'rgba(136,146,230,0.7)' : 'transparent',
              transition: 'background 0.15s ease',
            }} />
          </div>
        )}

        {/* ── Right resize strip (invisible; thin accent line on hover/hold, in the gap) ── */}
        {rightSidebarOpen && (
          <div
            onMouseDown={(e) => handleResizeStart('right', e)}
            onMouseEnter={() => setRightResizeHover(true)}
            onMouseLeave={() => setRightResizeHover(false)}
            style={{
              position: 'absolute', top: 0, bottom: 0,
              right: (barW + rightSidebarWidth) - 6,
              width: 12,
              zIndex: 20,
              cursor: 'col-resize',
              background: 'transparent',
              pointerEvents: 'auto',
            }}
          >
            <div style={{
              position: 'absolute', left: 5, top: 0, bottom: 0,
              width: 2,
              borderRadius: 2,
              background: (rightResizeHover || isResizing) ? 'rgba(136,146,230,0.7)' : 'transparent',
              transition: 'background 0.15s ease',
            }} />
          </div>
        )}

      </div>
      </div>

      <FilterPanel
        open={showFilterPanel}
        onClose={() => setShowFilterPanel(false)}
        title="Filters"
        filterTypeOptions={filterPanelType === 'track' ? TRACK_FILTER_OPTIONS : null}
        filterType={trackFilterType}
        onFilterTypeChange={handleTrackFilterTypeChange}
        sortOptions={filterPanelType === 'playlist' ? PLAYLIST_SORT_OPTIONS : TRACK_SORT_OPTIONS}
        sortBy={filterPanelType === 'playlist' ? playlistSort.by : trackSort.by}
        sortOrder={filterPanelType === 'playlist' ? playlistSort.order : trackSort.order}
        onApply={handleFilterApply}
      />

      <AddMusicPanel
        isOpen={showAddMusicPanel}
        onClose={() => setShowAddMusicPanel(false)}
        playlistId={selectedPlaylist?.id}
        playlistTitle={selectedPlaylist?.title}
        existingTrackIds={sortedTracks.map(t => t.file_id).filter(Boolean)}
        onTracksAdded={(allTracks) => {
          if (!selectedPlaylist) return;
          if (Array.isArray(allTracks) && allTracks.length > 0) {
            cachedTracksRef.current = allTracks;
            setPlaylistTracks(allTracks);
            setCurrentPlaylistTracks(allTracks);
            resolveMissingDurations(allTracks);
            setPlaylists(prev => prev.map(p => p.id === selectedPlaylist.id ? { ...p, track_count: allTracks.length } : p));
          } else {
            loadPlaylist(selectedPlaylist.id).then((data) => {
              const tracks = data.tracks || [];
              cachedTracksRef.current = tracks;
              setPlaylistTracks(tracks);
              setCurrentPlaylistTracks(tracks);
              resolveMissingDurations(tracks);
              setPlaylists(prev => prev.map(p => p.id === selectedPlaylist.id ? { ...p, track_count: data.track_count, total_duration: data.total_duration, available_tracks: data.available_tracks } : p));
            }).catch(() => {});
          }
        }}
      />

      {createModal}
      {deleteConfirmModal}

      <input
        ref={coverInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={handleCoverFileChange}
      />

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .pv-no-focus button:focus:not(:focus-visible) {
          outline: none;
          box-shadow: none;
        }
      `}</style>
    </div>
  );
}
