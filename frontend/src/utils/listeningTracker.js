/**
 * ListeningTracker — accurate per-track listening statistics.
 *
 * Tracks actual playback time using a monotonic clock, excluding pause/seek/
 * buffering intervals. Persists to backend API incrementally.
 *
 * Play count semantics:
 *   - A "play session" starts when audio begins playing after a pause or on
 *     a fresh track load.
 *   - A valid play is counted once a session accumulates >= threshold
 *     of actual listening time.
 *   - Pause/resume within the same track continues the same session and does
 *     NOT increment play count again.
 *   - Track change finalizes the previous session and starts a new one.
 *   - Seek does NOT create a new session; the pre-seek interval is finalized
 *     and a new interval starts after the seek completes.
 *   - Play count is only incremented when sessionAccumulated reaches the
 *     threshold during playback, guarded by sessionPlayCounted to prevent
 *     double counting.
 */

import { MiniContinuity } from './miniContinuity.js';

const MIN_PLAY_SECONDS = 30;
const PERSIST_DEBOUNCE_MS = 2000;
const STORAGE_KEY = 'musicListeningStats';
const DB_INTERVAL_MS = 5000;

function getStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function setStorage(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h} jam ${String(m).padStart(2, '0')} menit ${String(sec).padStart(2, '0')} detik`;
  }
  if (m > 0) {
    return `${m} menit ${String(sec).padStart(2, '0')} detik`;
  }
  return `${sec} detik`;
}

export function computePlayThreshold(duration) {
  if (!duration || !isFinite(duration) || duration <= 0) return MIN_PLAY_SECONDS;
  if (duration < 60) return Math.max(1, Math.floor(Math.min(MIN_PLAY_SECONDS, duration * 0.5)));
  return MIN_PLAY_SECONDS;
}

export class ListeningTracker {
  constructor() {
    this.stats = getStorage();
    this.persistTimer = null;
    this.currentTrackId = null;
    this.sessionStart = null;
    this.sessionListened = 0;
    this.sessionAccumulated = 0;
    this.sessionPlayCounted = false;
    this.sessionThreshold = MIN_PLAY_SECONDS;
    this.lastAudioTime = null;
    this.lastTick = null;
    this.rafId = null;
    this._currentSessionId = null;
    this._attachCount = 0;
    this._migrationAttempted = false;
    this._prevTrackId = null;
    this._sessionPersisted = false;
    this._paused = false;
    this._boundTick = this._tick.bind(this);
    this._onPlay = this._onPlay.bind(this);
    this._onPause = this._onPause.bind(this);
    this._onSeeked = this._onSeeked.bind(this);
    this._onEnded = this._onEnded.bind(this);
    this._onTimeUpdate = this._onTimeUpdate.bind(this);
    this._onLoadedMetadata = this._onLoadedMetadata.bind(this);
    // MiniContinuity sensor: progression truth, wall only anomaly signal, 0.5s tolerance, not ticking when paused
    this.mini = new MiniContinuity();
    this.dbIntervalId = null;
    this.lastWallTime = null;
  }

  getActiveSessionSeconds() {
    return Math.max(0, this.sessionListened || 0);
  }

  getCurrentTrackId() {
    return this.currentTrackId || null;
  }

  getTrackStats(trackId) {
    if (!trackId) return null;
    if (!this.stats[trackId]) {
      this.stats[trackId] = {
        playCount: 0,
        listenedSeconds: 0,
        lastPlayedAt: null,
        updatedAt: null,
        displayName: null,
        sessionAccumulated: 0,
        sessionPlayCounted: false,
        lastSyncedSeconds: 0,
        lastSyncedPlayCount: 0,
      };
    }
    // Ensure new fields exist for older entries
    if (this.stats[trackId].lastSyncedSeconds == null) this.stats[trackId].lastSyncedSeconds = 0;
    if (this.stats[trackId].lastSyncedPlayCount == null) this.stats[trackId].lastSyncedPlayCount = 0;
    return this.stats[trackId];
  }

  getGlobalStats() {
    const tracks = Object.values(this.stats);
    const totalPlayCount = tracks.reduce((s, t) => s + (t.playCount || 0), 0);
    const totalListenedSeconds = tracks.reduce((s, t) => s + (t.listenedSeconds || 0), 0);
    const uniqueTracks = tracks.length;
    return { totalPlayCount, totalListenedSeconds, uniqueTracks };
  }

  getLeaderboard(metric = 'plays', limit = 10) {
    const entries = Object.entries(this.stats)
      .filter(([, s]) => (s.playCount > 0 || s.listenedSeconds > 0))
      .map(([trackId, s]) => ({
        trackId,
        displayName: s.displayName,
        playCount: s.playCount || 0,
        listenedSeconds: s.listenedSeconds || 0,
        lastPlayedAt: s.lastPlayedAt,
      }))
      .sort((a, b) => {
        if (metric === 'listened') {
          return (b.listenedSeconds || 0) - (a.listenedSeconds || 0);
        }
        return (b.playCount || 0) - (a.playCount || 0);
      })
      .slice(0, limit);
    return entries;
  }

  _attach() {
    if (!this._audio || !this.currentTrackId) return;
    this._audio.addEventListener('play', this._onPlay);
    this._audio.addEventListener('pause', this._onPause);
    this._audio.addEventListener('seeked', this._onSeeked);
    this._audio.addEventListener('ended', this._onEnded);
    this._audio.addEventListener('timeupdate', this._onTimeUpdate);
    this._audio.addEventListener('loadedmetadata', this._onLoadedMetadata);
    if (!this._audio.paused) {
      this._startSession();
    }
  }

  _detach() {
    if (!this._audio) return;
    this._audio.removeEventListener('play', this._onPlay);
    this._audio.removeEventListener('pause', this._onPause);
    this._audio.removeEventListener('seeked', this._onSeeked);
    this._audio.removeEventListener('ended', this._onEnded);
    this._audio.removeEventListener('timeupdate', this._onTimeUpdate);
    this._audio.removeEventListener('loadedmetadata', this._onLoadedMetadata);
  }

  _onLoadedMetadata() {
    if (!this._audio || !this.currentTrackId) return;
    this.sessionThreshold = computePlayThreshold(this._audio.duration);
  }

  attach(audio, trackId, displayName) {
    if (!audio || !trackId) return;
    const wasAttached = this._attachCount > 0;
    // Restore miniContinuity baseline if this is a reload with same track
    const restored = this.mini.restore();
    const isReloadSameTrack = restored && String(restored.trackId) === String(trackId);
    this._audio = audio;
    this.currentTrackId = trackId;
    if (displayName && (!this.stats[trackId] || !this.stats[trackId].displayName)) {
      const stats = this.getTrackStats(trackId);
      stats.displayName = displayName;
    }
    this.sessionThreshold = computePlayThreshold(audio.duration);
    const saved = this.getTrackStats(trackId);
    if (wasAttached && this.currentTrackId === trackId && this._audio === audio) {
      this.sessionPlayCounted = saved ? saved.sessionPlayCounted || false : false;
      this.sessionAccumulated = saved ? saved.sessionAccumulated || 0 : 0;
    } else if (!wasAttached && saved) {
      this.sessionPlayCounted = saved.sessionPlayCounted || false;
      this.sessionAccumulated = saved.sessionAccumulated || 0;
    } else {
      this.sessionStart = null;
      if (this._prevTrackId !== trackId) {
        this.sessionListened = 0;
      }
      this._prevTrackId = null;
      this.sessionAccumulated = 0;
      this.sessionPlayCounted = false;
    }
    this.lastAudioTime = audio.currentTime || 0;
    this.lastTick = null;
    // For reload same track, keep old wallTime for gap detection (wallDelta = now - old)
    this.lastWallTime = isReloadSameTrack && restored.lastWallTime ? restored.lastWallTime : Date.now();
    this._isReload = !!isReloadSameTrack;
    // Establish mini baseline only if not reloading same track with existing baseline, otherwise keep restored
    if (!isReloadSameTrack) {
      this.mini.establishBaseline(trackId, this.lastAudioTime, Date.now(), !audio.paused);
    } else {
      // Reload same track: keep restored lastPosition/lastWallTime for gap detection
      this.mini.trackId = trackId;
      if (!audio.paused) this.mini.wasPlaying = true;
      // Ensure this.lastAudioTime is old for progression calc? Keep new for reference, mini holds old
    }
    this._attachCount += 1;
    if (!wasAttached) {
      this._attach();
      this._startDbInterval();
      if (!this._migrationAttempted) {
        this._migrationAttempted = true;
        this.migrateLegacyStats().catch(() => {});
      }
      this.recoverUnsyncedData().catch(() => {});
    } else if (!audio.paused) {
      this._startSession();
    }
  }

  detach() {
    if (this._attachCount <= 0) return;
    this._attachCount -= 1;
    if (this._attachCount <= 0) {
      this._detach();
      this._stopTick();
      this._stopDbInterval();
      this._finalizeSession();
      this._prevTrackId = this.currentTrackId;
      this._audio = null;
      this.currentTrackId = null;
      this._attachCount = 0;
      this.lastWallTime = null;
    }
  }

  onTrackChange(newTrackId) {
    if (this.currentTrackId && this.currentTrackId !== newTrackId) {
      this._finalizeSession();
      this.mini.clear();
    }
    if (newTrackId && this._audio && !this._audio.paused) {
      this.currentTrackId = newTrackId;
      this.sessionStart = null;
      this.sessionListened = 0;
      this.sessionAccumulated = 0;
      this.sessionPlayCounted = false;
      this._sessionPersisted = false;
      this.sessionThreshold = computePlayThreshold(this._audio.duration);
      this.lastAudioTime = this._audio.currentTime || 0;
      this.lastTick = null;
      this.lastWallTime = Date.now();
      this.mini.establishBaseline(newTrackId, this.lastAudioTime, this.lastWallTime, true);
      this._startSession();
    } else if (newTrackId) {
      this.currentTrackId = newTrackId;
      this.sessionStart = null;
      this.sessionListened = 0;
      this.sessionAccumulated = 0;
      this.sessionPlayCounted = false;
      this._sessionPersisted = false;
      this.sessionThreshold = computePlayThreshold(this._audio?.duration);
      this.lastAudioTime = this._audio?.currentTime || 0;
      this.lastTick = null;
      this.lastWallTime = Date.now();
      this.mini.establishBaseline(newTrackId, this.lastAudioTime, this.lastWallTime, false);
    }
  }

  _startSession() {
    if (!this.currentTrackId || !this._audio) return;
    this.sessionStart = performance.now();
    const pos = this._audio.currentTime || 0;
    const wall = Date.now();
    // If this is a reload with existing mini baseline, don't overwrite progression truth
    const isReload = this._isReload && this.mini.trackId === this.currentTrackId && this.mini.lastPosition != null;
    this.lastAudioTime = pos;
    this.lastTick = this.sessionStart;
    this.lastWallTime = isReload ? this.mini.lastWallTime : wall;
    this._currentSessionId = this._generateSessionId();
    this._sessionPersisted = false;
    if (!isReload) {
      this.mini.establishBaseline(this.currentTrackId, pos, wall, true);
    }
    this._isReload = false;
    this._startTick();
  }

  _startDbInterval() {
    this._stopDbInterval();
    this.dbIntervalId = setInterval(() => {
      this._intervalPersist();
    }, DB_INTERVAL_MS);
  }

  _stopDbInterval() {
    if (this.dbIntervalId) {
      clearInterval(this.dbIntervalId);
      this.dbIntervalId = null;
    }
  }

  _intervalPersist() {
    if (!this.currentTrackId || this._audio?.paused) return;
    // Flush current sessionListened delta to localStorage + DB without resetting sessionAccumulated (play threshold guard stays)
    if (this.sessionListened > 0.5) {
      this._finalizeSessionInterval(true);
    }
  }

  _generateSessionId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  _startTick() {
    this._stopTick();
    if (this._audio && !this._audio.paused) {
      this.rafId = requestAnimationFrame(this._boundTick);
    }
  }

  _stopTick() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  _tick() {
    if (!this._audio || this._audio.paused || !this.currentTrackId) {
      this.rafId = null;
      return;
    }
    const now = performance.now();
    const nowWall = Date.now();
    const currentPos = this._audio.currentTime || 0;
    const wallDelta = this.lastWallTime != null ? (nowWall - this.lastWallTime) / 1000 : 0;
    const buffering = this._audio.readyState < 3 || this._audio.seeking;
    const rate = this._audio.playbackRate || 1;

    // MiniContinuity sensor: progression is truth, wall only anomaly signal, 0.5s tolerance
    const result = this.mini.check(currentPos, wallDelta, buffering, rate);
    if (result.valid) {
      const prog = result.progression;
      if (prog > 0) {
        this.sessionListened += prog;
        this.sessionAccumulated += prog;
        if (!this.sessionPlayCounted && this.sessionAccumulated >= this.sessionThreshold) {
          this.sessionPlayCounted = true;
          const stats = this.getTrackStats(this.currentTrackId);
          stats.playCount += 1;
          stats.lastPlayedAt = Date.now();
          stats.updatedAt = Date.now();
          this._schedulePersist();
        }
      }
      // Advance mini baseline only when valid (or tiny progression)
      this.mini.advance(currentPos, nowWall, true);
      this.lastAudioTime = currentPos;
    } else {
      // Invalid progression (reload_gap, buffering, seek, etc.) -> do not add
      if (result.reason === 'reload_gap' || result.reason === 'anomaly') {
        // Gap detected: establish new baseline at current position, don't count gap
        this.mini.advance(currentPos, nowWall, true);
        this.lastAudioTime = currentPos;
      } else if (result.reason === 'buffering') {
        // Buffering: advance wallTime only, keep position for next valid progression
        this.mini.lastWallTime = nowWall;
        try { localStorage.setItem('miniContinuity', JSON.stringify({ trackId: this.mini.trackId, lastPosition: this.mini.lastPosition, lastWallTime: this.mini.lastWallTime, wasPlaying: this.mini.wasPlaying, invalidated: this.mini.invalidated })); } catch {}
      } else {
        // For tiny/invalidated/paused, advance wall only
        this.mini.lastWallTime = nowWall;
        try { localStorage.setItem('miniContinuity', JSON.stringify({ trackId: this.mini.trackId, lastPosition: this.mini.lastPosition, lastWallTime: this.mini.lastWallTime, wasPlaying: this.mini.wasPlaying, invalidated: this.mini.invalidated })); } catch {}
      }
    }

    this.lastTick = now;
    this.lastWallTime = nowWall;
    if (this._audio && !this._audio.paused) {
      this.rafId = requestAnimationFrame(this._boundTick);
    } else {
      this.rafId = null;
    }
  }

  _onPlay() {
    if (!this.currentTrackId) return;
    this._paused = false;
    const pos = this._audio?.currentTime || 0;
    const wall = Date.now();
    // Resume: establish new baseline, wasPlaying=true
    this.mini.resume(this.currentTrackId, pos, wall);
    if (this.sessionStart == null) {
      this._startSession();
    } else {
      this.lastTick = performance.now();
      this.lastAudioTime = pos;
      this.lastWallTime = wall;
      this._startTick();
    }
  }

  _onPause() {
    if (!this.currentTrackId) return;
    this._paused = true;
    const pos = this._audio?.currentTime || 0;
    this.mini.commitPause(pos, Date.now());
    this._finalizeSessionInterval();
    this._stopTick();
  }

  _onSeeked() {
    if (!this.currentTrackId || !this._audio) return;
    const pos = this._audio.currentTime || 0;
    const wall = Date.now();
    this.lastAudioTime = pos;
    this.lastTick = performance.now();
    this.lastWallTime = wall;
    // Seek -> invalidate current interval, establish new baseline
    this.mini.invalidate('seek');
    this.mini.establishBaseline(this.currentTrackId, pos, wall, !this._audio.paused);
    if (!this._audio.paused) {
      this._startTick();
    }
  }

  _onEnded() {
    if (!this.currentTrackId) return;
    this.mini.invalidate('ended');
    this._finalizeSession();
    this._stopTick();
  }

  _onTimeUpdate() {
    if (!this.currentTrackId || !this._audio) return;
    if (this.sessionStart == null && !this._audio.paused) {
      this._startSession();
    }
  }

  _finalizeSessionInterval(isInterval = false) {
    if (!this.currentTrackId) return;
    const listenDelta = Math.round(this.sessionListened || 0);
    const playDelta = (!this.sessionPlayCounted && this.sessionAccumulated >= this.sessionThreshold) ? 1 : 0;
    if (listenDelta === 0 && playDelta === 0) {
      this.lastTick = null;
      if (!isInterval) this.lastWallTime = null;
      return;
    }
    const stats = this.getTrackStats(this.currentTrackId);
    stats.listenedSeconds = Math.round((stats.listenedSeconds || 0) + listenDelta);
    stats.lastPlayedAt = Date.now();
    stats.updatedAt = Date.now();
    if (playDelta > 0) {
      stats.playCount += playDelta;
      this.sessionPlayCounted = true;
    }
    stats.sessionAccumulated = this.sessionAccumulated;
    stats.sessionPlayCounted = this.sessionPlayCounted;
    this.sessionListened = 0;
    // Persist to localStorage immediately (crash recovery).
    setStorage(this.stats);
    this.lastTick = null;
    // Sync to DB. Only update lastSyncedSeconds on success so
    // recoverUnsyncedData() can re-send failed deltas on next load.
    // For interval, generate new sessionId for idempotency (same sessionId would dedup)
    const sid = isInterval ? this._generateSessionId() : this._currentSessionId;
    const displayName = stats.displayName || null;
    this.syncToBackend(sid, this.currentTrackId, playDelta, listenDelta, displayName)
      .then((ok) => {
        if (ok) {
          stats.lastSyncedSeconds = stats.listenedSeconds;
          stats.lastSyncedPlayCount = stats.playCount;
          setStorage(this.stats);
        }
      });
  }

  _finalizeSession() {
    this._finalizeSessionInterval(false);
    this.sessionStart = null;
    this.sessionAccumulated = 0;
    this.sessionPlayCounted = false;
    this._sessionPersisted = false;
    setStorage(this.stats);
  }

  syncToBackend(sessionId, trackId, playCountDelta, listenedSecondsDelta, displayName) {
    const sid = sessionId || this._currentSessionId;
    const tid = trackId || this.currentTrackId;

    if (!sid || !tid) return Promise.resolve();
    if (playCountDelta === 0 && listenedSecondsDelta === 0 && !displayName) return Promise.resolve();

    const payload = JSON.stringify({
      sessionId: sid,
      trackId: tid,
      playCountDelta,
      listenedSecondsDelta,
      displayName: displayName || this.stats[tid]?.displayName || null,
    });

    try {
      // fetch with keepalive survives page unload (same as sendBeacon) but
      // returns a promise so the caller can detect success/failure.
      return fetch('/api/listening/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).then(r => r.ok).catch(() => false);
    } catch (err) {
      console.warn('[ListeningTracker] Backend sync failed:', err.message);
      return Promise.resolve();
    }
  }

  async migrateLegacyStats() {
    try {
      const raw = localStorage.getItem('listeningStats');
      if (!raw) return { migrated: 0 };

      const legacyStats = JSON.parse(raw);
      const validEntries = Object.entries(legacyStats).filter(([trackId, data]) => {
        return data.playCount > 0 || data.listenedSeconds > 0;
      });

      if (validEntries.length === 0) {
        localStorage.removeItem('listeningStats');
        return { migrated: 0 };
      }

      const newStats = {};
      for (const [trackId, data] of validEntries) {
        newStats[trackId] = {
          playCount: data.playCount || 0,
          listenedSeconds: data.listenedSeconds || 0,
          lastPlayedAt: data.lastPlayedAt || null,
          updatedAt: data.updatedAt || null,
          displayName: data.displayName || null,
          sessionAccumulated: 0,
          sessionPlayCounted: false,
        };
      }

      setStorage(newStats);

      const response = await fetch('/api/listening/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stats: Object.fromEntries(validEntries) }),
      });

      if (!response.ok) throw new Error('Migration failed');

      localStorage.removeItem('listeningStats');
      return await response.json();
    } catch (err) {
      console.error('[ListeningTracker] Migration failed:', err);
      throw err;
    }
  }

  async recoverUnsyncedData() {
    const entries = Object.entries(this.stats);
    for (const [trackId, stats] of entries) {
      const unsyncedListen = Math.max(0, (stats.listenedSeconds || 0) - (stats.lastSyncedSeconds || 0));
      const unsyncedPlays = Math.max(0, (stats.playCount || 0) - (stats.lastSyncedPlayCount || 0));
      if (unsyncedListen === 0 && unsyncedPlays === 0) continue;
      const sid = this._generateSessionId();
      const ok = await this.syncToBackend(sid, trackId, unsyncedPlays, unsyncedListen).catch(() => false);
      if (ok) {
        stats.lastSyncedSeconds = stats.listenedSeconds;
        stats.lastSyncedPlayCount = stats.playCount;
      }
    }
    setStorage(this.stats);
  }

  _schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      setStorage(this.stats);
    }, PERSIST_DEBOUNCE_MS);
  }

  forcePersist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this._finalizeSession();
    setStorage(this.stats);
    // Best-effort final sync before page unload.  sendBeacon is more
    // reliable than fetch+keepalive for unload scenarios.
    if (this.currentTrackId) {
      const stats = this.getTrackStats(this.currentTrackId);
      const unsyncedListen = Math.max(0, (stats.listenedSeconds || 0) - (stats.lastSyncedSeconds || 0));
      const unsyncedPlays = Math.max(0, (stats.playCount || 0) - (stats.lastSyncedPlayCount || 0));
      if ((unsyncedListen > 0 || unsyncedPlays > 0) && navigator.sendBeacon) {
        const payload = JSON.stringify({
          sessionId: this._currentSessionId || this._generateSessionId(),
          trackId: this.currentTrackId,
          playCountDelta: unsyncedPlays,
          listenedSecondsDelta: unsyncedListen,
        });
        navigator.sendBeacon('/api/listening/sync', new Blob([payload], { type: 'application/json' }));
      }
    }
  }

  reset() {
    this.stats = {};
    setStorage(this.stats);
  }
}

export const listeningTracker = new ListeningTracker();
