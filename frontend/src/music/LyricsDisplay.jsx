import React, { useRef, useMemo, useEffect, useCallback, useState } from 'react';
import { parseLRC, getActiveLineIndex } from '../utils/lrcParser';
import LyricsScrollController, { CONFIG } from './LyricsScrollController';

function loadOffset() {
  try {
    const stored = localStorage.getItem('mediavault-lyrics-offset');
    return stored ? parseInt(stored, 10) : 0;
  } catch {
    return 0;
  }
}

function isDebugEnabled() {
  try {
    if (typeof URLSearchParams !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('debugLyrics') === '1') return true;
    }
    return localStorage.getItem('debugLyrics') === 'true';
  } catch {
    return false;
  }
}

function formatTime(sec) {
  if (!sec || sec < 0) return '0:00.000';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function DebugOverlay({ data }) {
  if (!data) return null;
  const {
    lineIndex, lineCount, audioTime, clockTime, timeDiff,
    delta, scrollTop, activeHeight, containerHeight,
    isUserScrolling, isAnimating, animationFrameCount,
    metrics,
  } = data;

  const absDelta = delta != null ? Math.abs(delta) : null;
  const bgColor = absDelta == null ? '#333' : absDelta < 1 ? '#1a4d1a' : absDelta < 4 ? '#4d4d1a' : '#4d1a1a';
  const avgCorrection = metrics.correctionCount > 0
    ? (metrics.totalCorrection / metrics.correctionCount).toFixed(1)
    : '—';
  const avgAnimFrames = metrics.animationCount > 0
    ? (metrics.totalAnimationFrames / metrics.animationCount).toFixed(1)
    : '—';

  return (
    <div
      style={{
        position: 'absolute', top: 4, left: 4, right: 4, zIndex: 100,
        background: bgColor, color: '#eee', fontSize: 10, fontFamily: 'monospace',
        padding: '4px 6px', borderRadius: 4, lineHeight: 1.5,
        pointerEvents: 'none', opacity: 0.92,
      }}
    >
      <div>Line: {lineIndex} / {lineCount}</div>
      <div>Audio: {formatTime(audioTime)} Clock: {formatTime(clockTime)} Diff: {(timeDiff * 1000).toFixed(1)}ms</div>
      <div>Delta: {delta != null ? delta.toFixed(2) + 'px' : '—'}</div>
      <div> scrollTop: {scrollTop?.toFixed(1)} Container: {containerHeight?.toFixed(0)} LineH: {activeHeight?.toFixed(0)}</div>
      <div> Scroll: {isUserScrolling ? 'USER' : 'AUTO'} Anim: {isAnimating ? animationFrameCount + 'f' : 'off'}</div>
      <div> Corr: avg{avgCorrection} max{metrics.maxCorrection?.toFixed(1) || '—'} min{metrics.minCorrection === Infinity ? '—' : metrics.minCorrection?.toFixed(1)}</div>
      <div> Smooth:{metrics.smoothCount} UserScroll:{metrics.userScrollCount} Resume:{metrics.resumeCount}</div>
      <div> AnimFrames: avg{avgAnimFrames} longest:{metrics.longestAnimation} shortest:{metrics.shortestAnimation === Infinity ? '—' : metrics.shortestAnimation}</div>
      <div> Null:{metrics.nullElement} Empty:{metrics.emptyLyrics} Invalid:{metrics.invalidIndex} DOMtime:{metrics.domMeasureCount > 0 ? (metrics.domMeasureTime / metrics.domMeasureCount).toFixed(3) + 'ms' : '—'}</div>
    </div>
  );
}

export default function LyricsDisplay({ lyrics, audioRef, isPlaying }) {
  const containerRef = useRef(null);
  const linesRef = useRef([]);
  const lastIndexRef = useRef(-1);
  const clockRef = useRef({ baseAudioTime: 0, basePerfTime: 0 });
  const syncOffsetRef = useRef(loadOffset());
  const topSpacerRef = useRef(null);
  const bottomSpacerRef = useRef(null);
  const controllerRef = useRef(null);
  const pollTimerRef = useRef(null);
  const [showDebug, setShowDebug] = useState(() => isDebugEnabled());
  const [debugTick, setDebugTick] = useState(0);

  const parsed = useMemo(() => {
    if (!lyrics) return [];
    const lrc = parseLRC(lyrics);
    if (lrc.length > 0) return lrc;
    return lyrics.split('\n').filter(l => l.trim()).map(l => ({
      time: -1,
      text: l.replace(/^\[[\d:.]+\]\s*/, ''),
    }));
  }, [lyrics]);

  const isSynced = parsed.length > 0 && parsed[0].time >= 0;

  const getActiveElement = useCallback(() => {
    const idx = lastIndexRef.current;
    if (idx < 0) return null;
    return linesRef.current[idx] || null;
  }, []);

  const getCurrentAudioTime = useCallback(() => {
    const audio = audioRef?.current;
    if (!audio) return 0;
    const { baseAudioTime, basePerfTime } = clockRef.current;
    const expected = audio.paused
      ? audio.currentTime
      : baseAudioTime + (performance.now() - basePerfTime) / 1000;
    return Math.max(0, expected + syncOffsetRef.current / 1000);
  }, [audioRef]);

  const resetClock = useCallback(() => {
    const audio = audioRef?.current;
    if (!audio) return;
    clockRef.current.baseAudioTime = audio.currentTime;
    clockRef.current.basePerfTime = performance.now();
  }, [audioRef]);

  const updateSpacers = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const inactiveLine = linesRef.current.find((el) => el && !el.classList.contains('lyrics-active'));
    const lineHeight = inactiveLine
      ? inactiveLine.getBoundingClientRect().height
      : CONFIG.INACTIVE_LINE_HEIGHT;
    const ideal = Math.max(48, Math.floor(container.clientHeight / 2 - lineHeight / 2));
    if (topSpacerRef.current) topSpacerRef.current.style.height = `${ideal}px`;
    if (bottomSpacerRef.current) bottomSpacerRef.current.style.height = `${ideal}px`;
  }, []);

  const updateActiveClasses = useCallback((idx) => {
    const prevIdx = lastIndexRef.current;
    if (idx === prevIdx) return;

    const prevEl = linesRef.current[prevIdx];
    const nextEl = linesRef.current[idx];

    if (prevEl) {
      prevEl.classList.remove('lyrics-active');
      prevEl.classList.add('lyrics-inactive');
    }
    if (nextEl) {
      nextEl.classList.remove('lyrics-inactive');
      nextEl.classList.add('lyrics-active');
      nextEl.style.opacity = '1';
    }

    for (let i = 0; i < parsed.length; i++) {
      if (i === idx) continue;
      const el = linesRef.current[i];
      if (!el) continue;
      el.style.opacity = '';
    }

    lastIndexRef.current = idx;
  }, [parsed.length]);

  const checkAndUpdateIndex = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;

    if (parsed.length === 0) {
      controller.metrics.emptyLyrics++;
      return;
    }

    const idx = getActiveLineIndex(parsed, getCurrentAudioTime());

    if (idx < 0) {
      controller.metrics.invalidIndex++;
      return;
    }

    const el = linesRef.current[idx];
    if (!el) {
      controller.metrics.nullElement++;
      return;
    }

    if (idx !== lastIndexRef.current) {
      updateActiveClasses(idx);
      updateSpacers();
      controller.startAnimation();
    } else if (controller.checkAutoResume()) {
      controller.startAnimation();
    }

    if (showDebug) setDebugTick(t => t + 1);
  }, [parsed, getCurrentAudioTime, updateActiveClasses, updateSpacers, showDebug]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const controller = new LyricsScrollController(container, getActiveElement, {
      onProgrammaticScroll: () => {},
    });
    controllerRef.current = controller;

    const startUserScroll = () => {
      controller.onUserInteraction();
    };

    const onScroll = () => {
      if (controller.onProgrammaticScrollDetected()) return;
      startUserScroll();
    };

    const onKeyDown = (e) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
        startUserScroll();
      }
    };

    container.addEventListener('wheel', startUserScroll, { passive: true });
    container.addEventListener('touchstart', startUserScroll, { passive: true });
    container.addEventListener('touchmove', startUserScroll, { passive: true });
    container.addEventListener('scroll', onScroll, { passive: true });
    container.addEventListener('keydown', onKeyDown);

    const handleSeeked = () => resetClock();
    const handlePlay = () => resetClock();
    const handlePause = () => resetClock();

    const audio = audioRef?.current;
    if (audio) {
      audio.addEventListener('seeked', handleSeeked);
      audio.addEventListener('play', handlePlay);
      audio.addEventListener('pause', handlePause);
    }

    resetClock();
    updateSpacers();

    // Initial index check
    const initIdx = getActiveLineIndex(parsed, getCurrentAudioTime());
    if (initIdx >= 0 && linesRef.current[initIdx]) {
      updateActiveClasses(initIdx);
      controller.startAnimation();
    }

    // Clock-based polling at 50ms
    pollTimerRef.current = setInterval(checkAndUpdateIndex, 50);

    // ResizeObserver
    const resizeObserver = new ResizeObserver(() => {
      updateSpacers();
      if (lastIndexRef.current >= 0) {
        controller.startAnimation();
      }
    });
    resizeObserver.observe(container);

    // MutationObserver for dynamic lyric changes
    const innerDiv = container.querySelector('.min-h-full');
    let mutationTimer = null;
    const mutationObserver = new MutationObserver(() => {
      if (mutationTimer) clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        updateSpacers();
        if (lastIndexRef.current >= 0) {
          controller.startAnimation();
        }
      }, 100);
    });
    if (innerDiv) {
      mutationObserver.observe(innerDiv, { childList: true, subtree: true, characterData: true });
    }

    // document.fonts.ready
    document.fonts.ready.then(() => {
      updateSpacers();
      if (lastIndexRef.current >= 0) {
        controller.startAnimation();
      }
    });

    return () => {
      container.removeEventListener('wheel', startUserScroll);
      container.removeEventListener('touchstart', startUserScroll);
      container.removeEventListener('touchmove', startUserScroll);
      container.removeEventListener('scroll', onScroll);
      container.removeEventListener('keydown', onKeyDown);
      if (audio) {
        audio.removeEventListener('seeked', handleSeeked);
        audio.removeEventListener('play', handlePlay);
        audio.removeEventListener('pause', handlePause);
      }
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (mutationTimer) clearTimeout(mutationTimer);
      controller.destroy();
    };
  }, [audioRef, parsed, isSynced, resetClock, updateSpacers, updateActiveClasses, checkAndUpdateIndex, getCurrentAudioTime, getActiveElement]);

   // Debug toggle: Ctrl+Shift+D
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setShowDebug(v => {
          const next = !v;
          try { localStorage.setItem('debugLyrics', next ? 'true' : 'false'); } catch {}
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const debugData = useMemo(() => {
    if (!showDebug || !controllerRef.current) return null;
    return controllerRef.current.getDebugData(
      getCurrentAudioTime(),
      clockRef.current.baseAudioTime + (performance.now() - clockRef.current.basePerfTime) / 1000,
      lastIndexRef.current,
      parsed.length,
    );
  }, [showDebug, parsed.length, debugTick]);

  if (!lyrics || parsed.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center z-10">
        <p className="text-white/40 text-sm italic">Tidak ada lirik</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
<style>{`
        .lyrics-inactive {
          text-align: center;
          color: rgba(255,255,255,0.35);
          font-size: 0.875rem;
          line-height: 1.8;
          white-space: pre-wrap;
          transition: color 0.3s ease, opacity 0.3s ease;
        }
        .lyrics-active {
          text-align: center;
          color: white;
          font-size: 0.875rem;
          font-weight: 700;
          line-height: 1.8;
          white-space: pre-wrap;
          transform: scale(1.29);
          transition: color 0.3s ease, opacity 0.3s ease;
        }
        .lyrics-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
        <div
          ref={containerRef}
          className="lyrics-scroll absolute inset-0 z-10 overflow-y-auto overflow-x-hidden px-6"
          style={{ scrollbarWidth: 'none' }}
        >
        <div className="min-h-full flex flex-col items-center">
          <div ref={topSpacerRef} />
          {parsed.map((line, idx) => (
            <p
              key={idx}
              ref={(el) => { linesRef.current[idx] = el; }}
              className="lyrics-inactive"
            >
              {line.text || '\u00A0'}
            </p>
          ))}
          <div ref={bottomSpacerRef} />
        </div>
      </div>
      {showDebug && <DebugOverlay data={debugData} />}
    </div>
  );
}
