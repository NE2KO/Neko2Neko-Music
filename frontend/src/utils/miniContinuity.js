/**
 * MiniContinuity — continuity sensor (invisible, always-active conceptually, but
 * only ticks when audio is playing per final approval: not ticking when paused).
 *
 * Philosophy: progression (audio.currentTime) is truth utama. Wall time hanya
 * anomaly signal, bukan sumber listened time. 0.5s sebagai tolerance, bukan hard threshold.
 *
 * State: { trackId, lastPosition, lastWallTime, wasPlaying, invalidated }
 * Events: PLAY -> baseline, PAUSE -> invalidate, SEEK -> invalidate+new baseline, RELOAD -> restore+compare, RESUME -> baseline
 *
 * Returns { valid, progression, reason } — ListeningTracker yang memutuskan sessionListened += progression
 */

const STORAGE_KEY = 'miniContinuity';
const TOLERANCE_S = 0.5;

function nowWall() {
  return Date.now();
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function persist(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export class MiniContinuity {
  constructor() {
    this.trackId = null;
    this.lastPosition = null;
    this.lastWallTime = null;
    this.wasPlaying = false;
    this.invalidated = false;
    this._restored = null;
  }

  _save() {
    if (this.trackId == null || this.lastPosition == null) return;
    persist({
      trackId: this.trackId,
      lastPosition: this.lastPosition,
      lastWallTime: this.lastWallTime,
      wasPlaying: this.wasPlaying,
      invalidated: this.invalidated,
    });
  }

  restore() {
    const saved = loadPersisted();
    if (saved && saved.trackId) {
      this._restored = { ...saved };
    }
    return this._restored;
  }

  establishBaseline(trackId, position, wallTime = nowWall(), wasPlaying = true) {
    this.trackId = trackId;
    this.lastPosition = position;
    this.lastWallTime = wallTime;
    this.wasPlaying = wasPlaying;
    this.invalidated = false;
    this._save();
  }

  invalidate(reason = 'seek_pause') {
    this.invalidated = true;
    // Keep lastPosition/lastWallTime for next baseline comparison, but mark invalid so next tick is skipped
    this._save();
  }

  commitPause(position, wallTime = nowWall()) {
    // PAUSE -> commit last state + invalidate interval
    if (position != null) this.lastPosition = position;
    this.lastWallTime = wallTime;
    this.wasPlaying = false;
    this.invalidated = true;
    this._save();
  }

  resume(trackId, position, wallTime = nowWall()) {
    this.establishBaseline(trackId, position, wallTime, true);
  }

  /**
   * Check continuity for current progression.
   * @param {number} currentPosition - audio.currentTime
   * @param {number} wallDelta - (nowWall - lastWallTime)/1000
   * @param {boolean} buffering - true if audio stalled/waiting
   * @param {number} playbackRate - audio.playbackRate
   * @returns {{valid:boolean, progression:number, reason:string}}
   */
  check(currentPosition, wallDelta, buffering = false, playbackRate = 1) {
    if (this.invalidated) {
      return { valid: false, progression: 0, reason: 'invalidated' };
    }
    if (!this.wasPlaying) {
      return { valid: false, progression: 0, reason: 'paused' };
    }
    if (this.lastPosition == null || currentPosition == null) {
      return { valid: false, progression: 0, reason: 'no_baseline' };
    }
    const progression = currentPosition - this.lastPosition;
    // Guard absurd progression (seek jump, negative, huge)
    if (!isFinite(progression)) {
      return { valid: false, progression: 0, reason: 'non_finite' };
    }
    if (buffering) {
      return { valid: false, progression: 0, reason: 'buffering' };
    }
    // Reload anomaly: wall advanced but progression didn't (heuristic, but not sole determinant)
    // progression is truth, wall only anomaly signal
    const expected = wallDelta * (playbackRate || 1);
    const difference = Math.abs(wallDelta - progression);
    // If wallDelta is very large but progression tiny, it's reload gap
    if (wallDelta > 2 && progression < 0.5 && difference > 1.5) {
      return { valid: false, progression: 0, reason: 'reload_gap' };
    }
    // Tolerance 0.5s for throttling/timeupdate jitter, but not hard threshold on progression itself
    // e.g. wall 1.8 progression 1.2 diff 0.6 -> still valid if progression itself is plausible (>0)
    if (difference > TOLERANCE_S + 0.1 && wallDelta > 1.5 && progression < wallDelta * 0.5) {
      return { valid: false, progression: 0, reason: 'anomaly' };
    }
    // Negative progression (except tiny) is seek backwards
    if (progression < -0.1) {
      return { valid: false, progression: 0, reason: 'negative_progression' };
    }
    // Tiny progression (<0.05) is just jitter, not invalid, but no listen to add
    if (progression < 0.01) {
      return { valid: true, progression: 0, reason: 'tiny' };
    }
    return { valid: true, progression, reason: 'ok' };
  }

  advance(currentPosition, wallTime = nowWall(), wasPlaying = true) {
    this.lastPosition = currentPosition;
    this.lastWallTime = wallTime;
    this.wasPlaying = wasPlaying;
    this.invalidated = false;
    this._save();
  }

  clear() {
    this.trackId = null;
    this.lastPosition = null;
    this.lastWallTime = null;
    this.wasPlaying = false;
    this.invalidated = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
}

export const miniContinuity = new MiniContinuity();
