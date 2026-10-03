import React, { memo, useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { FixedSizeList } from 'react-window';
import NetworkImage from '../shared/NetworkImage';
import CachedVideoPlayer from './CachedVideoPlayer';
import { createVideoSyncEngine, getSharedSyncCore, isValidTelemetrySample } from '@homelab/sync-engine';
import { trackProfileStore } from '../utils/trackProfileStore.js';
import { registerMvRef, registerDecisionOutput, registerAnalyzerEvidence, isRegisteredMv, getRegisteredBgTime } from './SyncOverlay';
import usePlaybackStore from '../store/playbackStore';

const QUEUE_ITEM_HEIGHT = 46;

const QueueRow = memo(function QueueRow({ index, style, data }) {
  const t = data[index];
  const tFid = t.file_id || t.id;
  const tName = t.display_name || t.name || 'Unknown';
  const tArtist = t.artist || 'Unknown Artist';
  return (
    <div style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', height: '100%' }}>
        <div style={{ width: 32, height: 32, borderRadius: 6, background: '#262626', flexShrink: 0, overflow: 'hidden' }}>
          {tFid ? (
            <NetworkImage src={`/thumbnails/list/${tFid}.jpg`} alt="" className="w-full h-full object-cover" />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#525252" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
              </svg>
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: '#e5e5e5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{tName}</div>
          <div style={{ fontSize: 12, color: '#737373', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{tArtist}</div>
        </div>
      </div>
    </div>
  );
});

export default function NowPlayingPanel({ queue, currentTrackIndex }) {
  const currentTrack = queue && queue.length > 0 ? queue[currentTrackIndex] : null;
  const fid = currentTrack?.file_id || currentTrack?.id;
  const displayName = currentTrack?.display_name || currentTrack?.name || 'Memutar Audio...';
  const artist = currentTrack?.artist || 'Unknown Artist';
  const album = currentTrack?.album || '';
  const youtubeIdQueue = currentTrack?.youtube_id || null;
  // Queue data doesn't always carry youtube_id — resolve it from the metadata
  // API once per track (same fallback the full player uses when toggling MV).
  const [youtubeIdResolved, setYoutubeIdResolved] = useState(null);
  const youtubeMetaCacheRef = useRef(new Map());
  useEffect(() => {
    setYoutubeIdResolved(null);
    if (!fid) return undefined;
    if (youtubeIdQueue) return undefined;
    if (youtubeMetaCacheRef.current.has(fid)) {
      setYoutubeIdResolved(youtubeMetaCacheRef.current.get(fid));
      return undefined;
    }
    let cancelled = false;
    fetch(`/api/metadata/${fid}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const yid = data?.youtube_id || null;
        youtubeMetaCacheRef.current.set(fid, yid);
        if (!cancelled) setYoutubeIdResolved(yid);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [fid, youtubeIdQueue]);
  const youtubeId = youtubeIdQueue || youtubeIdResolved;
  // MV preview: hover shows the video briefly; click toggles MV/cover.
  const [hoverPreview, setHoverPreview] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  // Lazy-mount the video the first time it's shown, then keep it mounted so
  // subsequent hovers/toggles crossfade instead of reloading from scratch.
  const [hasActivated, setHasActivated] = useState(false);
  const isVideo = showVideo || hoverPreview;
  const upcoming = useMemo(() => queue ? queue.slice(currentTrackIndex + 1) : [], [queue, currentTrackIndex]);
  const scrollRef = useRef(null);
  const [scrollH, setScrollH] = useState(0);

  // ── Self-contained A/V sync engine for the MV in this panel ─────────────
  // CachedVideoPlayer has no autoplay; it must be driven by a sync engine that
  // follows the shared audio clock (same design as the full player's mvEngine).
  const videoRef = useRef(null);
  const videoOffsetRef = useRef(0);
  videoOffsetRef.current = Number(currentTrack?.video_offset) || 0;

  // RVFC feedback (mirrors the full player): presentation latency / frame age /
  // decode latency fed into the engine so composite confidence rises and the MV
  // converges to adaptive soft-seek/setRate instead of relying on hard seeks.
  const rvfcMvDataRef = useRef(null);
  const rvfcMvLastTimeRef = useRef(0);
  const rvfcStatusRef = { mv: 'UNSUPPORTED' };

  // App-wide singleton core — same master clock, thresholds, and decision
  // constraints as the full player's MV/BG engines (triangle mirror).
  const syncCore = getSharedSyncCore(() => {
    const audio = usePlaybackStore.getState().audioRef;
    return (audio?.currentTime || 0) + (videoOffsetRef.current || 0);
  });

  const trackChangeTimeRef = useRef(0);
  const analyzerEvidenceRef = useRef({ mv: [], bg: [] });
  const decisionOutputRef = useRef({ mv: null, bg: null });

  const mvEngine = useMemo(() => createVideoSyncEngine({
    getCurrentTime: () => videoRef.current?.getCurrentTime?.() ?? 0,
    getDuration: () => videoRef.current?.getDuration?.() ?? Infinity,
    getPaused: () => videoRef.current?.getPaused?.() ?? true,
    getSeeking: () => videoRef.current?.getSeeking?.() ?? false,
    getReadyState: () => videoRef.current?.getReadyState?.() ?? 0,
    seek: (t) => { videoRef.current?.forceSeek?.(t); },
    play: () => Promise.resolve(videoRef.current?.playVideo?.()),
    pause: () => { videoRef.current?.pauseVideo?.(); return Promise.resolve(); },
    setRate: (r) => { videoRef.current?.setRate?.(r); },
    getIsPlaying: () => usePlaybackStore.getState().isPlaying,
    looping: false,
    hardSeekThreshold: 0.25,
    jumpSeekThreshold: 1.0,
    rateMin: 0.003,
    rateGain: 0.8,
    seekCooldown: 500,
    stallTimeout: 3000,
    gracePeriod: 10,
    pauseIfFarFromTarget: false,
    farThreshold: 0.5,
    adaptiveThreshold: true,
    getAdaptiveThresholds: () => syncCore.getAdaptiveThresholds('mv'),
    getNetworkState: () => videoRef.current?.networkState || 0,
    getWaiting: () => videoRef.current?.getWaiting?.(),
    getStalled: () => videoRef.current?.getStalled?.(),
    getRvfcStatus: () => rvfcStatusRef.mv,
    getDroppedFrames: () => 0,
    getDecodeLatencyMs: () => 0,
    getAudioCurrentTime: () => usePlaybackStore.getState().audioRef?.currentTime || 0,
    getVideoPlaybackRate: () => videoRef.current?.getRate?.() || 1,
    getBgPlaybackRate: () => 1,
    getVideoOffset: () => videoOffsetRef.current || 0,
    getMvCurrentTime: () => videoRef.current?.getCurrentTime?.() ?? 0,
    // REAL counterpart time from the surface registry (MiniPlayer BG when it
    // is active). NaN when absent → engine reports hasTriangle:false honestly.
    getBgCurrentTime: () => getRegisteredBgTime(),
    getRvfcMvPresentationTime: () => rvfcMvDataRef.current?.presentationTime,
    getRvfcBgPresentationTime: () => undefined,
    getRvfcMvExpectedDisplayTime: () => rvfcMvDataRef.current?.expectedDisplayTime,
    getRvfcBgExpectedDisplayTime: () => undefined,
    getRvfcMvMediaTime: () => rvfcMvDataRef.current?.mediaTime,
    getRvfcBgMediaTime: () => undefined,
    log: () => {},
    trackChangeTimeRef,
    syncCore,
    profileStore: trackProfileStore,
    engineName: 'mv',
    analyzerEvidenceRef,
    decisionOutputRef,
  }), [syncCore]);

  // Apply the same per-track sync profile the full player uses, so this
  // mirror converges with identical soft-seek/setRate behavior.
  useEffect(() => {
    if (!fid || !syncCore) return;
    const mediaId = String(fid);
    const profile = trackProfileStore.getOrCreate(mediaId);
    if ((profile.getEffectiveConfidence?.() ?? 0) > 0.1) {
      syncCore.applyProfile('mv', profile);
      mvEngine.softReset();
    }
    trackProfileStore.setCurrentTrackId(mediaId);
  }, [fid, syncCore, mvEngine]);

  // Drive the engine with a tick loop while the MV is visible, following the
  // shared audio element. Anchor on entry so it starts playing immediately.
  useEffect(() => {
    if (!isVideo || !youtubeId) return;
    const audio = usePlaybackStore.getState().audioRef;
    if (!audio) return;
    const lastTickTimeRef = { current: performance.now() };
    const id = setInterval(() => {
      const now = performance.now();
      const tickDelta = now - lastTickTimeRef.current;
      lastTickTimeRef.current = now;
      const audioTarget = (audio.currentTime || 0) + (videoOffsetRef.current || 0);
      try { mvEngine.tick(audioTarget, tickDelta); } catch (_) {}
    }, 30);
    // Start the MV synced to the current audio position (paused audio stays paused).
    mvEngine.anchor({ play: !audio.paused, target: (audio.currentTime || 0) + (videoOffsetRef.current || 0) });
    return () => {
      clearInterval(id);
      mvEngine.pause();
    };
  }, [isVideo, youtubeId, mvEngine]);

  // ── Audio seeked → immediate re-anchor (Music.jsx pattern) ──────────────
  // Single source of truth for seek-driven re-anchor: without this, the panel
  // MV only corrects via drift after the tick effect re-runs.
  useEffect(() => {
    if (!isVideo || !youtubeId) return undefined;
    const audio = usePlaybackStore.getState().audioRef;
    if (!audio) return undefined;
    const onSeeked = () => {
      const playing = usePlaybackStore.getState().isPlaying;
      mvEngine.anchor({
        play: playing,
        target: (audio.currentTime || 0) + (videoOffsetRef.current || 0),
      });
    };
    audio.addEventListener('seeked', onSeeked);
    return () => audio.removeEventListener('seeked', onSeeked);
  }, [isVideo, youtubeId, mvEngine]);

  // ── Surface registry: claim 'mv' while this MV is visible ───────────────
  // Makes THIS video handle the triangle/overlay's MV time source and exposes
  // this engine's decision/analyzer evidence to the sync overlay. Ownership
  // check on cleanup — never clear a registry entry owned by another surface
  // (the full player registers its own MV on mount in the audio view).
  useEffect(() => {
    if (!isVideo || !youtubeId) return undefined;
    registerMvRef(videoRef);
    registerDecisionOutput(decisionOutputRef.current);
    registerAnalyzerEvidence(analyzerEvidenceRef.current);
    return () => {
      if (isRegisteredMv(videoRef)) {
        registerMvRef(null);
      }
    };
  }, [isVideo, youtubeId]);

  // RVFC feed — CachedVideoPlayer's built-in loop calls this each presented
  // frame. Feeds presentation latency / frame age / decode latency into the
  // engine so composite confidence rises (same design as the full player).
  const onMvVideoFrame = useCallback((frame) => {
    rvfcMvLastTimeRef.current = performance.now();
    rvfcMvDataRef.current = {
      presentationTime: frame.presentationTime ?? null,
      expectedDisplayTime: frame.expectedDisplayTime ?? null,
      mediaTime: frame.mediaTime ?? null,
      processingDuration: frame.processingDuration ?? null,
    };
    const ctx = { minAgeMs: 500, trackChangeTime: trackChangeTimeRef.current };
    if (syncCore && frame.expectedDisplayTime != null && frame.presentationTime != null) {
      const presLatMs = frame.expectedDisplayTime - frame.presentationTime;
      if (isValidTelemetrySample(presLatMs, ctx)) syncCore.observePresentationLatency('mv', presLatMs);
      const frameAgeMs = performance.now() - frame.presentationTime;
      if (isValidTelemetrySample(frameAgeMs, ctx)) syncCore.observeFrameAge('mv', frameAgeMs);
    }
    if (syncCore && frame.processingDuration != null) {
      if (isValidTelemetrySample(frame.processingDuration, ctx)) syncCore.observeDecodeLat('mv', frame.processingDuration);
    }
    if (syncCore) syncCore.observeFrame('mv', performance.now());
  }, [syncCore]);

  // RVFC status monitor — drives getRvfcStatus so the engine can raise confidence.
  useEffect(() => {
    const update = () => {
      const now = performance.now();
      const mvPaused = videoRef.current?.getPaused?.() ?? true;
      const supported = rvfcMvLastTimeRef.current > 0;
      if (supported) {
        if (mvPaused) rvfcStatusRef.mv = 'PAUSED';
        else if (now - rvfcMvLastTimeRef.current > 1000) rvfcStatusRef.mv = 'TIMEOUT';
        else rvfcStatusRef.mv = 'ACTIVE';
      } else {
        rvfcStatusRef.mv = 'UNSUPPORTED';
      }
    };
    const id = setInterval(update, 500);
    update();
    return () => clearInterval(id);
  }, []);

  // Position the video at the audio offset once metadata loads, so the first
  // presented frame matches the current playback position.
  const onVideoLoadedMetadata = () => {
    // Mirror lifecycle into the shared core so observability sees this
    // surface exactly like the full player's MV.
    if (syncCore && youtubeId) {
      syncCore.setVideoSrc('mv', `/api/video-cache/stream/${youtubeId}`);
      recordMvLifecycle('loadedmetadata');
    }
    const video = videoRef.current;
    if (video && (video.getCurrentTime?.() ?? 0) < 0.05) {
      const audio = usePlaybackStore.getState().audioRef;
      const t = (audio?.currentTime || 0) + (videoOffsetRef.current || 0);
      if (t > 0.05) video.forceSeek?.(t);
    }
  };

  // CachedVideoPlayer exposes getter methods instead of a raw element, so
  // build a compatible snapshot for the core's lifecycle tracker.
  const recordMvLifecycle = useCallback((type) => {
    if (!syncCore) return;
    const v = videoRef.current;
    syncCore.recordVideoLifecycleEvent('mv', type, {
      paused: v ? (v.getPaused?.() ?? true) : true,
      seeking: v ? (v.getSeeking?.() ?? false) : false,
      readyState: v ? (v.getReadyState?.() ?? 0) : 0,
      duration: v ? (v.getDuration?.() ?? Infinity) : Infinity,
      src: youtubeId ? `/api/video-cache/stream/${youtubeId}` : '',
    });
  }, [syncCore, youtubeId]);

  // Hover preview with a short delay so crossing the cover doesn't flash the MV.
  const hoverTimerRef = useRef(null);
  const handleMouseEnter = () => {
    if (!youtubeId || showVideo) return;
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoverPreview(true), 350);
  };
  const handleMouseLeave = () => {
    clearTimeout(hoverTimerRef.current);
    setHoverPreview(false);
  };

  useEffect(() => () => clearTimeout(hoverTimerRef.current), []);

  useEffect(() => {
    if (isVideo && youtubeId) setHasActivated(true);
  }, [isVideo, youtubeId]);

  useEffect(() => {
    setHoverPreview(false);
    setShowVideo(false);
    setHasActivated(false);
  }, [fid]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setScrollH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [upcoming.length]);

  if (!currentTrack) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div
        style={{ width: '100%', aspectRatio: '1', borderRadius: 12, overflow: 'hidden', background: '#121212', marginBottom: 20, boxShadow: '0 10px 25px rgba(0,0,0,0.45)', flexShrink: 0, position: 'relative', cursor: youtubeId ? 'pointer' : 'default' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={() => { if (youtubeId) { clearTimeout(hoverTimerRef.current); setHoverPreview(false); setShowVideo(v => !v); } }}
      >
        {/* Video child — lazy-mounted once, then kept mounted and crossfaded */}
        {hasActivated && youtubeId && (
          <div
            style={{
              position: 'absolute', inset: 0, borderRadius: 12, overflow: 'hidden',
              opacity: isVideo ? 1 : 0,
              pointerEvents: isVideo ? 'auto' : 'none',
              transition: 'opacity 400ms ease',
            }}
          >
            <CachedVideoPlayer
              ref={videoRef}
              youtubeId={youtubeId}
              coverUrl={fid ? `/thumbnails/list/${fid}.jpg` : undefined}
              muted
              objectFit="contain"
              onLoadedMetadata={onVideoLoadedMetadata}
              onReady={() => { recordMvLifecycle('canplay'); mvEngine.onCanPlay?.(); }}
              onWaiting={() => { recordMvLifecycle('waiting'); mvEngine.onWaiting(); }}
              onStalled={() => { recordMvLifecycle('stalled'); mvEngine.onStalled(); }}
              onPlaying={() => { recordMvLifecycle('playing'); mvEngine.onPlaying(); }}
              onSeeked={() => { recordMvLifecycle('seeked'); mvEngine.onSeeked(); }}
              onPause={() => recordMvLifecycle('pause')}
              onError={() => recordMvLifecycle('error')}
              onVideoFrame={onMvVideoFrame}
            />
          </div>
        )}
        {/* Cover child — always mounted, crossfaded out when the MV shows */}
        <div
          style={{
            position: 'absolute', inset: 0, borderRadius: 12, overflow: 'hidden',
            opacity: isVideo ? 0 : 1,
            pointerEvents: isVideo ? 'none' : 'auto',
            transition: 'opacity 400ms ease',
          }}
        >
          {fid ? (
            <NetworkImage
              src={`/thumbnails/list/${fid}.jpg`}
              alt="Cover"
              className="w-full h-full object-cover"
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#525252" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
              </svg>
            </div>
          )}
        </div>
        <div style={{ position: 'absolute', bottom: 10, right: 10, background: 'rgba(0,0,0,0.65)', borderRadius: 999, padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.04em', opacity: youtubeId && !isVideo ? 1 : 0, transition: 'opacity 300ms ease', pointerEvents: 'none' }}>
            ▶ MV
          </div>
        <div style={{ position: 'absolute', bottom: 10, right: 10, background: 'rgba(0,0,0,0.65)', borderRadius: 999, padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#8892E6', letterSpacing: '0.04em', opacity: youtubeId && isVideo ? 1 : 0, transition: 'opacity 300ms ease', pointerEvents: 'none' }}>
            COVER · klik untuk MV
          </div>
      </div>
      <div style={{ marginBottom: 16, flexShrink: 0 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0, lineHeight: 1.3, wordBreak: 'break-word' }}>{displayName}</h2>
        <p style={{ fontSize: 14, color: '#a3a3a3', margin: '6px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{artist}</p>
        {album && (
          <p style={{ fontSize: 13, color: '#737373', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{album}</p>
        )}
      </div>
      {upcoming.length > 0 && (
        <>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#a3a3a3', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Next in queue ({upcoming.length})</div>
          </div>
          <div ref={scrollRef} style={{ flex: 1, minHeight: 0 }} className="sidebar-scroll">
            {scrollH > 0 && (
              <FixedSizeList
                height={scrollH}
                width={scrollRef.current?.clientWidth || 300}
                itemSize={QUEUE_ITEM_HEIGHT}
                itemCount={upcoming.length}
                overscanCount={5}
                itemData={upcoming}
              >
                {QueueRow}
              </FixedSizeList>
            )}
          </div>
        </>
      )}
    </div>
  );
}
