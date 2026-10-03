const CONFIG = {
  AUTO_RESUME_MS: 3000,
  PROGRAMMATIC_SCROLL_WINDOW_MS: 100,
  SMOOTH_SCROLL_FACTOR: 0.18,
  SMOOTH_SCROLL_FACTOR_INITIAL: 0.5,
  SMALL_DELTA_PX: 0.15,
  OPACITY_RINGS: 4,
  TIME_POLL_INTERVAL_MS: 50,
  MAX_ANIMATION_FRAMES: 120,
  INACTIVE_LINE_HEIGHT: 23,
};

function createEmptyMetrics() {
  return {
    correctionCount: 0,
    totalCorrection: 0,
    maxCorrection: 0,
    minCorrection: Infinity,
    smoothCount: 0,
    userScrollCount: 0,
    resumeCount: 0,
    nullElement: 0,
    emptyLyrics: 0,
    invalidIndex: 0,
    domMeasureTime: 0,
    domMeasureCount: 0,
    totalAnimationFrames: 0,
    longestAnimation: 0,
    shortestAnimation: Infinity,
    animationCount: 0,
  };
}

export default class LyricsScrollController {
  constructor(container, getActiveElement, opts = {}) {
    this.container = container;
    this.getActiveElement = getActiveElement;
    this.onProgrammaticScroll = opts.onProgrammaticScroll || (() => {});

    this.isAnimating = false;
    this.isUserScrolling = false;
    this.lastInteractionTime = 0;
    this.lastProgrammaticTime = 0;
    this.animationFrameCount = 0;
    this.rafId = null;
    this.metrics = createEmptyMetrics();
  }

  measure() {
    const el = this.getActiveElement();
    const container = this.container;
    if (!el || !container) return null;

    const t0 = performance.now();
    const activeRect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const t1 = performance.now();

    this.metrics.domMeasureTime += (t1 - t0);
    this.metrics.domMeasureCount++;

    const currentCenter = activeRect.top + activeRect.height / 2;
    const desiredCenter = containerRect.top + containerRect.height / 2;
    const delta = currentCenter - desiredCenter;

    return {
      delta,
      activeRect,
      containerRect,
      activeHeight: activeRect.height,
      containerHeight: containerRect.height,
      currentCenter,
      desiredCenter,
    };
  }

  programmaticScrollTo(value) {
    this.container.scrollTop = Math.max(0, value);
    this.lastProgrammaticTime = performance.now();
    this.onProgrammaticScroll();
  }

  startAnimation() {
    if (this.isAnimating || this.isUserScrolling) return;
    this.isAnimating = true;
    this.animationFrameCount = 0;
    this.rafId = requestAnimationFrame(this._animationFrame);
  }

  _animationFrame = () => {
    if (!this.isAnimating || this.isUserScrolling) {
      this._finishAnimation();
      return;
    }

    this.animationFrameCount++;

    if (this.animationFrameCount > CONFIG.MAX_ANIMATION_FRAMES) {
      this._finishAnimation();
      return;
    }

    const m = this.measure();
    if (!m) {
      this.metrics.nullElement++;
      this._finishAnimation();
      return;
    }

    const absDelta = Math.abs(m.delta);

    if (absDelta < CONFIG.SMALL_DELTA_PX) {
      this._finishAnimation();
      return;
    }

    this.metrics.correctionCount++;
    this.metrics.totalCorrection += absDelta;
    if (absDelta > this.metrics.maxCorrection) this.metrics.maxCorrection = absDelta;
    if (absDelta < this.metrics.minCorrection) this.metrics.minCorrection = absDelta;

    const gain = this.animationFrameCount === 1
      ? CONFIG.SMOOTH_SCROLL_FACTOR_INITIAL
      : CONFIG.SMOOTH_SCROLL_FACTOR;

    this.programmaticScrollTo(this.container.scrollTop + m.delta * gain);
    this.metrics.smoothCount++;
    this.rafId = requestAnimationFrame(this._animationFrame);
  };

  _recordAnimation() {
    this.metrics.animationCount++;
    this.metrics.totalAnimationFrames += this.animationFrameCount;
    if (this.animationFrameCount > this.metrics.longestAnimation) {
      this.metrics.longestAnimation = this.animationFrameCount;
    }
    if (this.animationFrameCount < this.metrics.shortestAnimation) {
      this.metrics.shortestAnimation = this.animationFrameCount;
    }
  }

  _finishAnimation() {
    this._recordAnimation();
    this.isAnimating = false;
    this.rafId = null;
  }

  stopAnimation() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.isAnimating) {
      this._recordAnimation();
    }
    this.isAnimating = false;
    this.rafId = null;
  }

  onUserInteraction() {
    this.isUserScrolling = true;
    this.lastInteractionTime = performance.now();
    this.metrics.userScrollCount++;
    this.stopAnimation();
  }

  onProgrammaticScrollDetected() {
    if (performance.now() - this.lastProgrammaticTime < CONFIG.PROGRAMMATIC_SCROLL_WINDOW_MS) {
      return true;
    }
    return false;
  }

  checkAutoResume() {
    if (!this.isUserScrolling) return false;
    const elapsed = performance.now() - this.lastInteractionTime;
    if (elapsed > CONFIG.AUTO_RESUME_MS) {
      this.isUserScrolling = false;
      this.metrics.resumeCount++;
      return true;
    }
    return false;
  }

  getDebugData(audioTime, clockTime, lineIndex, lineCount) {
    const m = this.measure();
    return {
      lineIndex,
      lineCount,
      audioTime,
      clockTime,
      timeDiff: audioTime - clockTime,
      delta: m?.delta ?? null,
      scrollTop: this.container.scrollTop,
      activeHeight: m?.activeHeight ?? null,
      containerHeight: m?.containerHeight ?? null,
      isUserScrolling: this.isUserScrolling,
      isAnimating: this.isAnimating,
      animationFrameCount: this.animationFrameCount,
      metrics: { ...this.metrics },
    };
  }

  destroy() {
    this.stopAnimation();
  }
}

export { CONFIG, createEmptyMetrics };
