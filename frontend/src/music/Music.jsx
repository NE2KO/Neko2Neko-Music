import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, Minimize2, ListMusic, Heart, ChevronUp, ChevronDown, Activity, Play, Grid } from 'lucide-react';
import MediaControls from '../shared/MediaControls';
import Carousel from './Carousel';
import QueuePanel from './QueuePanel';
import LyricsDisplay from './LyricsDisplay';
import MetadataEditor from './MetadataEditor';
import CachedVideoPlayer from './CachedVideoPlayer';
import AudioVisualizer from '../audio/AudioVisualizer';
import SyncOverlay, { registerSyncCore, registerAudioRef, registerMvRef, registerBgRef, registerEngineStateRef, registerVideoOffsetRef, registerRvfcStatusRef, registerVideoRemountCount, registerReplayStateRef, registerRecordingState, registerAnalyzerEvidence, registerDecisionOutput } from './SyncOverlay';
import NetworkImage from '../shared/NetworkImage';
import usePlaybackStore from '../store/playbackStore';
import { useIsFavorite } from '../store/favoritesStore';
import { applySink, getStoredDevice } from '../utils/audioOutput';
import { getAudioEngine } from '../engines/audioEngine';
import { safeParseTrackFilter, safeParseTrackSearchQuery, applyTrackFilter, applyTrackSearch } from '../utils/trackFilter';
import { getSharedSyncCore, SyncReplay, SyncReplayEngine, buildSensorSnapshot, validateAndAttach, logSensorSnapshot, evaluateDriftAnalyzer, evaluatePipelineAnalyzer, evaluateSchedulerAnalyzer, evaluateDecoderAnalyzer, evaluateConsistencyAnalyzer, DriftMemory, PipelineMemory, SchedulerMemory, DecoderMemory, LearningMemory, GlobalMemory, createMemorySnapshot, computeDerivedMetrics, decide, ExecutionQueue, getConstraints, createActionRequest, createVideoSyncEngine, circularDiff, isValidTelemetrySample, Histogram } from '@homelab/sync-engine';
import { trackProfileStore } from '../utils/trackProfileStore';
import { listeningTracker } from '../utils/listeningTracker.js';
import { cancelAutoPlayPending, isAutoPlayPendingCanceled, resetAutoPlayPending } from '../utils/autoPlayPending';


export default function MusicPlayer({
  file,
  onChangeStatus,
  folderFiles = [],
  currentSortBy,
  currentSortOrder,
  favoriteOnly = false,
  onClose,
  onMinimize,
  onAudioChange,
  onFavoriteToggle,
  playlistQueue = null,
  currentTrackIndex = 0,
  onTrackIndexChange,
  sharedAudioRef,
  sharedPrevFileIdRef,
  audioReady,
  playlistTitle = null,
  trackSort = null,
}) {
  const {
    isPlaying,
    play,
    pause,
    next,
    previous,
    setCurrentTrackIndex,
    setPosition: setStorePosition,
    position: storedPosition,
    currentTrackIndex: storeCurrentTrackIndex,
  } = usePlaybackStore();

  const audioRef = sharedAudioRef || { current: null };
  const prevFileIdRef = sharedPrevFileIdRef || { current: null };
  // True while a programmatic source switch (audio.src + load) is in flight.
  // Used to ignore the audio element's own 'pause'/'emptied' events that the
  // reload fires — those are NOT user intent and must not flip the store's
  // isPlaying (this is what caused the play/pause flicker on rapid next/prev).
  const switchingRef = useRef(false);
  const lastSrcSetRef = useRef(0);
  // Monotonic counter to coalesce rapid track changes into a single physical
  // audio load. Each change bumps it and schedules a load; only the latest
  // generation actually reloads the audio (see the load effect).
  const loadGenerationRef = useRef(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(50);

  const [coverBlobUrl, setCoverBlobUrl] = useState(null);
  const [autoPlayPending, setAutoPlayPending] = useState(false);
  const autoMutedRef = useRef(false);
  const reloadWasMutedRef = useRef(false);
  const [userInteracted, setUserInteracted] = useState(false);
  const [showQueuePanel, setShowQueuePanel] = useState(false);
  const [playerMode, setPlayerMode] = useState('cover');
  const [videoRemountKey, setVideoRemountKey] = useState(0);
  const [showMetadataEditor, setShowMetadataEditor] = useState(false);
  const bgVideoLoadFailedRef = useRef(false);
  const bgVideoProgressTimerRef = useRef(null);
  const [trackMetadata, setTrackMetadata] = useState(null);
  const [lyricsSynced, setLyricsSynced] = useState(null);
  const [youtubeId, setYoutubeId] = useState(null);
  const [videoSearchResults, setVideoSearchResults] = useState(null);
  const hasLyrics = !!(lyricsSynced || trackMetadata?.lyrics);
  const [coverVersion, setCoverVersion] = useState(0);
  const videoRef = useRef(null);
  const bgVideoRef = useRef(null);
  const bgPendingTargetRef = useRef(null);
  const bgSeekInProgressRef = useRef(false);
  const bgSeekStartedAtRef = useRef(0);
  const bgPendingForceSeekRef = useRef(null);
  const bgWaitingRecoveryTimerRef = useRef(null);
  const lastAppliedSinkIdRef = useRef(null);
  const lastResumeTargetRef = useRef(null);
  const lastResumeTimeRef = useRef(0);
  const reloadResumeAtRef = useRef(0);

  // Load reload resume timestamp from sessionStorage so the initial track-load
  // effect can skip auto-play until App.jsx's delayed-resume timer fires.
  useEffect(() => {
    const saved = sessionStorage.getItem('audioReloadResumeAt');
    if (saved) {
      reloadResumeAtRef.current = Number(saved);
    }
    if (sessionStorage.getItem('audioReloadWasMuted') === 'true') {
      reloadWasMutedRef.current = true;
      sessionStorage.removeItem('audioReloadWasMuted');
    }
    const onResume = () => {
      reloadResumeAtRef.current = 0;
      const engine = getAudioEngine();
      const audio = engine.getElement();
      if (audio && audio.src && usePlaybackStore.getState().isPlaying && audio.paused) {
        const tryPlayWithMuted = () => {
          engine.play().then(() => {}).catch((err) => {
            if (err?.name === 'NotAllowedError' && !reloadWasMutedRef.current && !audio.muted) {
              autoMutedRef.current = true;
              engine.setMuted(true);
              engine.play().catch(() => {
                setAutoPlayPending(true);
                resetAutoPlayPending();
              });
            } else {
              setAutoPlayPending(true);
              resetAutoPlayPending();
            }
          });
        };
        tryPlayWithMuted();
      }
    };
    window.addEventListener('audio-reload-resume', onResume);
    return () => window.removeEventListener('audio-reload-resume', onResume);
  }, []);

  const [showSyncOverlay, setShowSyncOverlay] = useState(() => {
    try { return localStorage.syncDebug === 'true'; } catch { return false; }
  });

  // Audio timeupdate → PlaybackStore (source of truth)
  const syncLogRef = useRef({
    enabled: false,
    sessionId: null,
    startTime: 0,
    seekStartTime: null,
    buffer: [],
    maxBuffer: 20000,
    summary: null,
    lastConsoleLog: 0,
  });

  const recordingRef = useRef({
    enabled: false,
    buffer: [],
    maxBuffer: 50000,
  });

  const replayStateRef = useRef({
    active: false,
    frameIndex: 0,
    totalFrames: 0,
    timer: null,
    lastFrame: null,
    complete: false,
    startTime: 0,
  });

  const analyzerEvidenceRef = useRef({ mv: [], bg: [] });
  const decisionOutputRef = useRef({ mv: null, bg: null });

  const sessionsRef = useRef([]);
  const selectedRef = useRef(new Set());
  const telemetryNotesRef = useRef('');
  const prevTrackIdRef = useRef(null);
  const trackChangeTimeRef = useRef(0);
  const engineResetTimeRef = useRef(0);
  const anchorCallCountRef = useRef({ mv: 0, bg: 0 });
  const rvfcMvLastTimeRef = useRef(0);
  const rvfcBgLastTimeRef = useRef(0);
  const rvfcStatusRef = { mv: 'UNSUPPORTED', bg: 'UNSUPPORTED' };
  // Track 0.25 — last known RVFC frame metadata per engine
  const rvfcMvDataRef = useRef(null);
  const rvfcBgDataRef = useRef(null);
  const syncSessionRef = useRef({
    sessionId: null,
    trackId: null,
    filename: null,
    notes: '',
    codec: null,
    resolution: null,
    duration: null,
    environment: null,
    startedAt: null,
    endedAt: null,
    engineVersion: 'sync-v3',
    configSnapshot: null,
  });

  const syncLog = (kind, engine, data = {}) => {
    const log = syncLogRef.current;
    if (!log.enabled) return;
    const event = {
      t: performance.now() - log.startTime,
      kind,
      engine,
      ...data,
    };
    log.buffer.push(event);
    if (log.buffer.length > log.maxBuffer) {
      log.buffer.splice(0, log.buffer.length - log.maxBuffer);
    }
    const alwaysLog = ['hard_seek', 'stall', 'error', 'anchor_call', 'anchor_complete', 'mode_switch', 'bg_seek_call', 'bg_seeked', 'bg_pending_force_seek'];
    const shouldLog = alwaysLog.includes(kind) || (performance.now() - log.lastConsoleLog > 500);
    if (shouldLog && ['hard_seek', 'soft_seek', 'stall', 'large_drift', 'error', 'anchor_call', 'anchor_complete', 'mode_switch', 'bg_seek_call', 'bg_seeked', 'bg_pending_force_seek'].includes(kind)) {
      log.lastConsoleLog = performance.now();
    }
  };

  function computeSummary(events) {
    const ticks = events.filter(e => e.kind === 'tick');
    const seeks = events.filter(e => ['seek', 'hard_seek', 'soft_seek', 'anchor'].includes(e.kind));
    const stalls = events.filter(e => e.kind === 'stall');
    const modeChanges = events.filter(e => e.kind === 'mode_change');
    const seekLatencies = events.filter(e => e.kind === 'seek_latency');

    // Per-engine drift stats
    const mvTicks = ticks.filter(e => e.engine === 'mv');
    const bgTicks = ticks.filter(e => e.engine === 'bg');
    const mvDrifts = mvTicks.map(e => e.drift).filter(v => typeof v === 'number');
    const bgDrifts = bgTicks.map(e => e.drift).filter(v => typeof v === 'number');

    const driftStats = (drifts) => {
      if (!drifts.length) return { avg: 0, max: 0, p95: 0, count: 0 };
      const sorted = [...drifts].sort((a, b) => Math.abs(a) - Math.abs(b));
      const absSorted = sorted.map(Math.abs);
      return {
        avg: Math.round(drifts.reduce((a, b) => a + b, 0) / drifts.length),
        max: Math.round(Math.max(...absSorted)),
        p95: Math.round(absSorted[Math.floor(absSorted.length * 0.95)] || 0),
        count: drifts.length,
      };
    };

    const summary = {
      eventCount: events.length,
      tickCount: ticks.length,
      seekCount: seeks.length,
      hardSeekCount: events.filter(e => e.kind === 'hard_seek').length,
      anchorReplaceCount: events.filter(e => e.kind === 'anchor_replace').length,
      stallCount: stalls.length,
      modeChanges: modeChanges.map(e => ({ t: e.t, from: e.from, to: e.to })),
      seekLatency: seekLatencies.length ? {
        avgMs: Math.round(seekLatencies.reduce((a, e) => a + e.latencyMs, 0) / seekLatencies.length),
        maxMs: Math.round(Math.max(...seekLatencies.map(e => e.latencyMs))),
        count: seekLatencies.length,
      } : null,
      mv: driftStats(mvDrifts),
      bg: driftStats(bgDrifts),
    };

    const base = 100;
    const penalties = summary.hardSeekCount * 2 + summary.stallCount * 1 + summary.anchorReplaceCount * 1;
    const avgDriftMs = Math.max(summary.mv.avg, summary.bg.avg);
    const p95DriftMs = Math.max(summary.mv.p95, summary.bg.p95);
    const driftPenalty = Math.max(0, Math.ceil((avgDriftMs - 20) / 10)) + Math.max(0, Math.ceil((p95DriftMs - 40) / 10));
    summary.qualityScore = Math.max(0, base - penalties - driftPenalty);

    return summary;
  }

  const [videoOffset, setVideoOffset] = useState(0);
  const [availSize, setAvailSize] = useState({ width: 384, height: 384 });
  const mediaAreaRef = useRef(null);
  const controlsRef = useRef(null);
  const containerRef = useRef(null);
  const syncedRef = useRef(false);
  const syncedOffsetRef = useRef(null);
  const readyFiredRef = useRef(false);
  const prevModeRef = useRef(false);
  const [videoReady, setVideoReady] = useState(false);
  const [metadataReady, setMetadataReady] = useState(false);
  const isVideoMode = useMemo(() => playerMode === 'video' || playerMode === 'video-split' || playerMode === 'video-cover', [playerMode]);

  const buildEnvironment = () => {
    try {
      const ua = navigator.userAgent || '';
      return {
        userAgent: ua,
        platform: navigator.platform || null,
        hardwareConcurrency: typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null,
        deviceMemory: typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null,
        language: navigator.language || null,
      };
    } catch {
      return { userAgent: null, platform: null, hardwareConcurrency: null, deviceMemory: null, language: null };
    }
  };

  const buildConfigSnapshot = () => {
    try {
      const opts = (typeof mvEngine?.getOptions === 'function' ? mvEngine.getOptions() : {}) || {};
      const adaptive = syncCore?.getAdaptiveThresholds?.('mv');
      return {
        softThreshold: adaptive?.soft ?? opts.softThreshold ?? null,
        hardThreshold: adaptive?.hard ?? opts.hardSeekThreshold ?? null,
        rateGain: typeof opts.rateGain === 'number' ? opts.rateGain : null,
        rateMax: typeof opts.rateMax === 'number' ? opts.rateMax : null,
        rateCooldown: typeof opts.rateCooldownMs === 'number' ? opts.rateCooldownMs : null,
        stdDevThreshold: typeof opts.stableStdDevThreshold === 'number' ? opts.stableStdDevThreshold : null,
        biasEnabled: typeof opts.biasEnabled === 'boolean' ? opts.biasEnabled : null,
        adaptiveThreshold: typeof opts.adaptiveThreshold === 'boolean' ? opts.adaptiveThreshold : null,
        playbackRateEnabled: typeof opts.playbackRateEnabled === 'boolean' ? opts.playbackRateEnabled : null,
      };
    } catch {
      return {};
    }
  };

  const getTelemetryPrefs = () => {
    try {
      const raw = localStorage.getItem('syncTelemetryPrefs');
      if (raw) return JSON.parse(raw);
    } catch {}
    return { autoCollect: true, includeRawEvents: true, clearAfterExport: false };
  };

  const setTelemetryPrefs = (prefs) => {
    try { localStorage.setItem('syncTelemetryPrefs', JSON.stringify(prefs)); } catch {}
  };

  const downloadBlob = (data, filename) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const closeCurrentSession = () => {
    const log = syncLogRef.current;
    if (!log.enabled || !log.sessionId) return null;
    log.enabled = false;
    if (typeof window !== 'undefined') window.__SYNC_ENABLED__ = false;

    const session = {
      ...syncSessionRef.current,
      endedAt: new Date().toISOString(),
    };
    const summary = computeSummary(log.buffer);
    const closed = { session, summary, events: log.buffer.slice() };

    const prefs = getTelemetryPrefs();
    if (prefs.clearAfterExport) {
      sessionsRef.current = [];
    } else {
      sessionsRef.current.push(closed);
      try {
        const estimated = sessionsRef.current.reduce((acc, s) => acc + (s.events?.length || 0) * 150 + 500, 0);
        const MAX = 5 * 1024 * 1024;
        while (estimated > MAX && sessionsRef.current.length > 1) {
          sessionsRef.current.shift();
        }
      } catch {}
    }

    try {
      const summaries = sessionsRef.current.map(s => ({
        sessionId: s.session.sessionId,
        trackId: s.session.trackId,
        filename: s.session.filename,
        startedAt: s.session.startedAt,
        endedAt: s.session.endedAt,
        qualityScore: s.summary.qualityScore,
        mv: s.summary.mv,
        bg: s.summary.bg,
        hardSeekCount: s.summary.hardSeekCount,
        stallCount: s.summary.stallCount,
      }));
      localStorage.setItem('sync_sessions', JSON.stringify(summaries));
    } catch {}

    log.summary = summary;
    log.buffer = [];
    log.sessionId = null;
    syncSessionRef.current = {
      sessionId: null,
      trackId: null,
      filename: null,
      notes: '',
      codec: null,
      resolution: null,
      duration: null,
      environment: null,
      startedAt: null,
      endedAt: null,
      engineVersion: 'sync-v3',
      configSnapshot: null,
    };
    return closed;
  };

  const startNewSession = (trackId, filename, opts = {}) => {
    const prefs = getTelemetryPrefs();
    if (!prefs.autoCollect) return;
    const log = syncLogRef.current;
    if (log.enabled) closeCurrentSession();

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    log.enabled = true;
    if (typeof window !== 'undefined') window.__SYNC_ENABLED__ = true;
    log.sessionId = sessionId;
    log.startTime = performance.now();
    log.buffer = [];
    log.summary = null;

    syncSessionRef.current = {
      sessionId,
      trackId: trackId || null,
      filename: filename || null,
      notes: opts.notes || telemetryNotesRef.current || '',
      codec: opts.codec || null,
      resolution: opts.resolution || null,
      duration: opts.duration || null,
      environment: buildEnvironment(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      engineVersion: 'sync-v3',
      configSnapshot: buildConfigSnapshot(),
    };
  };

  // Expose unified sync telemetry toggles from console:
  //   window.__SYNC__(true)  — start session
  //   window.__SYNC_EXPORT__() — dump JSON
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__SYNC__ = (on) => {
      const log = syncLogRef.current;
      log.enabled = !!on;
      if (typeof window !== 'undefined') {
        window.__SYNC_ENABLED__ = !!on;
      }
      if (log.enabled) {
        log.sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        log.startTime = performance.now();
        log.buffer = [];
        log.summary = null;
        console.log(`[Music] SYNC ${log.sessionId} ON`);
      } else {
        console.log(`[Music] SYNC ${log.sessionId || '?'} OFF`);
      }
    };
    window.__SYNC_EXPORT__ = () => {
      const log = syncLogRef.current;
      if (!log.enabled || !log.sessionId) {
        console.error('[Music] Session belum aktif! Jalankan: window.__SYNC__(true)');
        return;
      }
      const data = {
        sessionId: log.sessionId,
        startTime: log.startTime,
        events: log.buffer,
        summary: log.summary || computeSummary(log.buffer),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sync-${log.sessionId || 'session'}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log(`[Music] SYNC exported ${log.buffer.length} events`);
    };
    window.__SYNC_SUMMARY__ = () => {
      const log = syncLogRef.current;
      if (!log.enabled || !log.sessionId) {
        console.error('[Music] Session belum aktif! Jalankan: window.__SYNC__(true)');
        return;
      }
      const s = computeSummary(log.buffer);
      const durationSec = log.buffer.length > 0
        ? Math.round((log.buffer[log.buffer.length - 1].t) / 1000)
        : 0;

      const modeLines = s.modeChanges.length > 0
        ? s.modeChanges.slice(-5).map(m => `${m.from}→${m.to}@${Math.round(m.t)}ms`).join(' ')
        : '(none)';

      const lines = [
        `[SYNC SUMMARY] session:${log.sessionId} | ${durationSec}s | ${s.tickCount} ticks | ${s.eventCount} events`,
        `  MV: avg=${s.mv.avg}ms max=${s.mv.max}ms p95=${s.mv.p95}ms (${s.mv.count} samples)`,
        `  BG: avg=${s.bg.avg}ms max=${s.bg.max}ms p95=${s.bg.p95}ms (${s.bg.count} samples)`,
        `  Seeks: ${s.seekCount}x (hard:${s.hardSeekCount} anchor_replace:${s.anchorReplaceCount})${s.seekLatency ? ` | latency avg=${s.seekLatency.avgMs}ms max=${s.seekLatency.maxMs}ms` : ''}`,
        `  Modes: ${modeLines}`,
        `  Stalls: ${s.stallCount}`,
      ];
      console.log(lines.join('\n'));
      return s;
    };
    // Also expose with single trailing underscore for convenience
    window.__SYNC_SUMMARY = window.__SYNC_SUMMARY__;
    window.__SYNC_EXPORT = window.__SYNC_EXPORT__;

    // Phase 4 — full Evidence-Driven replay from recorded sensor_snapshot events
    window.__SYNC_REPLAY__ = () => {
      try {
        const log = syncLogRef.current;
        if (!log || !log.buffer || !log.buffer.length) {
          console.warn('[Music] __SYNC_REPLAY__() no recorded events available');
          return null;
        }
        const engine = new SyncReplayEngine(log.buffer);
        return engine.run();
      } catch (err) {
        console.warn('[Music] __SYNC_REPLAY__() failed:', err);
        return null;
      }
    };

    // Recording controls
    window.startRecording = () => {
      recordingRef.current.enabled = true;
      recordingRef.current.buffer = [];
      console.log('[Music] Recording started');
    };
    window.stopRecording = () => {
      const count = recordingRef.current.buffer.length;
      recordingRef.current.enabled = false;
      console.log(`[Music] Recording stopped — ${count} frames captured`);
    };
    window.__SYNC_RECORD__ = () => {
      recordingRef.current.enabled = !recordingRef.current.enabled;
      if (recordingRef.current.enabled) {
        recordingRef.current.buffer = [];
      }
      console.log(`[Music] Recording ${recordingRef.current.enabled ? 'ON' : 'OFF'}`);
    };
    window.__SYNC_RECORD = window.__SYNC_RECORD__;
    try { registerRecordingState({ enabled: recordingRef.current.enabled, bufferLength: recordingRef.current.buffer.length, maxBuffer: recordingRef.current.maxBuffer }); } catch {}

    // Async frame-by-frame replay with live overlay updates
    window.__SYNC_REPLAY_ASYNC__ = async (speed = 1) => {
      try {
        const log = syncLogRef.current;
        if (!log || !log.buffer || !log.buffer.length) {
          console.warn('[Music] __SYNC_REPLAY_ASYNC__() no recorded events available');
          return null;
        }
        const engine = new SyncReplayEngine(log.buffer);
        let lastResult = null;
        replayStateRef.current = {
          active: true,
          frameIndex: 0,
          totalFrames: 0,
          timer: null,
          lastFrame: null,
          complete: false,
          startTime: performance.now(),
        };
        for await (const frame of engine.runFrames(speed)) {
          lastResult = frame.result;
          replayStateRef.current = {
            active: true,
            frameIndex: frame.frameIndex,
            totalFrames: frame.totalFrames,
            timer: null,
            lastFrame: frame,
            complete: false,
            startTime: replayStateRef.current.startTime,
          };
        }
        replayStateRef.current = {
          active: false,
          frameIndex: replayStateRef.current.totalFrames,
          totalFrames: replayStateRef.current.totalFrames,
          timer: null,
          lastFrame: replayStateRef.current.lastFrame,
          complete: true,
          startTime: replayStateRef.current.startTime,
        };
        console.log(`[Music] Async replay complete — ${replayStateRef.current.totalFrames} frames`);
        return lastResult;
      } catch (err) {
        console.warn('[Music] __SYNC_REPLAY_ASYNC__() failed:', err);
        if (replayStateRef.current) replayStateRef.current.active = false;
        return null;
      }
    };
    window.__SYNC_REPLAY_STOP__ = () => {
      if (replayStateRef.current.timer) {
        clearTimeout(replayStateRef.current.timer);
        replayStateRef.current.timer = null;
      }
      replayStateRef.current.active = false;
      console.log('[Music] Async replay stopped');
    };

    window.__SYNC_GET_NOTES__ = () => { try { return telemetryNotesRef.current || ''; } catch { return ''; } };
    window.__SYNC_SET_NOTES__ = (val) => { try { telemetryNotesRef.current = String(val || ''); } catch {} };
    window.__SYNC_GET_SELECTED__ = () => [...selectedRef.current];
    window.__SYNC_SET_SELECTED__ = (arr) => { try { selectedRef.current = new Set(arr); } catch {} };
    window.__SYNC_TOGGLE_SELECT__ = (index) => {
      try {
        const set = new Set(selectedRef.current);
        if (set.has(index)) set.delete(index); else set.add(index);
        selectedRef.current = set;
      } catch {}
    };
    window.__SYNC_CLEAR_SELECTED__ = () => { try { selectedRef.current = new Set(); } catch {} };
    window.__SYNC_DOWNLOAD_CURRENT__ = () => {
      const log = syncLogRef.current;
      if (!log.enabled || !log.sessionId) { console.warn('[Music] No active session to download'); return; }
      const session = syncSessionRef.current;
      const prefs = getTelemetryPrefs();
      downloadBlob({
        session,
        summary: log.summary || computeSummary(log.buffer),
        events: prefs.includeRawEvents ? log.buffer.slice() : [],
      }, `sync-${new Date().toISOString().slice(0,10)}-${session.trackId || 'x'}-${session.sessionId || 'session'}.json`);
    };
    window.__SYNC_DOWNLOAD_SELECTED__ = () => {
      const indices = [...selectedRef.current].sort((a,b)=>a-b);
      const sessions = indices.map(i => sessionsRef.current[i]).filter(Boolean);
      if (!sessions.length) { console.warn('[Music] No sessions selected'); return; }
      const prefs = getTelemetryPrefs();
      downloadBlob(sessions.map(s => ({ session: s.session, summary: s.summary, events: prefs.includeRawEvents ? (s.events || []) : [] })), 'sync-selected-sessions.json');
    };
    window.__SYNC_DOWNLOAD_ALL__ = () => {
      if (!sessionsRef.current.length) { console.warn('[Music] No completed sessions'); return; }
      const prefs = getTelemetryPrefs();
      downloadBlob(sessionsRef.current.map(s => ({ session: s.session, summary: s.summary, events: prefs.includeRawEvents ? (s.events || []) : [] })), 'sync-all-sessions.json');
    };
    window.__SYNC_CLEAR_SESSIONS__ = () => {
      sessionsRef.current = [];
      selectedRef.current = new Set();
      try { localStorage.removeItem('sync_sessions'); } catch {}
      console.log('[Music] Sync sessions cleared');
    };
    window.__SYNC_GET_SESSIONS__ = () => {
      try { return sessionsRef.current.map(s => ({ sessionId: s.session.sessionId, trackId: s.session.trackId, filename: s.session.filename, startedAt: s.session.startedAt, endedAt: s.session.endedAt, qualityScore: s.summary.qualityScore, hardSeekCount: s.summary.hardSeekCount, stallCount: s.summary.stallCount, avgDriftMs: Math.max(s.summary.mv.avg, s.summary.bg.avg) })); } catch { return []; }
    };
    window.__SYNC_GET_PREFS__ = getTelemetryPrefs;
    window.__SYNC_SET_PREFS__ = setTelemetryPrefs;
  }, []);





  // Expose a console toggle so you can A/B test without rebuilding:
  const touchStartYRef = useRef(0);
  const isGestureActiveRef = useRef(false);
  const [volumeGesture, setVolumeGesture] = useState({ deltaY: 0, showIndicator: false });
  const volumeIndicatorTimeoutRef = useRef(null);

  // Volume gesture handlers
  const handleTouchStart = useCallback((e) => {
    if (playerMode !== 'cover') return;
    touchStartYRef.current = e.touches[0].clientY;
    isGestureActiveRef.current = true;
    setVolumeGesture({ deltaY: 0, showIndicator: true });
}, [playerMode]);

// ---- ResizeObserver: measure available media area for the cover stage.
// We measure the large media area (mediaAreaRef), not the cover's direct parent,
// so the cover can be sized to fill the area while the cover+title+controls are
// centered together as one unit (controls stay close to the cover). ----
useEffect(() => {
  const parent = mediaAreaRef.current;
  if (!parent) return;

  const computeSize = () => {
    const controlsH = controlsRef.current ? controlsRef.current.offsetHeight : 0;
    const width = Math.max(0, parent.clientWidth - 48);
    const height = Math.max(0, parent.clientHeight - controlsH - 220);
    setAvailSize({ width, height });
  };

  computeSize();

  const ro = new ResizeObserver(computeSize);
  ro.observe(parent);
  if (controlsRef.current) ro.observe(controlsRef.current);

  return () => { ro.disconnect(); };
}, []);

  const handleTouchMove = useCallback((e) => {
    if (!isGestureActiveRef.current || playerMode !== 'cover') return;
    const deltaY = touchStartYRef.current - e.touches[0].clientY;
    if (Math.abs(deltaY) > 5) {
      const engine = getAudioEngine();
      const audio = engine.getElement();
      if (audio) {
        const volumeChange = deltaY * 0.5;
        const newVolume = Math.max(0, Math.min(100, audio.volume * 100 + volumeChange));
        engine.setVolume(newVolume / 100);
        setVolume(newVolume);
      }
      setVolumeGesture({ deltaY });
    }
    e.preventDefault();
  }, [playerMode]);

  const handleTouchEnd = useCallback(() => {
    isGestureActiveRef.current = false;
    setVolumeGesture({ deltaY: 0, showIndicator: true });
    if (volumeIndicatorTimeoutRef.current) clearTimeout(volumeIndicatorTimeoutRef.current);
    volumeIndicatorTimeoutRef.current = setTimeout(() => {
      setVolumeGesture(prev => ({ ...prev, showIndicator: false }));
    }, 800);
  }, []);

  const playlistFiles = useMemo(() => {
    if (!playlistQueue || !playlistQueue.length) return [];
    return playlistQueue.map((track, idx) => ({
      id: track.file_id || track.id || `playlist_track_${idx}`,
      name: track.display_name,
      display_name: track.display_name,
      type: track.type || 'audio',
      ext: track.ext || '.mp3',
      size: track.size || 0,
      mtime: track.mtime || 0,
      duration: track.duration || 0,
      has_thumb: 0,
      dir_path: '__playlist__',
      artist: track.artist,
      album: track.album,
      _playlistPath: track.path,
      _exists: track.exists,
      file_id: track.file_id,
      is_favorite: track.is_favorite || 0,
      youtube_id: track.youtube_id || null,
      video_offset: track.video_offset || 0,
    }));
  }, [playlistQueue]);

  const hasPlaylist = playlistFiles.length > 0;
  const carouselFiles = useMemo(() => {
    const base = hasPlaylist ? playlistFiles : folderFiles;
    const filtered = applyTrackSearch(applyTrackFilter(base, safeParseTrackFilter()), safeParseTrackSearchQuery());
    if (!hasPlaylist && favoriteOnly) {
      return filtered.filter(f => f.is_favorite === 1);
    }
    return filtered;
  }, [hasPlaylist, playlistFiles, folderFiles, favoriteOnly]);
  const activeFile = hasPlaylist && playlistFiles.length > 0
    ? (storeCurrentTrackIndex >= 0 && storeCurrentTrackIndex < playlistFiles.length ? playlistFiles[storeCurrentTrackIndex] : null)
    : file;

  // Guarded cover URL: activeFile is null during the first paint after a reload
  // (queue/snapshot restore runs in an effect), so the raw template used to
  // request /thumbnails/undefined.jpg?v=0 and 404'd on every load.
  const activeCoverId = activeFile?.file_id || activeFile?.id || null;
  const activeCoverUrl = activeCoverId
    ? `/thumbnails/full/${activeCoverId}.jpg?v=${coverVersion}`
    : null;

  // Telemetry: auto close/open session on track change (one session per track).
  useEffect(() => {
    const trackId = activeFile?.file_id || activeFile?.id || null;
    const filename = activeFile?.display_name || activeFile?.name || null;
    const prefs = getTelemetryPrefs();

    if (prevTrackIdRef.current != null && prevTrackIdRef.current !== trackId && prefs.autoCollect) {
      trackChangeTimeRef.current = performance.now();
      if (syncLogRef.current.enabled) closeCurrentSession();
      startNewSession(trackId, filename, {
        codec: null,
        resolution: `${availSize.width}x${availSize.height}`,
        duration: typeof activeFile?.duration === 'number' ? activeFile.duration : null,
      });
    } else if (prevTrackIdRef.current == null && trackId && prefs.autoCollect && !syncLogRef.current.enabled) {
      trackChangeTimeRef.current = performance.now();
      startNewSession(trackId, filename, {
        codec: null,
        resolution: `${availSize.width}x${availSize.height}`,
        duration: typeof activeFile?.duration === 'number' ? activeFile.duration : null,
      });
    }
    prevTrackIdRef.current = trackId;
  }, [activeFile?.id, activeFile?.file_id]);

  // Context caption for the carousel so the user always knows WHICH order the
  // strip follows. The playlist carousel follows the queue order, which is now
  // the user's chosen track sort (the queue is built sorted in PlaylistView and,
  // on re-open, the backend /play endpoint re-sorts using the persisted
  // trackSort). This label tells the user exactly which order that is, so the
  // carousel never looks like it lost the sort.
  const sortLabel = useMemo(() => {
    const map = {
      created_at: 'date added',
      name: 'name',
      title: 'title',
      artist: 'artist',
      album: 'album',
      track_num: 'track #',
      track_index: 'added',
      mtime: 'modified',
      size: 'size',
      duration: 'duration',
    };
    const by = (trackSort?.by || currentSortBy || 'created_at');
    const order = trackSort?.order || currentSortOrder || 'asc';
    const label = map[by] || by;
    return `${label} ${order === 'desc' ? '↓' : '↑'}`;
  }, [trackSort, currentSortBy, currentSortOrder]);

  const carouselContextLabel = useMemo(() => {
    if (hasPlaylist) {
      const name = playlistTitle || 'Playlist';
      const by = trackSort?.by || currentSortBy;
      if (!by) return `Playlist: ${name}`;
      return `Playlist: ${name} · sorted by ${sortLabel}`;
    }
    return `In folder order · ${sortLabel}`;
  }, [hasPlaylist, playlistTitle, sortLabel, trackSort, currentSortBy]);

  const handleVideoSearch = useCallback(async () => {
    const fileId = activeFile?.file_id || activeFile?.id;
    if (!fileId) return;
    try {
      const res = await fetch(`/api/video-cache/auto-detect/${fileId}`);
      const data = await res.json();
      setVideoSearchResults(data.results || []);
    } catch {
      setVideoSearchResults([]);
    }
  }, [activeFile?.file_id, activeFile?.id]);

  const handleVideoPick = useCallback(async (videoId) => {
    const fileId = activeFile?.file_id || activeFile?.id;
    if (!fileId) return;
    try {
      await fetch(`/api/video-cache/save-id/${fileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeId: videoId }),
      });
      setYoutubeId(videoId);
      setVideoSearchResults(null);
    } catch {}
  }, [activeFile?.file_id, activeFile?.id]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (volumeIndicatorTimeoutRef.current) clearTimeout(volumeIndicatorTimeoutRef.current);
    };
  }, []);

  // Stable cacheBust for Carousel - only changes when file ID changes
  const stableCacheBust = useMemo(() => String(coverVersion), [activeFile?.file_id || activeFile?.id, coverVersion]);

  // Warm the browser HTTP cache for the ±2 neighbor cover thumbnails so that the
  // cover swap on skip is instant. Uses the exact displayed URL (same coverVersion
  // cache-buster) so the request the <img> makes hits cache. `queue` is read from
  // getState() (it is not a reactive value in this component).
  useEffect(() => {
    const { queue } = usePlaybackStore.getState();
    if (!queue || queue.length === 0) return;
    const n = queue.length;
    const idx = storeCurrentTrackIndex ?? 0;
    const cv = coverVersion;
    [-2, -1, 1, 2].forEach((off) => {
      const f = queue[(idx + off + n) % n];
      const fid = f?.file_id || f?.id;
      if (fid) {
        const img = new Image();
        img.decoding = 'async';
        img.src = `/thumbnails/full/${fid}.jpg?v=${cv}`;
      }
    });
  }, [storeCurrentTrackIndex, coverVersion]);

  // Sync playlist queue to store — only when the queue CONTENT actually changes.
  // The click path (onPlayTrack) already sets the queue + index authoritatively
  // (store currentTrackIndex is set synchronously BEFORE the player mounts), so
  // PRESERVE the store's currentTrackIndex here instead of overwriting it with the
  // React prop. Overwriting with a stale prop index was the cause of the player
  // showing the PREVIOUS track after navigating back and re-selecting.
  const prevQueueSigRef = useRef(null);
  useEffect(() => {
    if (!hasPlaylist) return;
    const sig = playlistFiles.map(f => f.id).join('|');
    if (sig === prevQueueSigRef.current) return;
    prevQueueSigRef.current = sig;
    const st = usePlaybackStore.getState();
    st.setQueue(playlistFiles, st.currentTrackIndex);
  }, [hasPlaylist, playlistFiles]);

  // Load file when changed — shared audio, skip reload if same track
  useEffect(() => {
    if (!audioReady) return;
    const engine = getAudioEngine();
    const audio = engine.getElement();
    if (!audio) return;

    const fileId = activeFile?.file_id || activeFile?.id;
    if (!fileId) return;

    const audioHasTrack = !!audio && !!audio.src && audio.src.includes(`/file/${fileId}`);
    const isSameTrack = prevFileIdRef.current === fileId || audioHasTrack;
    prevFileIdRef.current = fileId;

    if (isSameTrack) {
      setIsLoading(false);
      let mounted = true;
      const device = getStoredDevice();
      const deviceId = device && device.deviceId ? device.deviceId : '';
      if (deviceId !== lastAppliedSinkIdRef.current) {
        lastAppliedSinkIdRef.current = deviceId;
        applySink(audio, device).then(() => {
          if (mounted && usePlaybackStore.getState().isPlaying && audio.paused) engine.play().catch(() => {});
        }).catch(() => {
          lastAppliedSinkIdRef.current = null;
        });
      } else if (usePlaybackStore.getState().isPlaying && audio.paused) {
        engine.play().catch(() => {});
      }
      const onPlay = () => { if (!switchingRef.current) play(); };
      const onPause = () => {
        if (switchingRef.current) return;
        if ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - lastSrcSetRef.current < 600) return;
        cancelAutoPlayPending();
        pause();
      };
      engine.on('play', onPlay);
      engine.on('pause', onPause);
      return () => {
        mounted = false;
        engine.off('play', onPlay);
        engine.off('pause', onPause);
      };
    }

    setIsLoading(true);
    setError(null);

    switchingRef.current = true;
    lastSrcSetRef.current = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    let cancelled = false;
    const generation = ++loadGenerationRef.current;
    let resumePos = 0;
    let resumePosApplied = false;
    const onLoadedMetadata = () => {
      if (cancelled || generation !== loadGenerationRef.current) return;
      if (resumePos > 0 && !resumePosApplied) {
        resumePosApplied = true;
        try { engine.seek(resumePos); } catch { /* ignore */ }
      }
    };
    let onCanPlay = null;
    engine.on('loadedmetadata', onLoadedMetadata);
    const timer = setTimeout(() => {
      if (generation !== loadGenerationRef.current) return;
      resumePos = storedPosition > 0 ? storedPosition : 0;
      engine.seek(0);
      console.log("[Music] setting audio src:", `/file/${fileId}`);
      engine.load(fileId);
      console.log("[Music] audio.src set:", `/file/${fileId}`);

      let sinkReady = false;
      let canPlayFired = false;
      const tryPlay = () => {
        if (cancelled) return;
        console.log("[Music] calling audio.play()");
        engine.play().then(() => {
          if (cancelled) return;
          setIsLoading(false);
          switchingRef.current = false;
        }).catch((err) => {
          if (cancelled) return;
          setIsLoading(false);
          switchingRef.current = false;
          if (err?.name === 'NotAllowedError') {
            const tryMuted = !reloadWasMutedRef.current && !audio.muted;
            if (tryMuted) {
              autoMutedRef.current = true;
              engine.setMuted(true);
              engine.play().catch(() => {
                setAutoPlayPending(true);
                resetAutoPlayPending();
              });
            } else {
              setAutoPlayPending(true);
              resetAutoPlayPending();
            }
          } else {
            console.error("[Music] audio.play() error:", err);
          }
        });
      };
      onCanPlay = () => {
        if (cancelled) return;
        canPlayFired = true;
        maybePlay();
        engine.off('canplay', onCanPlay);
      };
      const maybePlay = () => {
        if (cancelled) return;
        if (!sinkReady || !(canPlayFired || audio.readyState >= 3)) return;
        if (reloadResumeAtRef.current > Date.now()) return;
        tryPlay();
      };
      engine.on('canplay', onCanPlay);
      applySink(audio, getStoredDevice()).then(() => { sinkReady = true; maybePlay(); });
    }, 100);

    const onPlay = () => { if (!switchingRef.current) play(); };
    const onPause = () => {
      if (switchingRef.current) return;
      if ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - lastSrcSetRef.current < 600) return;
      pause();
    };
    const onPlaying = () => {
      switchingRef.current = false;
      play();
    };
    const onError = () => {
      if (cancelled) return;
      setIsLoading(false);
      switchingRef.current = false;
      setError('Format tidak didukung browser');
    };

    engine.on('play', onPlay);
    engine.on('pause', onPause);
    engine.on('playing', onPlaying);
    engine.on('error', onError);

    const switchClearTimer = setTimeout(() => { switchingRef.current = false; }, 2000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(switchClearTimer);
      switchingRef.current = false;
      engine.off('play', onPlay);
      engine.off('pause', onPause);
      engine.off('playing', onPlaying);
      engine.off('error', onError);
      engine.off('loadedmetadata', onLoadedMetadata);
      engine.off('canplay', onCanPlay);
    };
  }, [activeFile?.id, activeFile?.file_id, audioReady, audioRef, play]);

  // Telemetry: close final session on player unmount.
  useEffect(() => {
    return () => {
      if (syncLogRef.current.enabled) closeCurrentSession();
    };
  }, []);

  // React to global play/pause state changes (e.g. Spacebar handler)
  useEffect(() => {
    const engine = getAudioEngine();
    const audio = engine.getElement();
    if (!audio || !audioReady) return;
    if (switchingRef.current) return;
    if (isPlaying && audio.paused) {
      engine.play().catch((err) => {
        if (err?.name === 'NotAllowedError') {
          setAutoPlayPending(true);
          resetAutoPlayPending();
        }
      });
    } else if (!isPlaying && !audio.paused) {
      engine.pause();
    }
  }, [isPlaying, audioReady, audioRef]);

  // Audio timeupdate → PlaybackStore (source of truth)
  useEffect(() => {
    const sync = () => {
      const audio = getAudioEngine().getElement();
      if (audio) setStorePosition(audio.currentTime);
    };
    getAudioEngine().on('timeupdate', sync);
    return () => getAudioEngine().off('timeupdate', sync);
  }, [setStorePosition]);

  // ListeningTracker: attach to audio element, track per-track listening time.
  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio || !audioReady) return;
    const trackId = activeFile?.file_id || activeFile?.id || null;
    if (!trackId) return;
    const displayName = activeFile?.display_name || activeFile?.name || null;
    listeningTracker.attach(audio, trackId, displayName);
    return () => {
      listeningTracker.detach();
    };
  }, [activeFile?.id, activeFile?.file_id, audioReady, audioRef]);

  // Persist listening stats on unmount.
  useEffect(() => {
    return () => {
      listeningTracker.forcePersist();
    };
  }, []);

  // Fetch metadata + lyrics when track changes
  useEffect(() => {
    const fileId = activeFile?.file_id || activeFile?.id;
    if (!fileId) {
      setTrackMetadata(null);
      setLyricsSynced(null);
      setVideoOffset(0);
      setYoutubeId(null);
      return;
    }
    // Clear content immediately so stale lyrics/cover don't flash on the new
    // track. NOTE: we intentionally do NOT reset playerMode here — keeping the
    // current mode (e.g. video) lets the MV follow when skipping next/prev.
    setTrackMetadata(null);
    setLyricsSynced(null);
    setVideoSearchResults(null);
    // Set the video identity SYNCHRONOUSLY from the queue entry so the player can
    // switch video<->cover on the same tick as the skip — no waiting on the
    // /api/metadata round-trip. This unmounts the previous <video> instantly
    // (killing the "stuck old frame") and lets the cover-fallback effect fire
    // immediately when the new track has no video. The fetch below reconciles in
    // case the DB has a newer youtube_id/offset than the cached queue value.
    setYoutubeId(activeFile?.youtube_id || null);
    setVideoOffset(Number(activeFile?.video_offset) || 0);
    let cancelled = false;
    fetch(`/api/metadata/${fileId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data) return;
        setTrackMetadata(data);
        setLyricsSynced(data.lyrics_synced || data.syncedLyrics || null);
        setYoutubeId(data.youtube_id || null);
        setVideoOffset(Number(data.video_offset) || 0);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeFile?.file_id, activeFile?.id, storeCurrentTrackIndex]);

  // When skipping tracks while in a video mode, fall back to cover if the new
  // track's video is NOT actually cached on disk (a YouTube ID may exist but the
  // file was never downloaded). Only stay in video mode when the cached file
  // exists. A manual switch into video mode for the current track is NOT
  // overridden (prevFileIdRef guard) — the user still sees the download
  // spinner rather than being bounced to cover.
  useEffect(() => {
    const fileId = activeFile?.file_id || activeFile?.id;
    const videoMode =
      playerMode === 'video' || playerMode === 'video-split' || playerMode === 'video-cover';
    // Switch to cover only when the track CHANGES to one with no video at all.
    // The guard is suppressed on the initial mount (prevFileIdRef.current === null)
    // and when the user manually switches to MV mode for the SAME track, so a
    // late metadata fetch can't bounce the player back to cover.
    if (prevFileIdRef.current != null && fileId !== prevFileIdRef.current && !youtubeId && videoMode) {
      setPlayerMode('cover');
    }
    prevFileIdRef.current = fileId;
  }, [youtubeId, playerMode, setPlayerMode, activeFile?.file_id, activeFile?.id]);

  // First user interaction after a blocked/muted resume: unmute and retry play.
  // Also handles the legacy autoPlayPending fallback.
  useEffect(() => {
    if (!userInteracted) return;
    const engine = getAudioEngine();
    if (autoMutedRef.current) {
      autoMutedRef.current = false;
      engine.setMuted(false);
      if (engine.getElement()?.paused) engine.play().catch(() => {});
    }
    if (autoPlayPending && !isAutoPlayPendingCanceled()) {
      engine.play().catch(() => {});
      setAutoPlayPending(false);
      resetAutoPlayPending();
    }
  }, [autoPlayPending, userInteracted]);

  // Mark the first user gesture so a previously-blocked autoplay can resume.
    // Browsers block audio.play() without a user gesture; the effect above waits
    // for `userInteracted` to become true before retrying. (VaultAudioPlayer has
    // the same listener — MusicPlayer was missing it, so autoplay never resumed
    // after a reload.)
    useEffect(() => {
      const mark = () => setUserInteracted(true);
      window.addEventListener('pointerdown', mark);
      window.addEventListener('keydown', mark);
      return () => {
        window.removeEventListener('pointerdown', mark);
        window.removeEventListener('keydown', mark);
      };
    }, []);

// Drift correction: keep the video synced to the live audio position, but
// THROTTLED (~1s interval, not a per-frame requestAnimationFrame loop).
// The old per-frame loop re-called forceSeek()/playVideo()/pauseVideo() up to
// 60x/sec, which made playback feel heavy. Now the <video> just plays
// on its own; we only (a) pause/resume it from the audio's own
// 'waiting'/'playing' events, and (b) re-seek only on LARGE drift (>2s).
const videoOffsetRef = useRef(videoOffset);
videoOffsetRef.current = videoOffset;

// Tracks whether the <video> is currently stalled/buffering so we know a
// resume must be re-anchored. Set by native <video> event callbacks below.
const audioStalledRef = useRef(false);
const scrubbingRef = useRef(false);
const userSeekPendingRef = useRef(false);

// === GENERIC VIDEO SYNC ENGINE ===
// Single-source-of-truth controller for any <video> that must track the audio
// master clock. Works for both the main MV (non-looping, CachedVideoPlayer)
// and the blurred background video (looping, native <video>).

// Helper: signed difference between two timestamps, respecting loop boundaries.
// Used by both the engine tick and the sync log tick loop.


// === ENGINE INSTANCES ===
// Shared Sync Core — the "brain" shared between MV and BG engines.
// App-wide singleton: the full player, MiniPlayer background, and NowPlaying
// panel all share this instance so every surface follows one master clock.
const syncCore = getSharedSyncCore(() => {
  const audio = audioRef.current;
  if (!audio) return 0;
  return (audio.currentTime || 0) + (videoOffsetRef.current || 0);
});

// MV master PID sync engine (non-looping). Controls only the main MV.
const mvEngine = useMemo(() => createVideoSyncEngine({
    getCurrentTime: () => videoRef.current?.getCurrentTime?.() ?? 0,
    getDuration: () => videoRef.current?.getDuration?.() ?? Infinity,
    getPaused: () => videoRef.current?.getPaused?.() ?? true,
    getSeeking: () => videoRef.current?.getSeeking?.() ?? false,
    getReadyState: () => videoRef.current?.getReadyState?.() ?? 0,
    seek: (t) => {
        const video = videoRef.current;
        if (!video) return;
        // No pause before the seek: pausing on every hard seek keeps the video
        // at readyState 1 (HAVE_METADATA), so it never buffers to a seekable
        // range and every seek lands at the pre-seek position — the hard-seek
        // loop around one region. forceSeek also avoids pausing; the <video>
        // pauses internally during a seek and the engine resumes on seeked/playing.
        videoRef.current?.forceSeek?.(t);
    },
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
    getRvfcStatus: () => rvfcStatusRef.mv || 'UNKNOWN',
    getDroppedFrames: () => 0,
    getDecodeLatencyMs: () => 0,
    getAudioCurrentTime: () => audioRef.current?.currentTime || 0,
    getVideoPlaybackRate: () => videoRef.current?.playbackRate || 1,
    getBgPlaybackRate: () => bgVideoRef.current?.playbackRate || 1,
    getVideoOffset: () => videoOffsetRef.current || 0,
    getMvCurrentTime: () => videoRef.current?.getCurrentTime?.() ?? 0,
    getBgCurrentTime: () => bgVideoRef.current?.currentTime ?? 0,
    getRvfcMvPresentationTime: () => rvfcMvDataRef.current?.presentationTime,
    getRvfcBgPresentationTime: () => rvfcBgDataRef.current?.presentationTime,
    getRvfcMvExpectedDisplayTime: () => rvfcMvDataRef.current?.expectedDisplayTime,
    getRvfcBgExpectedDisplayTime: () => rvfcBgDataRef.current?.expectedDisplayTime,
    getRvfcMvMediaTime: () => rvfcMvDataRef.current?.mediaTime,
    getRvfcBgMediaTime: () => rvfcBgDataRef.current?.mediaTime,
  log: syncLog,
      trackChangeTimeRef,
      syncCore,
      profileStore: trackProfileStore,
      engineName: 'mv',
      analyzerEvidenceRef,
      decisionOutputRef,
  }), []);

// Independent BG PID sync engine (looping). Controls only the blurred BG,
// target = live audio time wrapped to BG duration. Decoupled from MV so BG
// buffering/stalls never fight MV corrections.
const bgEngine = useMemo(() => createVideoSyncEngine({
    getCurrentTime: () => bgVideoRef.current?.currentTime ?? 0,
    getDuration: () => bgVideoRef.current?.duration ?? Infinity,
    getPaused: () => bgVideoRef.current?.paused ?? false,
    getSeeking: () => bgVideoRef.current?.seeking ?? false,
    getReadyState: () => bgVideoRef.current?.readyState ?? 0,
    seek: (t) => {
        const bg = bgVideoRef.current;
        if (!bg) return;
        const dur = bg.duration;
        if (!isFinite(dur) || dur <= 0) return;
        const target = ((t % dur) + dur) % dur;
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
                bgPendingForceSeekRef.current = target;
                syncLog('bg_pending_force_seek', 'bg', {
                    target,
                    current: cur,
                    gap,
                    seekInProgress: true,
                    seekStartedAt: bgSeekStartedAtRef.current,
                });
                return;
            }
        }
        if (gap < 0.3) {
            bg.currentTime = target;
            bgSeekInProgressRef.current = true;
            bgSeekStartedAtRef.current = performance.now();
            syncLog('bg_seek_call', 'bg', {
                target,
                current: cur,
                gap,
                seekInProgress: true,
                method: 'currentTime_small',
            });
            return;
        }
        bg.currentTime = target;
        bgSeekInProgressRef.current = true;
        bgSeekStartedAtRef.current = performance.now();
        syncLog('bg_seek_call', 'bg', {
            target,
            current: cur,
            gap,
            seekInProgress: true,
            method: 'currentTime_large',
        });
    },
    play: () => Promise.resolve(bgVideoRef.current?.play?.()),
    pause: () => { bgVideoRef.current?.pause?.(); return Promise.resolve(); },
    setRate: (r) => {
        if (bgVideoRef.current) bgVideoRef.current.playbackRate = r;
    },
    getIsPlaying: () => usePlaybackStore.getState().isPlaying,
    looping: true,
    hardSeekThreshold: 0.25,
    jumpSeekThreshold: 1.0,
    rateMin: 0.003,
    rateGain: 0.8,
    seekCooldown: 500,
    stallTimeout: 2000,
    gracePeriod: 10,
    pauseIfFarFromTarget: false,
    farThreshold: 0.5,
    pauseOnStall: false,
    adaptiveThreshold: true,
    getAdaptiveThresholds: () => syncCore.getAdaptiveThresholds('bg'),
    getNetworkState: () => bgVideoRef.current?.networkState || 0,
    getWaiting: () => bgVideoRef.current?.waiting || false,
    getStalled: () => bgVideoRef.current?.stalled || false,
    getRvfcStatus: () => rvfcStatusRef.bg || 'UNKNOWN',
    getDroppedFrames: () => 0,
    getDecodeLatencyMs: () => 0,
    getAudioCurrentTime: () => audioRef.current?.currentTime || 0,
    getVideoPlaybackRate: () => videoRef.current?.playbackRate || 1,
    getBgPlaybackRate: () => bgVideoRef.current?.playbackRate || 1,
    getVideoOffset: () => videoOffsetRef.current || 0,
    getMvCurrentTime: () => videoRef.current?.getCurrentTime?.() ?? 0,
    getBgCurrentTime: () => bgVideoRef.current?.currentTime ?? 0,
    getRvfcMvPresentationTime: () => rvfcMvDataRef.current?.presentationTime,
    getRvfcBgPresentationTime: () => rvfcBgDataRef.current?.presentationTime,
    getRvfcMvExpectedDisplayTime: () => rvfcMvDataRef.current?.expectedDisplayTime,
    getRvfcBgExpectedDisplayTime: () => rvfcBgDataRef.current?.expectedDisplayTime,
    getRvfcMvMediaTime: () => rvfcMvDataRef.current?.mediaTime,
    getRvfcBgMediaTime: () => rvfcBgDataRef.current?.mediaTime,
  log: syncLog,
      trackChangeTimeRef,
      syncCore,
      profileStore: trackProfileStore,
      engineName: 'bg',
      analyzerEvidenceRef,
      decisionOutputRef,
  }), []);

// === SYNC EFFECTS ===
// Audio lifecycle → MV and BG engine state machine
useEffect(() => {
    if (!audioReady) return;

    const markReStable = (cause) => {
        if (syncCore.startReStabilization) {
            syncCore.startReStabilization('mv', cause);
            syncCore.startReStabilization('bg', cause);
        }
    };
    const onWaiting = () => {
        audioStalledRef.current = true;
        syncCore.setStable(false);
        markReStable('onWaiting');
        syncLog('waiting', 'audio', { currentTime: Math.round(audioRef.current?.currentTime * 1000) });
    };
    const onResume = () => {
        const wasStalled = audioStalledRef.current;
        audioStalledRef.current = false;
        const target = audioRef.current?.currentTime + (videoOffsetRef.current || 0);
        syncLog('playing', 'audio', { currentTime: Math.round(audioRef.current?.currentTime * 1000) });
        
        syncCore.setStable(false);
        markReStable('onResume');
        // Always anchor both engines on resume — eliminates startup delay.
        mvEngine.anchor({ play: true, target });
        if (youtubeId) {
            setTimeout(() => {
                try { bgEngine.anchor({ play: true, target }); } catch (_) {}
            }, 100);
        }
    };
    const onPause = () => {
        audioStalledRef.current = false;
        syncCore.setStable(false);
        markReStable('onPause');
        const target = audioRef.current?.currentTime + (videoOffsetRef.current || 0);
        syncLog('pause', 'audio', { currentTime: Math.round(audioRef.current?.currentTime * 1000) });
        mvEngine.pause();
        bgEngine.pause();
        bgSeekInProgressRef.current = false;
        bgSeekStartedAtRef.current = 0;
        bgPendingForceSeekRef.current = null;
    };

    const engine = getAudioEngine();
    const audio = engine.getElement();
    if (!audio) return;

    engine.on('waiting', onWaiting);
    engine.on('playing', onResume);
    engine.on('pause', onPause);

    return () => {
        engine.off('waiting', onWaiting);
        engine.off('playing', onResume);
        engine.off('pause', onPause);
    };
}, [audioReady, mvEngine, bgEngine, youtubeId]);

// Tab refocus → re-anchor MV and mirror BG
useEffect(() => {
    const onVisibility = () => {
        if (!document.hidden && usePlaybackStore.getState().isPlaying) {
            const target = audioRef.current?.currentTime + (videoOffsetRef.current || 0);
            mvEngine.anchor({ play: true, target });
            setTimeout(() => {
                try { bgEngine.anchor({ play: true, target }); } catch (_) {}
            }, 100);
        }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
}, [mvEngine, bgEngine]);

// Periodic drift correction for MV and BG (30 ms)
useEffect(() => {
    if (!audioReady) return;
    const audio = audioRef.current;
    if (!audio) return;
    const lastAudioPosRef = { current: audio.currentTime };
    const lastTickLogRef = { current: 0 };
    const lastTickTimeRef = { current: performance.now() };
    const id = setInterval(() => {
        const prevPos = lastAudioPosRef.current;
        const audioTarget = audio.currentTime + (videoOffsetRef.current || 0);
        const now = performance.now();
        const tickDelta = now - lastTickTimeRef.current;
        lastTickTimeRef.current = now;

         if (videoRef.current) {
             mvEngine.tick(audioTarget, tickDelta);
         }
         if (bgVideoRef.current) {
             try { bgEngine.tick(audioTarget, tickDelta); } catch (_) {}
         }

        // Loop boundary jump: audio wrapped from near-duration → near-0 (track repeat).
        // Without this, PID slowly chases the 0-target and the gap can spike to ~100 ms.
        // Detect only large backward jumps that exceed half of any known video duration.
        try {
            const bgDur = bgVideoRef.current?.duration;
            const mvDur = videoRef.current?.getDuration?.();
            const knownDur = (isFinite(mvDur) && mvDur > 0 ? mvDur : (isFinite(bgDur) && bgDur > 0 ? bgDur : Infinity));
            const backwardJump = prevPos - audio.currentTime;
            if (usePlaybackStore.getState().isPlaying &&
                backwardJump > knownDur * 0.4 &&
                !mvEngine.state.seekPending) {
                mvEngine.anchor({ play: true, target: videoOffsetRef.current || 0 });
                if (youtubeId) {
                    setTimeout(() => {
                        try { bgEngine.anchor({ play: true, target: videoOffsetRef.current || 0 }); } catch (_) {}
                    }, 100);
                }
            }
        } catch (_) { /* ignore diag errors */ }
        lastAudioPosRef.current = audio.currentTime;

        if (syncLogRef.current.enabled || recordingRef.current.enabled) {
          const aCurrent = audio.currentTime;
          const vOff = videoOffsetRef.current || 0;

          // Throttle tick logs to every 500ms to reduce buffer/console spam
          const now = performance.now();
          if (now - lastTickLogRef.current < 500 && recordingRef.current.enabled) { /* skip */ } else {
          lastTickLogRef.current = now;
          const mvCurrent = videoRef.current?.getCurrentTime?.();
          const bgCurrent = bgVideoRef.current?.currentTime;
          const audioMvDrift = (mvCurrent || 0) - (aCurrent + vOff);
          const audioBgDrift = bgCurrent != null ? bgCurrent - (aCurrent + vOff) : null;
          const mvBgDrift = bgCurrent != null && mvCurrent != null ? bgCurrent - mvCurrent : null;

          if (syncLogRef.current.enabled) {
            syncLog('tick', 'mv', {
              drift: Math.round(audioMvDrift * 1000),
              current: Math.round((mvCurrent || 0) * 1000),
              target: Math.round((aCurrent + vOff) * 1000),
              mode: mvEngine.state.mode,
              seekPending: mvEngine.state.seekPending,
              stalled: mvEngine.state.stalled,
            });
            if (bgCurrent != null) {
              syncLog('triangle', 'system', {
                audioMvMs: Math.round(audioMvDrift * 1000),
                audioBgMs: Math.round(audioBgDrift * 1000),
                mvBgMs: Math.round(mvBgDrift * 1000),
                audioMs: Math.round(aCurrent * 1000),
                mvMs: Math.round((mvCurrent || 0) * 1000),
                bgMs: Math.round((bgCurrent || 0) * 1000),
              });
            }
          }

          // Update recording state ref for overlay
          try {
            if (typeof registerRecordingState === 'function') {
              registerRecordingState({
                enabled: recordingRef.current.enabled,
                bufferLength: recordingRef.current.buffer.length,
                maxBuffer: recordingRef.current.maxBuffer,
              });
            }
          } catch (_) {}

          // Phase 0 — Sensor Layer: log sensor snapshot for replay/observability
          try {
            const mvVideo = videoRef.current;
            const mvDriftMs = Math.round(((mvCurrent || 0) - (aCurrent + vOff)) * 1000);
            const mvSnapshot = buildSensorSnapshot({
              engineId: 'mv',
              videoCurrentTime: mvCurrent || 0,
              audioCurrentTime: aCurrent + vOff,
              driftMs: mvDriftMs,
              readyState: mvVideo?.readyState || 0,
              networkState: mvVideo?.networkState || 0,
              waiting: mvVideo?.waiting || false,
              stalled: mvVideo?.stalled || false,
              seeking: mvVideo?.seeking || false,
              rvfcStatus: rvfcStatusRef.mv || 'UNKNOWN',
              tickDelta: tickDelta,
              cpuOverloaded: mvEngine.state.cpuOverloaded || false,
              droppedFrames: 0,
              decodeLatencyMs: 0,
              pipelineState: 'UNKNOWN',
              cptMs: 0,
            });
            const mvValidated = validateAndAttach(mvSnapshot);
            if (syncLogRef.current.enabled) logSensorSnapshot(syncLog, mvValidated);
            if (recordingRef.current.enabled) {
              recordingRef.current.buffer.push({
                kind: 'sensor_snapshot',
                engine: 'mv',
                ts: performance.now(),
                data: mvValidated.data,
                validationResult: mvValidated.validationResult,
              });
              if (recordingRef.current.buffer.length > recordingRef.current.maxBuffer) {
                recordingRef.current.buffer.splice(0, recordingRef.current.buffer.length - recordingRef.current.maxBuffer);
              }
            }

            // Phase 1 — Analyzer Layer: run analyzers in parallel, log evidence (no behavior change)
            try {
              const mvMemorySnapshot = createMemorySnapshot({
                engineId: 'mv',
                driftEMA: syncCore ? { value: syncCore.mv.rawDriftEMA?.mean || 0, sigma: syncCore.mv.rawDriftEMA?.stdDev || 0, count: syncCore.mv.rawDriftEMA?.samples || 0 } : null,
                biasMs: syncCore ? (syncCore.getBias('mv') || 0) * 1000 : 0,
                cptMs: 0,
                pipelineState: 'UNKNOWN',
                warmupPhase: mvEngine.pipelineMemory?.warmupPhase || false,
                disturbanceCount: 0,
                recentTickDeltas: state.recentTickDeltas || [],
                cpuOverloaded: state.cpuOverloaded || false,
                decodeLatencyHistory: [],
                droppedFrames: 0,
                futileCount: state.softSeekFutileCount || 0,
                adaptiveThresholds: { softMs: (softThreshold || 0.030) * 1000, hardMs: (activeHardThreshold || hardSeekThreshold) * 1000 },
                confidenceHistory: [],
                sessionQuality: 1,
                triangleDrifts: bgCurrent != null ? { hasTriangle: true, audioMvMs: audioMvDrift * 1000, audioBgMs: audioBgDrift * 1000, mvBgMs: mvBgDrift * 1000 } : null,
              });
              const mvCtx = { sensor: mvValidated, memorySnapshot: mvMemorySnapshot, config: {} };
              const mvDriftEvidence = evaluateDriftAnalyzer(mvCtx);
              const mvPipelineEvidence = evaluatePipelineAnalyzer(mvCtx);
              const mvSchedulerEvidence = evaluateSchedulerAnalyzer(mvCtx);
              const mvDecoderEvidence = evaluateDecoderAnalyzer(mvCtx);
              const mvConsistencyEvidence = bgCurrent != null ? evaluateConsistencyAnalyzer({ sensor: { data: { engineId: 'mv', audioMvMs: audioMvDrift * 1000, audioBgMs: audioBgDrift * 1000, mvBgMs: mvBgDrift * 1000 }, ts: performance.now() }, memorySnapshot: mvMemorySnapshot, config: {} }) : null;
              syncLog('analyzer_evidence', 'mv', { drift: mvDriftEvidence, pipeline: mvPipelineEvidence, scheduler: mvSchedulerEvidence, decoder: mvDecoderEvidence, consistency: mvConsistencyEvidence });
            } catch (_) { /* analyzer logging must not break tick */ }
          } catch (_) { /* sensor logging must not break tick */ }

          if (bgCurrent != null) {
            const bgDur = bgVideoRef.current?.duration;
            const bgDriftRaw = bgCurrent - (aCurrent + vOff);
            const bgDrift = (bgEngine.state.looping && isFinite(bgDur) && bgDur > 0)
              ? circularDiff(bgCurrent, aCurrent + vOff, bgDur)
              : bgDriftRaw;
            if (syncLogRef.current.enabled) {
              syncLog('tick', 'bg', {
                drift: Math.round(bgDrift * 1000),
                current: Math.round((bgCurrent || 0) * 1000),
                target: Math.round((aCurrent + vOff) * 1000),
                mode: bgEngine.state.mode,
                seekPending: bgEngine.state.seekPending,
                stalled: bgEngine.state.stalled,
              });
            }

            // Phase 0 — Sensor Layer: log sensor snapshot for replay/observability
            try {
              const bgVideo = bgVideoRef.current;
              const bgDriftMs = Math.round(bgDrift * 1000);
              const bgSnapshot = buildSensorSnapshot({
                engineId: 'bg',
                videoCurrentTime: bgCurrent || 0,
                audioCurrentTime: aCurrent + vOff,
                driftMs: bgDriftMs,
                readyState: bgVideo?.readyState || 0,
                networkState: bgVideo?.networkState || 0,
                waiting: bgVideo?.waiting || false,
                stalled: bgVideo?.stalled || false,
                seeking: bgVideo?.seeking || false,
                rvfcStatus: rvfcStatusRef.bg || 'UNKNOWN',
                tickDelta: tickDelta,
                cpuOverloaded: bgEngine.state.cpuOverloaded || false,
                droppedFrames: 0,
                decodeLatencyMs: 0,
                pipelineState: 'UNKNOWN',
                cptMs: 0,
              });
              const bgValidated = validateAndAttach(bgSnapshot);
              if (syncLogRef.current.enabled) logSensorSnapshot(syncLog, bgValidated);
              if (recordingRef.current.enabled) {
                recordingRef.current.buffer.push({
                  kind: 'sensor_snapshot',
                  engine: 'bg',
                  ts: performance.now(),
                  data: bgValidated.data,
                  validationResult: bgValidated.validationResult,
                });
                if (recordingRef.current.buffer.length > recordingRef.current.maxBuffer) {
                  recordingRef.current.buffer.splice(0, recordingRef.current.buffer.length - recordingRef.current.maxBuffer);
                }
              }

              // Phase 1 — Analyzer Layer: run analyzers in parallel, log evidence (no behavior change)
              try {
                const bgMemorySnapshot = createMemorySnapshot({
                  engineId: 'bg',
                  driftEMA: syncCore ? { value: syncCore.bg.rawDriftEMA?.mean || 0, sigma: syncCore.bg.rawDriftEMA?.stdDev || 0, count: syncCore.bg.rawDriftEMA?.samples || 0 } : null,
                  biasMs: syncCore ? (syncCore.getBias('bg') || 0) * 1000 : 0,
                  cptMs: 0,
                  pipelineState: 'UNKNOWN',
                  warmupPhase: bgEngine.pipelineMemory?.warmupPhase || false,
                  disturbanceCount: 0,
                  recentTickDeltas: bgEngine.state.recentTickDeltas || [],
                  cpuOverloaded: bgEngine.state.cpuOverloaded || false,
                  decodeLatencyHistory: [],
                  droppedFrames: 0,
                  futileCount: bgEngine.state.softSeekFutileCount || 0,
                  adaptiveThresholds: { softMs: (softThreshold || 0.030) * 1000, hardMs: (activeHardThreshold || hardSeekThreshold) * 1000 },
                  confidenceHistory: [],
                  sessionQuality: 1,
                  triangleDrifts: { hasTriangle: true, audioMvMs: audioMvDrift * 1000, audioBgMs: audioBgDrift * 1000, mvBgMs: mvBgDrift * 1000 },
                });
                const bgCtx = { sensor: bgValidated, memorySnapshot: bgMemorySnapshot, config: {} };
                const bgDriftEvidence = evaluateDriftAnalyzer(bgCtx);
                const bgPipelineEvidence = evaluatePipelineAnalyzer(bgCtx);
                const bgSchedulerEvidence = evaluateSchedulerAnalyzer(bgCtx);
                const bgDecoderEvidence = evaluateDecoderAnalyzer(bgCtx);
                syncLog('analyzer_evidence', 'bg', { drift: bgDriftEvidence, pipeline: bgPipelineEvidence, scheduler: bgSchedulerEvidence, decoder: bgDecoderEvidence });
              } catch (_) { /* analyzer logging must not break tick */ }
            } catch (_) { /* sensor logging must not break tick */ }
          }
          } // end throttle

          // Large-drift warnings — throttled to 500ms (same as tick log)
          if (now - lastTickLogRef.current >= 500) {
            const newMvDrift = Math.abs(((videoRef.current?.getCurrentTime?.() || 0) - (aCurrent + vOff)));
            if (newMvDrift > 0.2) {
              syncLog('large_drift', 'mv', { driftMs: Math.round(newMvDrift * 1000) });
            }

            if (bgVideoRef.current?.currentTime != null) {
              const bgDur2 = bgVideoRef.current?.duration;
              const bgCur = bgVideoRef.current.currentTime;
              const newBgDrift = Math.abs(
                (bgEngine.state.looping && isFinite(bgDur2) && bgDur2 > 0)
                  ? circularDiff(bgCur, aCurrent + vOff, bgDur2)
                  : bgCur - (aCurrent + vOff)
              );
              if (newBgDrift > 0.2) {
                syncLog('large_drift', 'bg', { driftMs: Math.round(newBgDrift * 1000) });
              }
            }
          }
        }
    }, 30);
    return () => clearInterval(id);
}, [audioReady, audioRef, mvEngine, bgEngine]);


// Audio seeked event — single source of truth for seek-driven re-anchor.
// `audio.timeupdate` no longer drives anchor here to avoid double-anchor;
// the 30 ms PID tick handles small post-seek drift.
useEffect(() => {
    const engine = getAudioEngine();
    const audio = engine.getElement();
    if (!audio) return;

    const onSeeked = () => {
        const now = audio.currentTime;
        syncLog('seeked', 'audio', { currentTime: Math.round(now * 1000) });

        if (scrubbingRef.current) return;

        if (userSeekPendingRef.current) {
            userSeekPendingRef.current = false;
            return;
        }

        const target = now + (videoOffsetRef.current || 0);
        const playing = usePlaybackStore.getState().isPlaying;
        mvEngine.anchor({ play: playing, target });
        if (youtubeId) {
            try { bgEngine.anchor({ play: playing, target }); } catch (_) {}
        }
        syncedRef.current = false;
    };

    engine.on('seeked', onSeeked);
    return () => {
        engine.off('seeked', onSeeked);
    };
}, [mvEngine, bgEngine, youtubeId]);

// On mode switch TO video mode, force a fresh anchor from the live audio position
// so BG follows the current offset and MV does not stay stuck on its old/anchorless position / poster.
useEffect(() => {
    const justEnteredVideo = isVideoMode && !prevModeRef.current;
    const justEnteredCover = !isVideoMode && prevModeRef.current && playerMode === 'cover';
    if (justEnteredVideo || justEnteredCover) {
        syncLog('mode_switch', 'system', {
            timestamp: performance.now(),
            from: prevModeRef.current ? 'video' : 'cover',
            to: isVideoMode ? 'video' : 'cover',
        });
    }
    prevModeRef.current = isVideoMode;

    if (justEnteredVideo) {
        const target = audioRef.current?.currentTime + (videoOffsetRef.current || 0);
        const playing = usePlaybackStore.getState().isPlaying;
        const mvReady = videoRef.current?.getReadyState?.() ?? 0;
        const mvSeekPending = mvEngine.state.seekPending;
        if (mvReady >= 3 && !mvSeekPending) {
            anchorCallCountRef.current.mv++;
            syncLog('anchor_call', 'mv', {
                timestamp: performance.now(),
                direction: 'cover->mv',
                totalCalls: anchorCallCountRef.current.mv,
                preRate: mvEngine.state.rate,
                preMode: mvEngine.state.mode,
                preSeekPending: mvEngine.state.seekPending,
            });
            mvEngine.anchor({ play: playing, target });
            syncLog('anchor_complete', 'mv', {
                timestamp: performance.now(),
                postRate: mvEngine.state.rate,
                postMode: mvEngine.state.mode,
            });
        }
    }

    if (justEnteredVideo || justEnteredCover) {
        // Do NOT re-anchor BG on cover<->MV switches; BG must keep running
        // uninterrupted. Its own tick() loop handles drift correction.
    }
}, [isVideoMode, mvEngine, bgEngine, youtubeId]);

// On initial mount or track change while in cover mode, ensure BG is playing.
useEffect(() => {
    if (playerMode !== 'cover' || !youtubeId) return;
    const bg = bgVideoRef.current;
    if (!bg || !bg.paused) return;

    const target = audioRef.current?.currentTime + (videoOffsetRef.current || 0);
    const dur = bg.duration;
    const bgTarget = (isFinite(dur) && dur > 0)
        ? ((target % dur) + dur) % dur
        : target;
    const gap = Math.abs((bg.currentTime || 0) - bgTarget);
    if (gap > 0.5) {
        bg.currentTime = bgTarget;
    }
    const playing = usePlaybackStore.getState().isPlaying;
    bgEngine.anchor({ play: playing, target: bgTarget });
}, [youtubeId, playerMode]);

// Cleanup bg video progress timer on track change.
useEffect(() => {
  return () => {
    if (bgVideoProgressTimerRef.current) {
      clearInterval(bgVideoProgressTimerRef.current);
      bgVideoProgressTimerRef.current = null;
    }
    bgVideoLoadFailedRef.current = false;
  };
}, [youtubeId]);

// One-time sync: position the video at the offset target as soon as it becomes
// ready. This runs again if videoOffset arrives/changes AFTER the first pass.
useEffect(() => {
    if (!(videoReady || metadataReady)) return;
    if (syncedRef.current && syncedOffsetRef.current === videoOffset) return;
    const seekTarget = audioRef.current?.currentTime + (videoOffsetRef.current || 0);
    if (usePlaybackStore.getState().isPlaying) {
        syncLog('anchor', 'mv', { target: seekTarget });
        mvEngine.anchor({ play: true, target: seekTarget });
        if (youtubeId) {
            try { bgEngine.anchor({ play: true, target: seekTarget }); } catch (_) {}
        }
    } else {
        const videoTime = videoRef.current?.getCurrentTime?.() ?? 0;
        if (Math.abs(seekTarget - videoTime) >= 0.1) mvEngine.anchor({ play: false, target: seekTarget });
        if (youtubeId) {
            try { bgEngine.anchor({ play: false, target: seekTarget }); } catch (_) {}
        }
    }
    syncedRef.current = true;
    syncedOffsetRef.current = videoOffset;
}, [videoReady, metadataReady, videoOffset, mvEngine, bgEngine, youtubeId]);

// Track MV video element remount (decode pipeline reset)
useEffect(() => {
  if (syncCore) syncCore.setVideoRemountKey('mv', videoRemountKey);
}, [videoRemountKey, syncCore]);

// Save per-track profile before a track change or on unmount.
// Declared immediately before the reset effect so its cleanup runs AFTER
// the reset cleanup, capturing EMAs that softReset() intentionally preserves.
const prevMediaIdForSaveRef = useRef(null);
useEffect(() => {
    const currentMediaId = activeFile?.file_id || activeFile?.id;
    if (prevMediaIdForSaveRef.current && prevMediaIdForSaveRef.current !== currentMediaId) {
      const mid = prevMediaIdForSaveRef.current;
      const mvProfile = syncCore?.captureProfile('mv');
      const bgProfile = syncCore?.captureProfile('bg');
      if (mvProfile || bgProfile) {
        trackProfileStore.set(mid, { ...(mvProfile || {}), ...(bgProfile || {}), mediaId: mid, updatedAt: performance.now() });
      }
    }
    prevMediaIdForSaveRef.current = currentMediaId;
}, [activeFile?.id, activeFile?.file_id]);

// Also save on unmount (cleanup runs after the reset effect's cleanup,
// so softReset()-preserved EMAs are still available).
useEffect(() => {
    return () => {
      const mid = prevMediaIdForSaveRef.current || trackProfileStore.getCurrentTrackId();
      if (!mid) return;
      const mvProfile = syncCore?.captureProfile('mv');
      const bgProfile = syncCore?.captureProfile('bg');
      if (mvProfile || bgProfile) {
        trackProfileStore.set(mid, { ...(mvProfile || {}), ...(bgProfile || {}), mediaId: mid, updatedAt: performance.now() });
      }
    };
}, []);

// Reset all sync state when track/video changes
useEffect(() => {
    const mediaId = activeFile?.file_id || activeFile?.id;

    if (syncCore) syncCore.clearObservability();

    if (!mediaId) {
      mvEngine.reset();
      bgEngine.reset();
      syncedRef.current = false;
      syncedOffsetRef.current = null;
      readyFiredRef.current = false;
      lastResumeTargetRef.current = null;
      lastResumeTimeRef.current = 0;
      setVideoReady(false);
      setMetadataReady(false);
      bgPendingTargetRef.current = null;
      bgSeekInProgressRef.current = false;
      bgSeekStartedAtRef.current = 0;
      bgPendingForceSeekRef.current = null;
      if (videoRef.current?.resetSeekState) {
        videoRef.current.resetSeekState();
      }
      return;
    }

    const profile = trackProfileStore.getOrCreate(mediaId);
    const confidence = profile.getEffectiveConfidence();

    if (confidence > 0.1) {
      if (syncCore) {
        syncCore.applyProfile('mv', profile);
        syncCore.applyProfile('bg', profile);
      }
      mvEngine.softReset();
      bgEngine.softReset();
    } else {
      mvEngine.reset();
      bgEngine.reset();
    }

    trackProfileStore.setCurrentTrackId(mediaId);
    syncedRef.current = false;
    syncedOffsetRef.current = null;
    readyFiredRef.current = false;
    lastResumeTargetRef.current = null;
    lastResumeTimeRef.current = 0;
    setVideoReady(false);
    setMetadataReady(false);
    bgPendingTargetRef.current = null;
    bgSeekInProgressRef.current = false;
    bgSeekStartedAtRef.current = 0;
    bgPendingForceSeekRef.current = null;
    if (videoRef.current?.resetSeekState) {
      videoRef.current.resetSeekState();
    }
}, [youtubeId, activeFile?.id, mvEngine, bgEngine, syncCore]);

// The MV ended (shorter than the song, or reached its own end). Wrap it
// seamlessly to the live audio position (mod MV duration) and keep playing —
// never show a black frame at the end of the clip.
const handleVideoEnded = useCallback(() => {
    const video = videoRef.current;
    if (syncCore && video) syncCore.recordVideoLifecycleEvent('mv', 'ended', video);
    if (!usePlaybackStore.getState().isPlaying) return;
    const audioEl = audioRef?.current;
    if (!audioEl) return;
    const player = videoRef.current;
    if (!player?.forceSeek) return;
    const mvDur = player.getDuration?.() || 0;
    const target = mvDur > 0
        ? ((audioEl.currentTime + (videoOffsetRef.current || 0)) % mvDur)
        : (videoOffsetRef.current || 0);
    mvEngine.anchor({ play: true, target });
}, [audioRef, mvEngine]);

// Recover the MV after a source outage (server restart / network loss).
const lastRecoveryRef = useRef(0);
const recoverVideo = useCallback(() => {
    const now = Date.now();
    if (now - lastRecoveryRef.current < 10000) return;
    lastRecoveryRef.current = now;
    if (syncCore && videoRef.current) {
      syncCore.recordVideoLifecycleEvent('mv', 'watchdog-hard', videoRef.current);
    }
    if (syncCore) syncCore.clearObservability();
    mvEngine.softReset();
    bgEngine.softReset();
    syncedRef.current = false;
    syncedOffsetRef.current = null;
    readyFiredRef.current = false;
    setVideoReady(false);
    setMetadataReady(false);
    videoRemountCountRef.current += 1;
    try { registerVideoRemountCount(videoRemountCountRef.current); } catch {}
    setVideoRemountKey((k) => k + 1);
}, [mvEngine, bgEngine, syncCore, registerVideoRemountCount]);

// Genuine <video> error (e.g. stream hiccup / source down).
const handleVideoError = useCallback(() => {
    const video = videoRef.current;
    if (syncCore && video) syncCore.recordVideoLifecycleEvent('mv', 'error', video);
    recoverVideo();
}, [recoverVideo]);

// If the network drops, the stream may stall. On reconnection try a soft
// reload first instead of a full remount — the player can usually recover
// without reinitializing the hardware decoder or clearing learned bias.
useEffect(() => {
    const onOnline = () => {
        if (videoRef.current && typeof videoRef.current.reload === 'function') {
            try { videoRef.current.reload(); } catch {}
        }
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
}, []);

// Recovery watchdog: if the <video> stays stalled past a grace window, escalate
// through soft recovery → full remount. Tier 1 (≤12 s): log only and let
// Chromium self-heal. Tier 2 (12–20 s): nudge the <video> via play/pause or
// load() without remounting the component. Tier 3 (≥20 s or explicit error):
// full recoverVideo() remount (syncCore state is preserved across remounts).
const WATCHDOG_INTERVAL = 5000;
const STALL_SOFT_MS = 12000;
const STALL_HARD_MS = 20000;

const videoRemountCountRef = useRef(0);
const softRecoveryRef = useRef(null);
const lastRecoveryTierRef = useRef(0);

const softRecoverVideo = useCallback(() => {
  const video = videoRef.current;
  if (!video) return;
  const now = Date.now();
  if (softRecoveryRef.current && now - softRecoveryRef.current < 8000) return;
  softRecoveryRef.current = now;
  if (syncCore) syncCore.recordVideoLifecycleEvent('mv', 'watchdog-soft', videoRef.current);
  try {
    if (typeof video.reload === 'function') {
      video.reload();
    } else {
      const wasPaused = video.getPaused?.();
      video.pauseVideo?.();
      setTimeout(() => { try { video.playVideo?.(); } catch {} }, 200);
    }
  } catch (_) {}
}, [syncCore]);

useEffect(() => {
  if (!isVideoMode) return undefined;
  const id = setInterval(() => {
    if (!mvEngine.state.stalled) { lastRecoveryTierRef.current = 0; return; }
    const elapsed = Date.now() - mvEngine.state.stalledSince;
    const lastTier = lastRecoveryTierRef.current;
    if (elapsed >= STALL_HARD_MS && lastTier < 3) {
      recoverVideo();
      lastRecoveryTierRef.current = 3;
    } else if (elapsed >= STALL_SOFT_MS && lastTier < 2) {
      softRecoverVideo();
      lastRecoveryTierRef.current = 2;
    }
  }, WATCHDOG_INTERVAL);
  return () => { clearInterval(id); lastRecoveryTierRef.current = 0; };
}, [isVideoMode, mvEngine, recoverVideo, softRecoverVideo]);

// Scrub start: pause the video so it can't run as a second, parallel timeline
// while the audio clock jumps around. The video is re-anchored on scrub-end.
const handleScrubStart = useCallback(() => {
    scrubbingRef.current = true;
    mvEngine.pause();
}, [mvEngine]);

// Scrub move: soft/coalesced seek so the paused video frame tracks the drag
// in real time (preview), without jank or a parallel playback clock.
// Routed through mvEngine so seekPending/lastAnchorTarget stay accurate.
const handleScrubChange = useCallback((val) => {
    const rawTarget = val + (videoOffsetRef.current || 0);
    mvEngine.anchor({ play: false, target: rawTarget });
}, [mvEngine]);

// Seek synchronization from progress bar – fires for ALL video modes. On
// release we clear the scrub flag and re-anchor the video to the live audio
// position through the single consolidated path (resuming clean sync).
const handleSeekSync = useCallback((seconds) => {
    userSeekPendingRef.current = true;
    scrubbingRef.current = false;
    setStorePosition(seconds);
    const target = seconds + (videoOffsetRef.current || 0);
    const currentVideoTime = videoRef.current?.getCurrentTime?.() ?? 0;
    const diff = target - currentVideoTime;
    const playing = usePlaybackStore.getState().isPlaying;
    syncLog('seek', 'mv', { target, current: currentVideoTime.toFixed(3), diff: diff.toFixed(3) });
    if (Math.abs(diff) <= 0.5) {
        if (playing) mvEngine.resume();
        return;
    }
    mvEngine.anchor({ play: true, target });
    if (youtubeId) {
      try { bgEngine.anchor({ play: true, target }); } catch (_) {}
    }
}, [mvEngine, setStorePosition]);

  const [favLoading, setFavLoading] = useState(false);
  const isFav = useIsFavorite(activeFile?.file_id || activeFile?.id, activeFile?.is_favorite ? 1 : 0);
  const handleToggleFavorite = useCallback(async () => {
    if (!activeFile?.id || favLoading) return;
    setFavLoading(true);
    try {
      await onFavoriteToggle(activeFile);
    } catch {}
    setFavLoading(false);
  }, [activeFile, favLoading, onFavoriteToggle]);

  const displayName = activeFile
    ? activeFile.display_name || activeFile.name
    : 'Memutar Audio...';

  const displayTitle = displayName;

  const handleToggleSyncOverlay = useCallback(() => {
    setShowSyncOverlay(prev => {
      const next = !prev;
      try { localStorage.syncDebug = next ? 'true' : 'false'; } catch {}
      window.__SYNC_DEBUG = next;
      return next;
    });
  }, []);

  const handleToggleEngine = useCallback(() => {
    const enteringVideo = playerMode === 'cover' || playerMode === 'lyrics';
    if (enteringVideo && !youtubeId) {
      const fileId = activeFile?.file_id || activeFile?.id;
      if (fileId) {
        fetch(`/api/metadata/${fileId}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.youtube_id && playerMode !== 'cover') {
              setYoutubeId(data.youtube_id);
              setVideoOffset(Number(data.video_offset) || 0);
              setTrackMetadata(data);
              setLyricsSynced(data.lyrics_synced || data.syncedLyrics || null);
            }
          })
          .catch(() => {});
      }
    }

    setPlayerMode(prev => {
      if (prev === 'cover' || prev === 'lyrics') return 'video';
      if (prev === 'video' || prev === 'video-split' || prev === 'video-cover') return 'cover';
      return prev;
    });
  }, [youtubeId, playerMode, activeFile?.file_id, activeFile?.id]);

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  const headerNode = useMemo(() => {
    return (
      <>
        <div className="relative flex items-center justify-between w-full" style={{ background: 'rgb(12,12,16)' }}>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/20 transition-colors"
            title="Close player"
          >
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <div className="absolute left-1/2 -translate-x-1/2 text-center pointer-events-none px-2 max-w-[70%]">
            <span className="text-[10px] font-bold text-purple-400 uppercase tracking-[0.2em]">Now Playing</span>
            <div className="text-base font-semibold text-white truncate">{displayTitle}</div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={handleToggleSyncOverlay}
              className={`p-2 rounded-full transition-colors ${showSyncOverlay ? 'bg-white/20 text-purple-400' : 'text-white/70 hover:bg-white/20 hover:text-white'}`}
              title={showSyncOverlay ? 'Hide sync overlay' : 'Show sync overlay'}
            >
              <Activity size={20} />
            </button>
               <button
                 onClick={handleToggleEngine}
                 className={`p-2 rounded-full transition-colors min-w-[3.5rem] text-center ${isVideoMode ? 'bg-gradient-to-r from-sky-500/30 to-indigo-500/30 text-white' : 'text-white/70 hover:bg-white/20 hover:text-white'}`}
                 title={isVideoMode ? 'Switch to Cover mode' : 'Switch to MV mode'}
               >
                <span className="text-xs font-bold">{isVideoMode ? 'Cover' : 'MV'}</span>
              </button>
               <button
                 onClick={handleToggleFavorite}
                 disabled={favLoading}
                 className={`p-2 rounded-full transition-colors ${isFav ? 'text-red-500 hover:bg-white/20' : 'text-white/70 hover:bg-white/20 hover:text-white'}`}
                 title={isFav ? 'Remove from favorites' : 'Add to favorites'}
               >
                 <Heart size={20} className={isFav ? 'fill-red-500' : ''} />
               </button>
           </div>
            {hasPlaylist && (
             <button
               onClick={() => setShowQueuePanel(p => !p)}
               className={`p-2 rounded-full transition-colors ${showQueuePanel ? 'bg-white/20 text-white' : 'hover:bg-white/20 text-white/60'}`}
               title="Queue"
             >
               <ListMusic className="w-5 h-5" />
             </button>
            )}
            {onMinimize && (
             <button
               onClick={onMinimize}
               className="p-2 rounded-full hover:bg-white/20 transition-colors"
               title="Mini player"
             >
               <Minimize2 className="w-5 h-5 text-[#8892E6]" />
             </button>
           )}
         </div>
       </>
     );
  }, [onClose, onMinimize, hasPlaylist, showQueuePanel, isFav, favLoading, handleToggleFavorite, handleToggleSyncOverlay, handleToggleEngine, showSyncOverlay, isVideoMode, playerMode, displayTitle]);
        const handleClick = useCallback((e) => {
          if (e.button !== 0 && e.button !== 1) return;   // left / middle only
          e.preventDefault();

          if (!youtubeId) {
            // No video: simple cover <-> lyrics toggle.
            setPlayerMode(prev => (prev === 'lyrics' ? 'cover' : 'lyrics'));
            return;
          }

          if (isVideoMode) {
            // Left-click anywhere in video mode returns to the main cover view
            // (video disappears). The side panel is driven by RIGHT-click.
            setPlayerMode('cover');
          } else {
            // Cover / lyrics mode (a track with a video): left-click cycles cover <-> lyrics.
            setPlayerMode(prev => (prev === 'lyrics' ? 'cover' : 'lyrics'));
          }
        }, [youtubeId, playerMode, hasLyrics, isVideoMode, setPlayerMode]);

        const handleContextMenu = useCallback((e) => {
          e.preventDefault();
          if (!youtubeId) return;             // nothing video-related to cycle
          const area = e.target.closest('[data-area]')?.getAttribute('data-area');

          if (!isVideoMode) {
            // Cover / lyrics mode: right-click enters VIDEO mode (pure video first);
            // further right-clicks reveal the side panel (cover/lyrics).
            setPlayerMode('video');
            return;
          }

          // Inside a video mode, the right-click target decides the action:
          //  - clicking the VIDEO closes the side panel back to pure video;
          //  - clicking the SIDE PANEL swaps lyrics <-> cover (the user's intent);
          //  - a click that lands on the container margin falls back to pure video.
          if (playerMode === 'video') {
            setPlayerMode(hasLyrics ? 'video-split' : 'video-cover');
          } else if (playerMode === 'video-split') {
            if (area === 'lyrics') {
              setPlayerMode('video-cover');     // swap panel: lyrics -> cover
            } else {
              setPlayerMode('video');           // video area / margin -> close panel
            }
          } else if (playerMode === 'video-cover') {
            if (area === 'cover-box') {
              setPlayerMode(hasLyrics ? 'video-split' : 'video-cover'); // swap -> lyrics
            } else {
              setPlayerMode('video');           // video area / margin -> close panel
            }
          }
        }, [youtubeId, playerMode, hasLyrics, isVideoMode, setPlayerMode]);

        const handleVideoReady = useCallback(() => {
          if (!readyFiredRef.current) {
            readyFiredRef.current = true;
            setVideoReady(true);
          }
          mvEngine.onCanPlay?.();
          const video = videoRef.current;
          if (syncCore && video) {
            syncCore.setVideoSrc('mv', video.src || video.currentSrc);
            syncCore.recordVideoLifecycleEvent('mv', 'canplay', video);
          }
          syncLog('ready', 'mv', {});
        }, [mvEngine]);

        const onVideoLoadedMetadata = useCallback(() => {
          const video = videoRef.current;
          if (syncCore && video) {
            syncCore.setVideoSrc('mv', video.src || video.currentSrc);
            syncCore.recordVideoLifecycleEvent('mv', 'loadedmetadata', video);
          }
          // Position the video at the offset target the moment it loads, so the
          // FIRST presented frame is the offset frame — not frame 00:00 (which
          // briefly flashes when entering video mode before the engine's first
          // anchor lands). Only when the video is still parked at the start.
          if (video && (video.currentTime || 0) < 0.05) {
            const t = (audioRef.current?.currentTime ?? 0) + (videoOffsetRef.current || 0);
            if (t > 0.05) video.forceSeek?.(t);
          }
          syncLog('loadedmetadata', 'mv', {});
        }, []);
        const onVideoWaiting = useCallback(() => {
          const video = videoRef.current;
          if (syncCore && video) syncCore.recordVideoLifecycleEvent('mv', 'waiting', video);
          syncLog('waiting', 'mv', {});
          mvEngine.onWaiting();
        }, [mvEngine]);
        const onVideoStalled = useCallback(() => {
          const video = videoRef.current;
          if (syncCore && video) syncCore.recordVideoLifecycleEvent('mv', 'stalled', video);
          syncLog('stalled', 'mv', {});
          mvEngine.onStalled();
        }, [mvEngine]);
        const onVideoPlaying = useCallback(() => {
          const video = videoRef.current;
          if (syncCore && video) syncCore.recordVideoLifecycleEvent('mv', 'playing', video);
          syncLog('playing', 'mv', {});
          mvEngine.onPlaying();
        }, [mvEngine]);
        const onVideoSeeked = useCallback(() => {
          const video = videoRef.current;
          if (syncCore && video) syncCore.recordVideoLifecycleEvent('mv', 'seeked', video);
          syncLog('seeked', 'mv', {});
          mvEngine.onSeeked();
        }, [mvEngine]);

        const onVideoPause = useCallback(() => {
          const video = videoRef.current;
          if (syncCore && video) syncCore.recordVideoLifecycleEvent('mv', 'pause', video);
          if (usePlaybackStore.getState().isPlaying && !mvEngine.state.intentionalPause && !mvEngine.state.seekPending) {
            syncLog('video_paused_resume', 'mv', {});
            videoRef.current?.playVideo?.();
          }
        }, [mvEngine]);

        const onMvVideoFrame = useCallback((frame) => {
          rvfcMvLastTimeRef.current = performance.now();
          // Track 0.25 — preserve latest RVFC metadata for clock provenance
          rvfcMvDataRef.current = {
            presentationTime: frame.presentationTime ?? null,
            expectedDisplayTime: frame.expectedDisplayTime ?? null,
            mediaTime: frame.mediaTime ?? null,
            processingDuration: frame.processingDuration ?? null,
          };
          if (syncCore && frame.expectedDisplayTime != null && frame.presentationTime != null) {
            const presLatMs = frame.expectedDisplayTime - frame.presentationTime;
            if (isValidTelemetrySample(presLatMs, { minAgeMs: 500, trackChangeTime: trackChangeTimeRef.current })) {
              syncCore.observePresentationLatency('mv', presLatMs);
            }
            const frameAgeMs = (performance.now() - frame.presentationTime);
            if (isValidTelemetrySample(frameAgeMs, { minAgeMs: 500, trackChangeTime: trackChangeTimeRef.current })) {
              syncCore.observeFrameAge('mv', frameAgeMs);
            }
          }
          if (syncCore && frame.processingDuration != null) {
            const decodeLatMs = frame.processingDuration;
            if (isValidTelemetrySample(decodeLatMs, { minAgeMs: 500, trackChangeTime: trackChangeTimeRef.current })) {
              syncCore.observeDecodeLat('mv', decodeLatMs);
            }
          }
          if (syncCore) syncCore.observeFrame('mv', performance.now());
        }, []);

        useEffect(() => {
          const el = bgVideoRef.current;
          if (!el || typeof el.requestVideoFrameCallback !== 'function') return;
          let running = true;
          const loop = (now, metadata) => {
            if (!running) return;
            rvfcBgLastTimeRef.current = now;
            // Track 0.25 — preserve latest RVFC metadata for clock provenance
            rvfcBgDataRef.current = {
              presentationTime: metadata.presentationTime ?? null,
              expectedDisplayTime: metadata.expectedDisplayTime ?? null,
              mediaTime: metadata.mediaTime ?? null,
              processingDuration: metadata.processingDuration ?? null,
            };
            el.requestVideoFrameCallback(loop);
            if (syncCore && metadata.expectedDisplayTime != null && metadata.presentationTime != null) {
              const presLatMs = metadata.expectedDisplayTime - metadata.presentationTime;
              if (isValidTelemetrySample(presLatMs, { minAgeMs: 500, trackChangeTime: trackChangeTimeRef.current })) {
                syncCore.observePresentationLatency('bg', presLatMs);
              }
              const frameAgeMs = (now - metadata.presentationTime);
              if (isValidTelemetrySample(frameAgeMs, { minAgeMs: 500, trackChangeTime: trackChangeTimeRef.current })) {
                syncCore.observeFrameAge('bg', frameAgeMs);
              }
            }
            if (syncCore && metadata.processingDuration != null) {
              const decodeLatMs = metadata.processingDuration;
              if (isValidTelemetrySample(decodeLatMs, { minAgeMs: 500, trackChangeTime: trackChangeTimeRef.current })) {
                syncCore.observeDecodeLat('bg', decodeLatMs);
              }
            }
            if (syncCore) syncCore.observeFrame('bg', now);
            syncLog('rvfc', 'bg', {
              mediaTime: metadata.mediaTime?.toFixed(3) ?? 'null',
              presentedFrames: metadata.presentedFrames,
              processingDuration: metadata.processingDuration?.toFixed(3) ?? 'null'
            });
          };
          el.requestVideoFrameCallback(loop);
          return () => { running = false; };
        }, []);

  // Play audio within user gesture context (click handler) to bypass autoplay policy
  const playFileInGesture = useCallback(async (fileId) => {
    if (!fileId) return;
    const engine = getAudioEngine();
    const audio = engine.getElement();
    const newSrc = `/file/${fileId}`;
    switchingRef.current = true;
    lastSrcSetRef.current = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (audio?.src !== window.location.origin + newSrc) {
      engine.load(fileId);
    } else {
      engine.seek(0);
    }
    prevFileIdRef.current = fileId;
    await applySink(audio, getStoredDevice());
    engine.play().then(() => {
      play();
      setIsLoading(false);
      switchingRef.current = false;
    }).catch(() => {
      switchingRef.current = false;
    });
  }, [play]);

  const handleCarouselSelect = useCallback((selectedFile) => {
    const fileId = selectedFile?.file_id || selectedFile?.id;
    if (fileId) playFileInGesture(fileId);
    if (hasPlaylist) {
      const idx = playlistFiles.findIndex(f => f.id === selectedFile.id);
      if (idx !== -1) {
        setCurrentTrackIndex(idx);
        onTrackIndexChange?.(idx);
      }
    } else {
      onAudioChange?.(selectedFile);
    }
  }, [hasPlaylist, playlistFiles, playFileInGesture, setCurrentTrackIndex, onAudioChange, onTrackIndexChange]);

  // Scrub start: pause the video so it can't run as a second, parallel timeline
  // while the audio clock jumps around. The video is re-anchored on scrub-end.
  // Skip only advances the store + cover/MV metadata. The actual audio load +
  // play is delegated to the shared load effect (Music.jsx:1988) which coalesces
  // rapid skips through its 100ms timer. Calling playFileInGesture here would
  // bypass that coalescing and cause play/pause flicker when spamming M/N or the
  // on-screen Next/Prev buttons.
  const handleNext = useCallback(() => {
    const prev = usePlaybackStore.getState();
    if (prev.queue.length === 0) return;
    if (!prev.shuffle && prev.loopMode === 'off' && prev.currentTrackIndex === prev.queue.length - 1) return;
    next();
    const st = usePlaybackStore.getState();
    if (st.currentTrackIndex === prev.currentTrackIndex) return;
    const nextFile = st.queue[st.currentTrackIndex];
    if (nextFile) {
      // Keep the `file` prop (and thus the cover/MV metadata) in sync so the
      // video follows the skip even when there is no playlist queue.
      onAudioChange?.(nextFile);
    }
    if (hasPlaylist) onTrackIndexChange?.(st.currentTrackIndex);
  }, [next, hasPlaylist, onTrackIndexChange, onAudioChange]);

  const handlePrevious = useCallback(() => {
    const prev = usePlaybackStore.getState();
    if (prev.queue.length === 0) return;
    if (!prev.shuffle && prev.loopMode === 'off' && prev.currentTrackIndex === 0) return;
    previous();
    const st = usePlaybackStore.getState();
    if (st.currentTrackIndex === prev.currentTrackIndex) return;
    const prevFile = st.queue[st.currentTrackIndex];
    if (prevFile) {
      onAudioChange?.(prevFile);
    }
    if (hasPlaylist) onTrackIndexChange?.(st.currentTrackIndex);
  }, [previous, hasPlaylist, onTrackIndexChange, onAudioChange]);

  // Route keyboard M/N (next/prev) through the same path as the on-screen
  // buttons so the audio loads + plays inside the keydown gesture. This
  // avoids the deferred load in the track-change effect (100ms setTimeout)
  // that caused play/pause flicker on rapid skip.
  useEffect(() => {
    const onNext = () => handleNext();
    const onPrev = () => handlePrevious();
    window.addEventListener('music-skip-next', onNext);
    window.addEventListener('music-skip-prev', onPrev);
    return () => {
      window.removeEventListener('music-skip-next', onNext);
      window.removeEventListener('music-skip-prev', onPrev);
    };
  }, [handleNext, handlePrevious]);

    const mainContent = useMemo(() => {
     // --- Fit cover/video into the available media area (excludes title) ---
    const aW = availSize.width || 384;
    const aH = availSize.height || 384;
    const COVER_MAX = 384; // 24rem
    const coverBox = Math.min(aW, aH, COVER_MAX);

    const isSplit = playerMode === 'video-split' || playerMode === 'video-cover';
    const hasVideo = !!youtubeId;
    // Video shows when in a video mode OR while hovering the cover as a preview.
    const isVideo = isVideoMode && hasVideo;

    const baseVidW = coverBox * 16 / 9;
    const baseVidH = coverBox;
    const vScale = Math.min(1, aW / baseVidW, aH / baseVidH);

    const GAP = 16;
    const basePanel = baseVidH;
    const sScale = Math.min(1, aW / (baseVidW + GAP + basePanel), aH / baseVidH);

    const curVidW = isSplit ? baseVidW * sScale : baseVidW * vScale;
    const curVidH = isSplit ? baseVidH * sScale : baseVidH * vScale;
    const panelW = isSplit ? basePanel * sScale : 0;
    const panelH = isSplit ? curVidH : 0;

    // In split (video-split / video-cover) mode, center the COMBINED
    // video + panel block so the video nudges left and the panel sits to its
    // right with equal left/right margins — instead of the video being
    // hard-centered with the panel hanging off the right edge.
    const totalBlockW = isSplit ? curVidW + GAP + panelW : curVidW;
    const videoLeft = Math.max(0, (aW - totalBlockW) / 2);
    const videoTop  = Math.max(0, (aH - curVidH) / 2);

    const panelLeft = videoLeft + curVidW + GAP;
    const panelTop  = videoTop;

    const coverLeft = Math.max(0, (aW - coverBox) / 2);
    const coverTop  = Math.max(0, (aH - coverBox) / 2);

    // Breathing (play/pause) pulse only for cover/lyrics. In any video mode we
    // keep scale = 1 so the 1.04 grow never eats the gap and makes the side
    // panel overlap the video in split (video-split / video-cover) layouts.
    const coverScale = isVideo ? 1 : (isPlaying ? 1.04 : 0.9);
    const breath = `scale(${coverScale})`;

    const containerTransition = 'width 400ms ease, height 400ms ease, opacity 400ms ease';

       const containerH = aH + 8;
      const containerStyle = {
        width: aW + 'px',
        height: containerH + 'px',
        maxWidth: '100%',
        transition: containerTransition,
        opacity: 1,
      };

    let regionLeft, regionTop, regionW, regionH;
    if (isVideo) {
      regionLeft = videoLeft;
      regionTop  = videoTop;
      regionW    = curVidW;
      regionH    = curVidH;
    } else {
      regionLeft = coverLeft;
      regionTop  = coverTop;
      regionW    = coverBox;
      regionH    = coverBox;
    }

    const stageStyle = {
      position: 'absolute',
      left: regionLeft + 'px',
      top: regionTop + 'px',
      width: regionW + 'px',
      height: regionH + 'px',
      borderRadius: '1rem',
      overflow: 'hidden',
      boxShadow: '0 10px 25px rgba(0,0,0,0.45)',
      transform: breath,
      transformOrigin: 'center center',
      transition: 'left 400ms ease, top 400ms ease, width 400ms ease, height 400ms ease, transform 400ms ease, opacity 400ms ease',
      zIndex: 2,
    };

    const lyricsPanelStyle = {
      position: 'absolute',
      left: panelLeft + 'px',
      top: panelTop + 'px',
      width: panelW + 'px',
      height: panelH + 'px',
      borderRadius: '1rem',
      overflow: 'hidden',
      transform: breath,
      transformOrigin: 'center center',
      opacity: isSplit ? 1 : 0,
      pointerEvents: isSplit ? 'auto' : 'none',
      transition: 'width 400ms ease, height 400ms ease, opacity 400ms ease, left 400ms ease, top 400ms ease, transform 400ms ease',
      zIndex: 1,
    };

    return (
      <div className="flex flex-col items-center w-full">
        <div
          ref={containerRef}
          className="relative w-full cursor-pointer overflow-hidden rounded-2xl"
          style={containerStyle}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
        >
          {/* SINGLE MORPHING STAGE: cover / video / lyrics (1:1 <-> 16:9).
              Satu kontainer rounded yang ukuran/posisinya morph; anak-anak isi penuh
              (inset:0) dan di-crossfade opacity sehingga transisi cover<->video tanpa peek. */}
        <div
          data-area={isVideo ? 'video' : (playerMode === 'lyrics' ? 'lyrics' : 'cover')}
          className="absolute"
          style={stageStyle}
        >
          {/* Cover child — fills the square clip region */}
          <div
            className="absolute inset-0"
            style={{
              // Stage clips to a rounded 1rem container, so the image is always
              // rounded; borderRadius/overflow below are a harmless safeguard.
              borderRadius: '1rem',
              overflow: 'hidden',
              opacity: (!isVideo && playerMode !== 'lyrics') ? 1 : 0,
              pointerEvents: (!isVideo && playerMode !== 'lyrics') ? 'auto' : 'none',
              transition: 'opacity 400ms ease',
            }}
          >
            {activeFile ? (
              <NetworkImage
                src={coverBlobUrl || activeCoverUrl}
                alt="Cover"
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-purple-800 to-sky-900 flex items-center justify-center">
                <svg className="w-20 h-20 text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
            )}
            {isLoading && !error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="w-12 h-12 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin" />
              </div>
             )}
             {playerMode === 'cover' && (
              <div className="absolute top-2 right-2 opacity-0 hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMetadataEditor(true); }}
                  className="p-1.5 bg-black/50 hover:bg-black/70 rounded-full text-white/70 hover:text-white transition-colors"
                  title="Edit metadata"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Video child — fills the 16:9 clip region */}
          {youtubeId && (
            <div
              className="absolute inset-0"
              style={{
                opacity: isVideo ? 1 : 0,
                pointerEvents: isVideo ? 'auto' : 'none',
                transition: 'opacity 400ms ease, transform 400ms ease',
                transform: isVideo ? (isPlaying ? 'scale(1.01)' : 'scale(0.99)') : 'scale(1)',
                transformOrigin: 'center center',
              }}
            >
                <CachedVideoPlayer
                  key={videoRemountKey}
                  ref={videoRef}
                  youtubeId={youtubeId}
                  coverUrl={coverBlobUrl || activeCoverUrl}
                  muted
                  onReady={handleVideoReady}
                  onLoadedMetadata={onVideoLoadedMetadata}
                  onWaiting={onVideoWaiting}
                  onStalled={onVideoStalled}
                  onPlaying={onVideoPlaying}
                  onSeeked={onVideoSeeked}
                  onPause={onVideoPause}
                  onEnded={handleVideoEnded}
                   onError={handleVideoError}
                   onVideoFrame={onMvVideoFrame}
                />
            </div>
          )}

           {/* Lyrics child — fills the square clip region (blurred cover + lyrics) */}
           <div
             className="absolute inset-0"
             style={{
               borderRadius: '1rem',
               overflow: 'hidden',
               opacity: playerMode === 'lyrics' ? 1 : 0,
               pointerEvents: playerMode === 'lyrics' ? 'auto' : 'none',
               transition: 'opacity 400ms ease',
             }}
           >
             {activeFile && (coverBlobUrl || activeCoverUrl) ? (
               <>
             <div className="absolute inset-0 bg-gradient-to-br from-purple-900 via-neutral-900 to-sky-900" />
               <NetworkImage
                 src={coverBlobUrl || activeCoverUrl}
                 alt=""
                 className="absolute inset-0 w-full h-full object-cover"
                 style={{ filter: 'blur(28px) brightness(0.7) saturate(1.25)', transform: 'scale(1.15)' }}
                 showRetry={false}
               />
             </>
             ) : (
               <div className="absolute inset-0 bg-gradient-to-br from-purple-900 via-neutral-900 to-sky-900 flex items-center justify-center">
                 <svg className="w-20 h-20 text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                   <path d="M9 18V5l12-2v13" />
                   <circle cx="6" cy="18" r="3" />
                   <circle cx="18" cy="16" r="3" />
                 </svg>
               </div>
             )}
             <div className="absolute inset-0 bg-black/15" />
             <div
               className="absolute inset-0"
               style={{ background: 'radial-gradient(circle at center, rgba(10,10,10,0) 38%, rgba(10,10,10,0.6) 100%)' }}
             />
             <div className="relative z-10 w-full h-full overflow-y-auto p-4 sm:p-6">
               <LyricsDisplay
                 lyrics={lyricsSynced || trackMetadata?.lyrics}
                 audioRef={audioRef}
                 isPlaying={isPlaying}
               />
             </div>
           </div>
        </div>

        {/* SPLIT BLOCK (video-split: lyrics, video-cover: cover art).
            Kedua konten dirender sekaligus dan di-crossfade opacity agar
            transisi cover<->lyrics tidak "loncat". Posisi di-animasikan via
            transform (style lyricsPanelStyle); video layer z-index lebih tinggi
            sehingga panel tidak menutupi video saat transisi. */}
        <div
          data-area={playerMode === 'video-cover' ? 'cover-box' : 'lyrics'}
          className="rounded-2xl overflow-hidden"
          style={lyricsPanelStyle}
        >
          {/* Child A: cover art (video-cover) */}
          <div
            className="absolute inset-0"
            style={{ opacity: playerMode === 'video-cover' ? 1 : 0, transition: 'opacity 300ms ease' }}
          >
             <NetworkImage
               src={coverBlobUrl || activeCoverUrl}
               alt="Cover"
               className="absolute inset-0 w-full h-full object-cover"
             />
          </div>
          {/* Child B: lyrics (video-split) */}
          <div
            className="absolute inset-0"
            style={{
              opacity: playerMode === 'video-split' ? 1 : 0,
              transition: 'opacity 300ms ease',
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-900 via-neutral-900 to-sky-900" />
             <NetworkImage
               src={coverBlobUrl || activeCoverUrl}
               alt=""
               className="absolute inset-0 w-full h-full object-cover"
               style={{ filter: 'blur(22px) brightness(0.75) saturate(1.2)', transform: 'scale(1.1)' }}
               showRetry={false}
             />
            <div className="absolute inset-0 bg-black/15" />
            <div className="relative z-10 w-full h-full">
              <LyricsDisplay
                lyrics={lyricsSynced || trackMetadata?.lyrics}
                audioRef={audioRef}
                isPlaying={isPlaying}
              />
            </div>
          </div>
        </div>

        {/* VIDEO SEARCH PICKER */}
        {playerMode === 'video' && !youtubeId && videoSearchResults && (
          <div className="absolute inset-0 bg-black/90 rounded-2xl overflow-y-auto z-20 p-3">
            <p className="text-white/60 text-[10px] mb-2">Pilih video:</p>
            <div className="space-y-2">
              {videoSearchResults && videoSearchResults.map((r) => (
                <button
                  key={r.id}
                  onClick={(e) => { e.stopPropagation(); handleVideoPick(r.id); }}
                  className="w-full flex gap-2 items-start p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-left"
                >
                  <img src={r.thumbnail} alt="" className="w-14 h-10 rounded object-cover flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-white text-[11px] font-medium leading-tight truncate">{r.title}</p>
                    <p className="text-white/40 text-[10px] truncate">{r.channel}</p>
                  </div>
                </button>
              ))}
              {videoSearchResults.length === 0 && (
                <p className="text-white/30 text-xs text-center py-4">No results found</p>
              )}
             </div>
           </div>
      )}
 
         </div>
       </div>
    );
  }, [activeFile?.id, coverBlobUrl, coverVersion, isLoading, error, isPlaying, playerMode, lyricsSynced, trackMetadata, youtubeId, videoSearchResults, audioRef, pause, play, handleVideoSearch, handleVideoPick, availSize]);

  const handleQueueSelect = useCallback((index) => {
    const queueFile = playlistFiles[index];
    if (queueFile) {
      const fid = queueFile.file_id || queueFile.id;
      if (fid) playFileInGesture(fid);
    }
    setCurrentTrackIndex(index);
    if (hasPlaylist) onTrackIndexChange?.(index);
  }, [playlistFiles, playFileInGesture, setCurrentTrackIndex, hasPlaylist, onTrackIndexChange]);

  // Dedicated Music UI (no MediaLayout / media-vault shared chrome): show the
  // carousel only when there are siblings, and let the user hide it (persisted).
  const showCarousel = carouselFiles.length > 1;
  const [manualHidden, setManualHidden] = useState(() => {
    try { return localStorage.getItem('mv_carousel_hidden') === '1'; } catch { return false; }
  });
  const toggleCarouselHidden = useCallback(() => {
    setManualHidden((h) => {
      const next = !h;
      try { localStorage.setItem('mv_carousel_hidden', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  // Register refs for SyncOverlay (Phase 0 observability)
  useEffect(() => {
    registerSyncCore(syncCore);
    registerAudioRef(audioRef);
    registerMvRef(videoRef);
    registerBgRef(bgVideoRef);
    registerEngineStateRef(mvEngine.state, bgEngine.state);
    registerVideoOffsetRef(videoOffsetRef);
    registerRvfcStatusRef(rvfcStatusRef);
    registerVideoRemountCount(videoRemountCountRef.current);
    registerReplayStateRef(replayStateRef);
    registerRecordingState({
      enabled: recordingRef.current.enabled,
      bufferLength: recordingRef.current.buffer.length,
      maxBuffer: recordingRef.current.maxBuffer,
    });
    registerAnalyzerEvidence(analyzerEvidenceRef.current);
    registerDecisionOutput(decisionOutputRef.current);
    window.__replayStateRef = replayStateRef;
  }, [syncCore, mvEngine, bgEngine]);

  // __SYNC_DEBUG toggle: window.__SYNC_DEBUG = true or localStorage.syncDebug = 'true'
  useEffect(() => {
    const check = () => {
      const debug = window.__SYNC_DEBUG === true || localStorage.syncDebug === 'true';
      if (debug) {
        window.__SYNC_DEBUG = true;
        try { localStorage.syncDebug = 'true'; } catch {}
      }
    };
    check();

    // Expose replay API
    window.__SYNC_REPLAY = (config) => {
      const replay = new SyncReplay(syncCore.getReplayLog());
      return replay.runWithConfig(config || {});
    };
    window.__SYNC_REPLAY_COMPARE = (configA, configB) => {
      const replay = new SyncReplay(syncCore.getReplayLog());
      return replay.compareConfigs(configA || {}, configB || {});
    };
    window.__SYNC_CORE = syncCore;

    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, []);

   // RVFC status tracking
   useEffect(() => {
     const update = () => {
       const now = performance.now();
       const bgVideo = bgVideoRef.current;
       const bgPaused = bgVideo ? bgVideo.paused : true;

       // MV: CachedVideoPlayer wraps the <video>, so we detect RVFC activity
       // via rvfcMvLastTimeRef (updated by onVideoFrame callback) rather than
       // checking requestVideoFrameCallback on the component instance.
       const mvSupported = rvfcMvLastTimeRef.current > 0;
       const mvPaused = videoRef.current?.getPaused?.() ?? true;
       if (mvSupported) {
         if (mvPaused) {
           rvfcStatusRef.mv = 'PAUSED';
         } else if (now - rvfcMvLastTimeRef.current > 1000) {
           rvfcStatusRef.mv = 'TIMEOUT';
         } else {
           rvfcStatusRef.mv = 'ACTIVE';
         }
       } else {
         rvfcStatusRef.mv = 'UNSUPPORTED';
       }

       if (typeof bgVideo?.requestVideoFrameCallback === 'function') {
         if (bgPaused) {
           rvfcStatusRef.bg = 'PAUSED';
         } else if (now - rvfcBgLastTimeRef.current > 1000) {
           rvfcStatusRef.bg = 'TIMEOUT';
         } else {
           rvfcStatusRef.bg = 'ACTIVE';
         }
       } else if (bgVideo) {
         rvfcStatusRef.bg = 'UNSUPPORTED';
       }
     };
     const id = setInterval(update, 500);
     update();
     return () => clearInterval(id);
   }, []);



  return (
    <div data-debug-id="1.1.9.3" data-debug-name="AudioPlayer" data-debug-type="player" className="w-full h-full overflow-hidden max-w-full flex flex-col text-slate-100 select-none relative">
      {/* Sync debug overlay — toggle with window.__SYNC_DEBUG = true */}
      <SyncOverlay onClose={() => setShowSyncOverlay(false)} />
       {/* Video background: blurred, stretched video behind all content when in video mode */}
        {youtubeId && (
        <video
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ filter: `blur(12px) saturate(1.4) brightness(${isPlaying ? 0.85 : 0.45})`, transition: 'filter 400ms ease', transform: 'scale(1.2)', zIndex: 0, opacity: 0.35, maskImage: 'radial-gradient(ellipse at center, black 25%, transparent 70%)', WebkitMaskImage: 'radial-gradient(ellipse at center, black 25%, transparent 70%)', maskSize: '100% 100%', WebkitMaskSize: '100% 100%' }}
          src={`/api/video-cache/stream/${youtubeId}`}
          muted
          playsInline
          preload="auto"
          ref={(el) => { bgVideoRef.current = el; }}
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
            if (bg && isFinite(bg.duration) && bg.duration > 0) {
                const mvReady = videoReady || metadataReady;
                const audio = audioRef.current;
                let t;
                let pendingT = 0;
                if (audio && isFinite(audio.currentTime)) {
                  pendingT = audio.currentTime;
                }
                if (bgPendingTargetRef.current != null && mvReady) {
                  t = bgPendingTargetRef.current;
                  bgPendingTargetRef.current = null;
                } else {
                  t = 0;
                  if (audio && isFinite(audio.currentTime)) {
                    t = ((pendingT % bg.duration) + bg.duration) % bg.duration;
                  }
                  bgPendingTargetRef.current = pendingT;
                }
                bgEngine.anchor({ play: false, target: t });
              }
            }}
           onCanPlay={() => { 
             const bg = bgVideoRef.current;
             if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'canplay', bg);
             bgEngine.onCanPlay?.(); 
           }}
           onWaiting={() => { 
             const bg = bgVideoRef.current;
             if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'waiting', bg);
             syncLog('waiting', 'bg', {}); 
             bgEngine.onWaiting(); 
           }}
           onStalled={() => { 
             const bg = bgVideoRef.current;
             if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'stalled', bg);
             syncLog('stalled', 'bg', {}); 
             bgEngine.onStalled(); 
           }}
           onPlaying={() => { 
             const bg = bgVideoRef.current;
             if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'playing', bg);
             syncLog('playing', 'bg', {}); 
             bgEngine.onPlaying(); 
           }}
            onSeeked={() => {
              const bg = bgVideoRef.current;
              if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'seeked', bg);
              const pendingForce = bgPendingForceSeekRef.current;
              syncLog('bg_seeked', 'bg', {
                currentTime: bg?.currentTime ?? null,
                seekInProgressWas: bgSeekInProgressRef.current,
                pendingForceSeek: pendingForce,
              });

              bgSeekInProgressRef.current = false;
              bgSeekStartedAtRef.current = 0;
              bgPendingForceSeekRef.current = null;

              bgEngine.onSeeked();
            }}
            onEnded={() => {
              const bg = bgVideoRef.current;
              if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'ended', bg);
              if (!usePlaybackStore.getState().isPlaying) return;
              const audioTarget = audioRef.current?.currentTime + (videoOffsetRef.current || 0);
              try { bgEngine.anchor({ play: true, target: audioTarget }); } catch (_) {}
            }}
            onPlay={() => {
              const bg = bgVideoRef.current;
              if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'play', bg);
            }}
            onError={() => {
              const bg = bgVideoRef.current;
              if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'error', bg);
              bgVideoLoadFailedRef.current = true;
              // BG stream error — start polling for cache so we can retry
              // the moment the download completes, without a page reload.
              if (!bgVideoProgressTimerRef.current && youtubeId) {
                bgVideoProgressTimerRef.current = setInterval(async () => {
                  try {
                    const r = await fetch(`/api/video-cache/progress/${youtubeId}`);
                    if (!r.ok) return;
                    const data = await r.json();
                    if (data.status === 'cached' && bgVideoRef.current) {
                      clearInterval(bgVideoProgressTimerRef.current);
                      bgVideoProgressTimerRef.current = null;
                      bgVideoLoadFailedRef.current = false;
                      // Force reload the bg video now that the cached file exists.
                      bgVideoRef.current.load();
                    }
                  } catch {}
                }, 1000);
              }
            }}
        />
      )}
       {/* Translucent blur scrim over the background (playlist behind, or the
           blurred MV video). Renders in BOTH cover and MV modes so the background
           reads consistently dimmed + blurred. */}
        <>
          <div
            className="absolute inset-0"
            style={{ zIndex: 0, background: 'rgba(12,12,16,0.4)', backdropFilter: 'blur(16px) saturate(1.2)', WebkitBackdropFilter: 'blur(16px) saturate(1.2)' }}
          />
        </>
      <div className="relative flex flex-col flex-1 min-h-0" style={{ zIndex: 1 }}>
       <div className="relative flex-none flex flex-col px-4 py-3" style={{ background: 'rgb(12,12,16)' }}>
        {headerNode}
      </div>

      {/* Media area: cover + title + controls grouped and centered as ONE unit, so
          the media controls stay close to the cover/title even when the window is tall
          (instead of being pushed to the very bottom by a greedy flex child). */}
      <div ref={mediaAreaRef} className="flex-1 min-h-0 flex flex-col items-center justify-center px-4 sm:px-8">
        <div className="flex flex-col items-center w-full">
           {mainContent}
           <div ref={controlsRef} className="w-full max-w-3xl">
             <MediaControls
               type="audio"
               mediaRef={audioRef}
               folderFiles={carouselFiles}
               currentFile={activeFile}
               onFileChange={handleCarouselSelect}
               onSeek={handleSeekSync}
               onSeekStart={handleScrubStart}
               onSeekChange={handleScrubChange}
               playlistMode={hasPlaylist}
               onNext={hasPlaylist ? handleNext : undefined}
               onPrevious={hasPlaylist ? handlePrevious : undefined}
               visualizer={<AudioVisualizer audioRef={audioRef} color="#0EA5E9" height={28} fileId={activeFile?.file_id || activeFile?.id} />}
             />
           </div>
         </div>
      </div>

      {/* Playlist / queue strip pinned to the bottom, large thumbnails, with a
          hide toggle. Uses its own collapse so it never overlaps the audio UI. */}
      {showCarousel && (
        <div className="w-full relative bg-neutral-950">
          <div className={`grid transition-all duration-300 ease-out ${manualHidden ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}>
            <div className="overflow-hidden">
               <Carousel
                 files={carouselFiles}
                 currentFile={activeFile}
                 onSelect={handleCarouselSelect}
                 sortBy={currentSortBy}
                 sortOrder={currentSortOrder}
                 cacheBust={stableCacheBust}
                 onToggleFavorite={onFavoriteToggle}
                 contextLabel={carouselContextLabel}
                 itemSize="lg"
                 hidden={manualHidden}
                 restoreScrollKey={hasPlaylist ? `playlist-${playlistTitle || 'unknown'}` : file ? `folder-${file.dir_path || 'root'}` : null}
               />
            </div>
          </div>
          <button
            onClick={toggleCarouselHidden}
            className="absolute -top-9 right-3 z-40 p-2 rounded-full bg-neutral-800/90 hover:bg-neutral-700 text-neutral-300 shadow-lg transition-opacity"
            title={manualHidden ? 'Tampilkan daftar' : 'Sembunyikan daftar'}
          >
            {manualHidden ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      )}

      <QueuePanel
        isOpen={showQueuePanel}


        onClose={() => setShowQueuePanel(false)}
        tracks={playlistFiles}
        currentTrackIndex={storeCurrentTrackIndex}
        onTrackSelect={handleQueueSelect}
        onFavoriteToggle={onFavoriteToggle}
      />
    {showMetadataEditor && activeFile?.file_id && createPortal(
      <MetadataEditor
        fileId={activeFile.file_id}
        onSaved={() => {
          fetch(`/api/metadata/${activeFile.file_id}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data) {
                setTrackMetadata(data);
                setLyricsSynced(data.lyrics_synced || data.syncedLyrics || null);
                setYoutubeId(data.youtube_id || null);
                setVideoOffset(Number(data.video_offset) || 0);
              }
            })
            .catch(() => {});
        }}
        onCoverChanged={() => setCoverVersion(v => v + 1)}
        onClose={() => {
          setShowMetadataEditor(false);
          fetch(`/api/metadata/${activeFile.file_id}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data) {
                setTrackMetadata(data);
                setLyricsSynced(data.lyrics_synced || data.syncedLyrics || null);
                setYoutubeId(data.youtube_id || null);
                setVideoOffset(Number(data.video_offset) || 0);
              }
            })
            .catch(() => {});
        }}
      />,
      document.body
    )}
    </div>
    </div>
  );
}
