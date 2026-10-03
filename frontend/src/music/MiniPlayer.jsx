import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Play, Pause, SkipBack, SkipForward, Maximize2, Heart, Shuffle, Repeat, Volume2, VolumeX } from 'lucide-react';
import usePlaybackStore from '../store/playbackStore';
import { useIsFavorite } from '../store/favoritesStore';
import { fetchBlob, getCached } from '../utils/thumbCache';
import { listeningTracker } from '../utils/listeningTracker.js';
import NetworkImage from '../shared/NetworkImage';
import { cancelAutoPlayPending, isAutoPlayPendingCanceled, resetAutoPlayPending } from '../utils/autoPlayPending';
import { createVideoSyncEngine, getSharedSyncCore } from '@homelab/sync-engine';
import { trackProfileStore } from '../utils/trackProfileStore.js';
import { registerBgRef, registerDecisionOutput, registerAnalyzerEvidence, isRegisteredBg, getRegisteredMvTime } from './SyncOverlay';

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MiniPlayer({ onExpand, onClose, sharedAudioRef, sharedPrevFileIdRef, audioReady, onFavoriteToggle, view = null }) {
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [coverUrl, setCoverUrl] = useState(null);
  const [mvError, setMvError] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [volume, setVolume] = useState(() => {
    try {
      const saved = localStorage.getItem('audio.volume');
      return saved != null ? Number(saved) : 0.7;
    } catch {
      return 0.7;
    }
  });
  const bgVideoRef = useRef(null);
  const volumeWrapRef = useRef(null);
  const reloadResumeAtRef = useRef(Number(sessionStorage.getItem('audioReloadResumeAt')) || 0);
  if (reloadResumeAtRef.current > 0) {
    const stored = Number(sessionStorage.getItem('audioReloadResumeAt')) || 0;
    reloadResumeAtRef.current = stored;
  }
  const lastSrcSetRef = useRef(0);

  const [autoPlayPending, setAutoPlayPending] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);

  const {
    isPlaying,
    play,
    pause,
    next,
    previous,
    queue,
    currentTrackIndex,
    shuffle,
    loopMode,
    setShuffle,
    setLoopMode,
  } = usePlaybackStore();

  const audioRef = sharedAudioRef;
  const prevFileIdRef = sharedPrevFileIdRef || { current: null };
  const currentTrack = queue?.[currentTrackIndex];
  const fileId = currentTrack?.file_id;
  const youtubeIdQueue = currentTrack?.youtube_id || null;

  // ── MV background state ─────────────────────────────────────────────────
  // BG shows the MV (blurred + dimmed) whenever the track has one — fully
  // independent of what the NowPlaying panel is displaying. #000000 remains
  // only as the base layer.
  const mvOffsetRef = useRef(0);

  // Queue data doesn't always carry youtube_id — resolve via the metadata
  // API once per track (same fallback as NowPlayingPanel / full player).
  const [resolvedYtId, setResolvedYtId] = useState(null);
  const ytMetaCacheRef = useRef(new Map());
  useEffect(() => {
    setResolvedYtId(null);
    if (!fileId || youtubeIdQueue) return undefined;
    if (ytMetaCacheRef.current.has(fileId)) {
      setResolvedYtId(ytMetaCacheRef.current.get(fileId));
      return undefined;
    }
    let cancelled = false;
    fetch(`/api/metadata/${fileId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const yid = data?.youtube_id || null;
        ytMetaCacheRef.current.set(fileId, yid);
        if (!cancelled) setResolvedYtId(yid);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [fileId, youtubeIdQueue]);

  const mvId = youtubeIdQueue || resolvedYtId;
  const showMvBg = !!mvId && !mvError;

  const isFav = useIsFavorite(fileId, currentTrack?.is_favorite ? 1 : 0);
  const handleToggleFavorite = useCallback(() => {
    if (!fileId || !onFavoriteToggle) return;
    onFavoriteToggle(currentTrack);
  }, [fileId, currentTrack, onFavoriteToggle]);

  const loadCover = useCallback((fid) => {
    if (!fid) {
      setCoverUrl(null);
      return;
    }
    const url = `/thumbnails/list/${fid}.jpg`;
    const cached = getCached(url);
    if (cached) {
      setCoverUrl(cached);
      return;
    }
    setCoverUrl(null);
    let cancelled = false;
    fetchBlob(url, { priority: 'low' }).then((u) => {
      if (!cancelled && u) setCoverUrl(u);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const cleanup = loadCover(fileId);
    return cleanup;
  }, [fileId, loadCover]);

  // Reset the error fallback when the track (and thus its video) changes.
  useEffect(() => {
    setMvError(false);
  }, [mvId]);

  // Stream errored = video not cached (yet). Poll the cache progress and
  // revive the BG the moment the download completes — same recovery as the
  // full player's background, instead of falling back to cover permanently.
  useEffect(() => {
    if (!mvError || !mvId) return undefined;
    let cancelled = false;
    let timer = null;
    const poll = async () => {
      try {
        const r = await fetch(`/api/video-cache/progress/${mvId}`);
        if (r.ok) {
          const d = await r.json();
          if (!cancelled && d?.status === 'cached') {
            setMvError(false);
            try { bgVideoRef.current?.load?.(); } catch {}
            return;
          }
        }
      } catch {}
      if (!cancelled) timer = setTimeout(poll, 1000);
    };
    poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [mvError, mvId]);

  // ── Shared sync core (app-wide singleton) ──────────────────────────────
  // Same master clock as the full player and the NowPlaying panel: shared
  // audio element + per-track video offset. Whoever creates the singleton
  // first, all surfaces compute identical targets.
  mvOffsetRef.current = Number(currentTrack?.video_offset) || 0;
  const trackChangeTimeRef = useRef(0);
  const analyzerEvidenceRef = useRef({ mv: [], bg: [] });
  const decisionOutputRef = useRef({ mv: null, bg: null });
  // Seek-guard state — mirrors the full player's BG engine so a waiting/stalled
  // video can't trigger seek storms (which showed up as random play/pause).
  const bgSeekInProgressRef = useRef(false);
  const bgSeekStartedAtRef = useRef(0);
  const bgPendingForceSeekRef = useRef(null);
  const syncCore = useMemo(() => getSharedSyncCore(() => {
    const audio = audioRef?.current;
    return (audio?.currentTime || 0) + (mvOffsetRef.current || 0);
  }), []);

  // ── BG sync engine (drives the blurred MV background) ──────────────────
  // Options mirror the full player's bgEngine (Music.jsx) so this decorative
  // layer is just as resilient: seek-guard, no pause-on-stall, same thresholds.
  const bgEngine = useMemo(() => createVideoSyncEngine({
    getCurrentTime: () => bgVideoRef.current?.currentTime ?? 0,
    getDuration: () => bgVideoRef.current?.duration ?? Infinity,
    getPaused: () => bgVideoRef.current?.paused ?? true,
    getSeeking: () => bgVideoRef.current?.seeking ?? false,
    getReadyState: () => bgVideoRef.current?.readyState ?? 0,
    seek: (t) => {
      const bg = bgVideoRef.current;
      if (!bg || !isFinite(bg.duration) || bg.duration <= 0) return;
      const target = ((t % bg.duration) + bg.duration) % bg.duration;
      const cur = bg.currentTime || 0;
      const gap = Math.abs(cur - target);
      if (gap < 0.001) {
        bgSeekInProgressRef.current = false;
        bgSeekStartedAtRef.current = 0;
        return;
      }
      if (bgSeekInProgressRef.current) {
        if (performance.now() - bgSeekStartedAtRef.current > 2000) {
          bgSeekInProgressRef.current = false;
        } else {
          // Coalesce: remember the newest target and chase it on seeked.
          bgPendingForceSeekRef.current = target;
          return;
        }
      }
      bg.currentTime = target;
      bgSeekInProgressRef.current = true;
      bgSeekStartedAtRef.current = performance.now();
    },
    play: () => { bgVideoRef.current?.play?.().catch?.(() => {}); return Promise.resolve(); },
    pause: () => { try { bgVideoRef.current?.pause?.(); } catch {} return Promise.resolve(); },
    setRate: (r) => { if (bgVideoRef.current) { try { bgVideoRef.current.playbackRate = r; } catch {} } },
    getIsPlaying: () => usePlaybackStore.getState().isPlaying,
    looping: true,
    hardSeekThreshold: 0.25,
    jumpSeekThreshold: 1.0,
    rateMin: 0.003,
    rateGain: 0.8,
    seekCooldown: 500,
    stallTimeout: 2000,
    gracePeriod: 10,
    pauseOnStall: false,
    pauseIfFarFromTarget: false,
    farThreshold: 0.5,
    adaptiveThreshold: true,
    getAdaptiveThresholds: () => syncCore.getAdaptiveThresholds('bg'),
    getNetworkState: () => bgVideoRef.current?.networkState || 0,
    getWaiting: () => bgVideoRef.current?.waiting || false,
    getStalled: () => bgVideoRef.current?.stalled || false,
    getRvfcStatus: () => 'UNSUPPORTED',
    getDroppedFrames: () => 0,
    getDecodeLatencyMs: () => 0,
    getAudioCurrentTime: () => audioRef?.current?.currentTime || 0,
    getVideoPlaybackRate: () => bgVideoRef.current?.playbackRate || 1,
    getBgPlaybackRate: () => 1,
    getVideoOffset: () => mvOffsetRef.current || 0,
    // REAL counterpart time from the surface registry (right-panel MV when it
    // is active). NaN when absent → engine reports hasTriangle:false honestly.
    getMvCurrentTime: () => getRegisteredMvTime(),
    getBgCurrentTime: () => bgVideoRef.current?.currentTime ?? 0,
    log: () => {},
    trackChangeTimeRef,
    syncCore,
    profileStore: trackProfileStore,
    engineName: 'bg',
    analyzerEvidenceRef,
    decisionOutputRef,
  }), [syncCore]);

  // Tick loop — drives the BG video from the shared audio clock while the
  // surface is active (has MV, not errored, not gated by the panel MV) AND
  // playback is actually running. Pausing the music freezes/stops the BG
  // decode entirely; resuming re-anchors to the current audio position.
  useEffect(() => {
    if (!showMvBg || !audioReady || !isPlaying) return undefined;
    if (reloadResumeAtRef.current > Date.now()) return undefined;
    const audio = audioRef?.current;
    if (!audio) return undefined;
    const lastTick = { current: performance.now() };
    const id = setInterval(() => {
      const now = performance.now();
      const tickDelta = now - lastTick.current;
      lastTick.current = now;
      const audioTarget = (audio.currentTime || 0) + (mvOffsetRef.current || 0);
      try { bgEngine.tick(audioTarget, tickDelta); } catch {}
    }, 40);
    bgEngine.anchor({
      play: !audio.paused,
      target: (audio.currentTime || 0) + (mvOffsetRef.current || 0),
    });
    return () => {
      clearInterval(id);
      bgEngine.pause();
    };
  }, [showMvBg, audioReady, isPlaying, audioRef, bgEngine]);

  // Re-anchor when the track changes so the new BG starts at the right spot.
  useEffect(() => {
    if (!showMvBg) return;
    if (reloadResumeAtRef.current > Date.now()) return;
    const audio = audioRef?.current;
    if (!audio) return;
    bgVideoRef.current?.load?.();
    bgEngine.anchor({
      play: !audio.paused,
      target: (audio.currentTime || 0) + (Number(currentTrack?.video_offset) || 0),
    });
  }, [mvId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prevent BG video from autoplaying on reload when audio is paused.
  useEffect(() => {
    if (!showMvBg) return;
    const bg = bgVideoRef.current;
    if (!bg) return;
    if (audioReady && audioRef?.current && audioRef.current.paused) {
      bg.pause();
    }
  }, [showMvBg, audioReady]);

  // ── Surface registry: claim 'bg' while this BG is active ────────────────
  // Makes THIS video element the triangle/overlay's BG time source and exposes
  // this engine's decision/analyzer evidence to the sync overlay. Ownership
  // check on cleanup — never clear a registry entry owned by another surface
  // (e.g. the full player, which registers on mount in the audio view).
  useEffect(() => {
    if (!showMvBg) return undefined;
    registerBgRef(bgVideoRef);
    registerDecisionOutput(decisionOutputRef.current);
    registerAnalyzerEvidence(analyzerEvidenceRef.current);
    return () => {
      if (isRegisteredBg(bgVideoRef)) {
        registerBgRef(null);
      }
    };
  }, [showMvBg]);

  // ── Audio seeked → immediate re-anchor (Music.jsx pattern) ──────────────
  // Single source of truth for seek-driven re-anchor: without this, the BG
  // only corrects via drift after pause/resume re-runs the tick effect.
  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio || !showMvBg) return undefined;
    const onSeeked = () => {
      const playing = usePlaybackStore.getState().isPlaying;
      bgEngine.anchor({
        play: playing,
        target: (audio.currentTime || 0) + (mvOffsetRef.current || 0),
      });
    };
    audio.addEventListener('seeked', onSeeked);
    return () => audio.removeEventListener('seeked', onSeeked);
  }, [showMvBg, audioRef, bgEngine]);

  // Clear the reload grace-period gate once Music.jsx fires the resume event.
  useEffect(() => {
    const onReloadResume = () => { reloadResumeAtRef.current = 0; };
    window.addEventListener('audio-reload-resume', onReloadResume);
    return () => window.removeEventListener('audio-reload-resume', onReloadResume);
  }, []);

  useEffect(() => {
    const onOnline = () => loadCover(fileId);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [fileId, loadCover]);

  useEffect(() => {
    if (!audioReady || !fileId) return;
    const audio = audioRef?.current;
    if (!audio) return;

    const isSameTrack = prevFileIdRef.current === fileId;
    prevFileIdRef.current = fileId;

    const handleLoadedMetadata = () => setDuration(audio.duration || 0);
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime || 0);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);

    if (isSameTrack) {
      setDuration(audio.duration || 0);
      setCurrentTime(audio.currentTime || 0);
      return () => {
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('timeupdate', handleTimeUpdate);
      };
    }

    const store = usePlaybackStore.getState();
    audio.currentTime = store.position > 0 ? store.position : 0;
    audio.src = `/file/${fileId}`;
    lastSrcSetRef.current = performance.now();
    audio.load();

    const handleCanPlay = () => {
      setDuration(audio.duration || 0);
      if (usePlaybackStore.getState().isPlaying && reloadResumeAtRef.current <= Date.now()) {
        audio.play().catch(() => {});
      }
    };

    if (audio.readyState >= 3) {
      handleCanPlay();
    } else {
      audio.addEventListener('canplay', handleCanPlay, { once: true });
    }

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('canplay', handleCanPlay);
    };
  }, [fileId, audioReady, audioRef]);

  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio || !audioReady) return;
    const update = () => setAudioPlaying(!audio.paused);
    update();
    const onPlay = () => { if (!audio.paused) play(); };
    const onPause = () => {
      if (performance.now() - lastSrcSetRef.current < 600) return;
      cancelAutoPlayPending();
      pause();
      setAudioPlaying(false);
    };
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('playing', update);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('playing', update);
    };
  }, [audioRef, audioReady, play, pause]);

  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio || !audioReady) return;
    if (isPlaying && audio.paused) {
      if (reloadResumeAtRef.current > Date.now()) return;
      audio.play().catch((err) => {
        if (err?.name === 'NotAllowedError') {
          setAutoPlayPending(true);
          resetAutoPlayPending();
        }
      });
    } else if (!isPlaying && !audio.paused) {
      audio.pause();
    }
  }, [isPlaying, audioRef, audioReady]);

  useEffect(() => {
    if (autoPlayPending && userInteracted && audioRef?.current && !isAutoPlayPendingCanceled()) {
      audioRef.current.play().catch(() => {});
      setAutoPlayPending(false);
      resetAutoPlayPending();
    }
  }, [autoPlayPending, userInteracted, audioRef]);

  useEffect(() => {
    const mark = () => setUserInteracted(true);
    window.addEventListener('pointerdown', mark);
    window.addEventListener('keydown', mark);
    return () => {
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('keydown', mark);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio || !audioReady || !fileId) return;
    const displayName = currentTrack?.display_name || currentTrack?.name || null;
    listeningTracker.attach(audio, fileId, displayName);
    return () => {
      listeningTracker.detach();
      listeningTracker.forcePersist();
    };
  }, [fileId, audioReady, audioRef, currentTrack?.display_name, currentTrack?.name]);

  const handleSeek = useCallback((e) => {
    const audio = audioRef?.current;
    if (!audio || duration === 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = percent * duration;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration, audioRef]);

  const handlePlayPause = useCallback(() => {
    const audio = audioRef?.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
      play();
      setAutoPlayPending(false);
      resetAutoPlayPending();
    } else {
      cancelAutoPlayPending();
      audio.pause();
      pause();
    }
  }, [play, pause, audioRef]);

  const handleExpand = useCallback(() => {
    onExpand?.();
  }, [onExpand]);

  const handleVolumeChange = useCallback((e) => {
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    if (audioRef?.current) {
      audioRef.current.volume = newVol;
    }
    try {
      localStorage.setItem('audio.volume', String(Math.round(newVol * 100)));
    } catch {}
  }, [audioRef]);

  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio) return;
    const sync = () => setVolume(audio.volume ?? 0);
    audio.addEventListener('volumechange', sync);
    sync();
    return () => audio.removeEventListener('volumechange', sync);
  }, [audioRef]);

  // Mouse-wheel volume control on the volume bar. Non-passive so we can
  // preventDefault and stop the page from scrolling while adjusting volume.
  useEffect(() => {
    const el = volumeWrapRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const audio = audioRef?.current;
      const current = audio ? Math.round(audio.volume * 100) : Math.round(volume * 100);
      const step = 5;
      const next = Math.max(0, Math.min(100, current - Math.sign(e.deltaY) * step));
      handleVolumeChange({ target: { value: String(next / 100) } });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [audioRef, volume, handleVolumeChange]);

  const toggleMute = useCallback(() => {
    const newVol = volume > 0 ? 0 : 0.7;
    setVolume(newVol);
    if (audioRef?.current) {
      audioRef.current.volume = newVol;
    }
    try {
      localStorage.setItem('audio.volume', String(Math.round(newVol * 100)));
    } catch {}
  }, [volume, audioRef]);

  const handleShuffle = useCallback(() => {
    setShuffle(!shuffle);
  }, [shuffle, setShuffle]);

  const handleLoop = useCallback(() => {
    const modes = ['off', 'all', 'one'];
    const idx = modes.indexOf(loopMode);
    setLoopMode(modes[(idx + 1) % modes.length]);
  }, [loopMode, setLoopMode]);

  useEffect(() => {
    const onKey = (e) => {
      const target = e.target;
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )) return;

      if (view === 'media' || view === 'sendqueue') return;

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return;

      let handled = true;
      switch (e.key) {
        case ' ':
        case 'Spacebar':
          handlePlayPause();
          break;
        case 'm':
        case 'M':
          next();
          break;
        case 'n':
        case 'N':
          previous();
          break;
        case 'l':
        case 'L':
          handleToggleFavorite();
          break;
        case 'b':
        case 'B':
          handleShuffle();
          break;
        case 'j':
        case 'J':
          handleLoop();
          break;
        case 'g':
        case 'G': {
          const audio = audioRef?.current;
          if (audio) audio.currentTime = Math.max(0, audio.currentTime - 5);
          break;
        }
        case 'h':
        case 'H': {
          const audio = audioRef?.current;
          if (audio) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
          break;
        }
        default:
          handled = false;
          break;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [handlePlayPause, next, previous, handleToggleFavorite, handleShuffle, handleLoop, shuffle, loopMode, view]);

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      <div
        data-debug-id="1.2"
        data-debug-name="MiniPlayer"
        data-debug-type="floating"
        className="w-full flex-shrink-0 bg-black relative overflow-hidden"
      >
        {/* ── Background layer (z-0): MV blurred+dimmed when available.
            NO cover fallback by design — without a video the layer stays
            empty and the container's #000 base shows through. ── */}
        {showMvBg && (
          <video
            key={mvId}
            ref={bgVideoRef}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            style={{
              filter: `blur(12px) saturate(1.4) brightness(${isPlaying ? 0.5 : 0.32})`,
              zIndex: 0,
              opacity: 1,
              transition: 'opacity 500ms ease, filter 400ms ease',
              maskImage: 'linear-gradient(to bottom, black 55%, rgba(0,0,0,0.4))',
              WebkitMaskImage: 'linear-gradient(to bottom, black 55%, rgba(0,0,0,0.4))',
            }}
            src={`/api/video-cache/stream/${mvId}`}
            muted
            playsInline
            preload="metadata"
            onLoadStart={() => {
              const bg = bgVideoRef.current;
              if (syncCore && bg) {
                syncCore.setVideoSrc('bg', bg.src || bg.currentSrc);
                syncCore.recordVideoLifecycleEvent('bg', 'loadstart', bg);
              }
            }}
            onLoadedData={() => {
              const bg = bgVideoRef.current;
              if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'loadeddata', bg);
            }}
            onLoadedMetadata={() => {
              const bg = bgVideoRef.current;
              if (syncCore && bg) {
                syncCore.setVideoSrc('bg', bg.src || bg.currentSrc);
                syncCore.recordVideoLifecycleEvent('bg', 'loadedmetadata', bg);
              }
              const audio = audioRef?.current;
              if (audio && audio.paused) {
                bg.pause();
              }
            }}
            onWaiting={() => { try { bgEngine.onWaiting(); } catch {} }}
            onStalled={() => { try { bgEngine.onStalled(); } catch {} }}
            onPlaying={() => {
              const bg = bgVideoRef.current;
              if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'playing', bg);
              try { bgEngine.onPlaying(); } catch {}
            }}
            onSeeked={() => {
              const bg = bgVideoRef.current;
              if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'seeked', bg);
              // Chase a coalesced seek target if one arrived while seeking.
              const pendingForce = bgPendingForceSeekRef.current;
              bgSeekInProgressRef.current = false;
              bgSeekStartedAtRef.current = 0;
              bgPendingForceSeekRef.current = null;
              if (pendingForce != null && bg && Math.abs((bg.currentTime || 0) - pendingForce) > 0.05) {
                try { bg.currentTime = pendingForce; } catch {}
              }
              try { bgEngine.onSeeked(); } catch {}
            }}
            onPause={() => {
              const bg = bgVideoRef.current;
              if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'pause', bg);
            }}
            onEnded={() => {
              const bg = bgVideoRef.current;
              if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'ended', bg);
              // Loop the decorative BG back onto the audio clock if audio
              // is still playing (same behavior as the full player's BG).
              if (!usePlaybackStore.getState().isPlaying) return;
              const audioTarget = (audioRef?.current?.currentTime || 0) + (mvOffsetRef.current || 0);
              try { bgEngine.anchor({ play: true, target: audioTarget }); } catch {}
            }}
            onError={() => setMvError(true)}
          />
        )}
        <div className="relative z-10 flex items-center gap-4 p-3">
          {/* KIRI - Cover + Track Info */}
          <div className="w-72 flex-shrink-0 flex items-center gap-3">
            <div className="w-14 h-14 flex-shrink-0 rounded-xl overflow-hidden bg-neutral-800 shadow-lg">
              <NetworkImage
                src={coverUrl || `/thumbnails/list/${fileId}.jpg`}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0 flex flex-col gap-0.5">
              <div className="text-[13px] font-medium text-white truncate">
                {currentTrack?.display_name || currentTrack?.name || 'Unknown Track'}
              </div>
              <div className="text-[11px] text-neutral-400 truncate">
                {currentTrack?.artist || currentTrack?.album || ''}
              </div>
            </div>
          </div>

          {/* TENGAH - Seek Bar + Controls */}
          <div className="flex-1 min-w-0 flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-2 w-full max-w-xl">
              <span className="text-[10px] text-neutral-500 w-8 text-right tabular-nums">{formatTime(currentTime)}</span>
              <div
                onClick={handleSeek}
                className="flex-1 h-1.5 bg-neutral-700/60 rounded-full cursor-pointer group relative"
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${progress}%`, background: 'linear-gradient(90deg,#0EA5E9,#8892E6)' }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-all pointer-events-none"
                  style={{ left: `calc(${progress}% - 5px)` }}
                />
              </div>
              <span className="text-[10px] text-neutral-500 w-8 tabular-nums">{formatTime(duration)}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleShuffle}
                className={`transition-colors p-1.5 rounded-lg hover:bg-neutral-700 focus:outline-none focus:ring-0 ${shuffle ? '' : 'text-neutral-400 hover:text-white'}`}
                title={shuffle ? 'Shuffle on' : 'Shuffle off'}
                style={shuffle ? { color: '#8892E6' } : undefined}
              >
                <Shuffle size={14} />
              </button>
              <button
                onClick={previous}
                className="text-neutral-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-neutral-700 focus:outline-none focus:ring-0"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
              >
                <SkipBack size={16} />
              </button>
              <button
                onClick={handlePlayPause}
                className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-all flex-shrink-0 focus:outline-none focus:ring-0"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
              >
                {audioPlaying ? (
                  <Pause size={14} fill="currentColor" />
                ) : (
                  <Play size={14} fill="currentColor" className="ml-0.5" />
                )}
              </button>
              <button
                onClick={next}
                className="text-neutral-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-neutral-700 focus:outline-none focus:ring-0"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
              >
                <SkipForward size={16} />
              </button>
              <button
                onClick={handleLoop}
                className={`relative transition-colors p-1.5 rounded-lg hover:bg-neutral-700 focus:outline-none focus:ring-0 ${loopMode !== 'off' ? '' : 'text-neutral-400 hover:text-white'}`}
                title={`Loop: ${loopMode}`}
                style={loopMode !== 'off' ? { color: '#8892E6' } : undefined}
              >
                <Repeat size={14} />
                {loopMode === 'one' && (
                  <span className="absolute -top-1 -right-1 text-[8px] font-bold bg-indigo-500 text-white rounded-full w-3 h-3 flex items-center justify-center leading-none">1</span>
                )}
              </button>
            </div>
          </div>

           {/* KANAN - Volume + Actions */}
           <div className="flex items-center gap-2">
             <button
               onClick={handleToggleFavorite}
               className={`transition-colors p-1.5 rounded-lg hover:bg-neutral-700 focus:outline-none focus:ring-0 flex-shrink-0 ${isFav ? 'text-red-400' : 'text-neutral-400 hover:text-red-400'}`}
               title={isFav ? 'Remove from favorites' : 'Add to favorites'}
             >
               <Heart size={14} className={isFav ? 'fill-red-400' : ''} />
             </button>
             <button
               onClick={toggleMute}
               className="text-neutral-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-neutral-700 focus:outline-none focus:ring-0 flex-shrink-0"
               title={volume === 0 ? 'Unmute' : 'Mute'}
             >
               {volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
             </button>
<div className="flex-1 min-w-0 flex items-center" style={{ minWidth: 80, maxWidth: 160 }}>
                  <div ref={volumeWrapRef} className="relative w-full" style={{ height: 24 }}>
                   <div className="absolute inset-0 flex items-center">
<div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#262626' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${volume * 100}%`, background: 'linear-gradient(90deg,#0EA5E9,#8892E6)' }} />
                      </div>
                   </div>
                   <input
                     type="range"
                     min="0"
                     max="100"
                     value={Math.round(volume * 100)}
                     onChange={(e) => {
                       const newVol = parseInt(e.target.value) / 100;
                       setVolume(newVol);
                       if (audioRef?.current) {
                         audioRef.current.volume = newVol;
                       }
                       try {
                         localStorage.setItem('audio.volume', String(Math.round(newVol * 100)));
                       } catch {}
                     }}
                     className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
                     title={`Volume: ${Math.round(volume * 100)}%`}
                   />
                 </div>
               </div>
<button
  onClick={handleExpand}
  className="p-1.5 rounded-lg hover:bg-neutral-700 focus:outline-none focus:ring-0 flex-shrink-0 transition-colors"
  style={{ color: '#8892E6' }}
  title="Full player"
>
  <Maximize2 size={14} />
</button>
           </div>
        </div>
      </div>
    </>
  );
}
