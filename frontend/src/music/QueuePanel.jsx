import React, { memo, useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { Music, X, Search, Heart } from 'lucide-react';
import usePlaybackStore from '../store/playbackStore';
import { useIsFavorite } from '../store/favoritesStore';

const API_BASE = import.meta.env.VITE_API_URL || '';

const COLORS = {
  bg: { primary: '#0a0a0a', secondary: '#171717' },
  border: { primary: '#262626', secondary: '#404040' },
  text: { primary: '#e5e5e5', secondary: '#a3a3a3', tertiary: '#737373' },
  accent: '#0ea5e9',
};

// Per-extension pill colors (mirrors PlaylistListRow's TYPE_COLORS)
const FMT_BG = {
  '.flac': 'rgba(250,204,21,0.18)',
  '.mp3': 'rgba(168,139,250,0.18)',
  '.m4a': 'rgba(244,114,182,0.18)',
  '.opus': 'rgba(203,213,225,0.18)',
  '.aac': 'rgba(74,222,128,0.18)',
  '.wav': 'rgba(34,211,238,0.18)',
};
const FMT_FG = {
  '.flac': '#facc15',
  '.mp3': '#c4b5fd',
  '.m4a': '#f9a8d4',
  '.opus': '#cbd5e1',
  '.aac': '#86efac',
  '.wav': '#67e8f9',
};

const ITEM_HEIGHT = 64;
const BUFFER = 8;

// Animated equalizer bars for the active (playing) track — matches PlaylistView's
// `.track-eq-bar` / `eqPulse` look.
const EQ_STYLE = `
  .queue-eq-bar {
    width: 3px; border-radius: 2px; background: #8C98ED; height: 16px;
    transform: scaleY(0.35); transform-origin: bottom;
  }
  .queue-eq-active .queue-eq-bar {
    animation: queueEqPulse 0.9s ease-in-out infinite;
  }
  .queue-eq-active .queue-eq-bar:nth-child(2) { animation-delay: 0.15s; }
  .queue-eq-active .queue-eq-bar:nth-child(3) { animation-delay: 0.3s; }
  .queue-eq-paused .queue-eq-bar { animation: none; }
  @keyframes queueEqPulse {
    0%, 100% { transform: scaleY(0.3); }
    50% { transform: scaleY(1); }
  }
`;
let eqStyleInjected = false;
function injectQueueStyles() {
  if (eqStyleInjected) return;
  eqStyleInjected = true;
  const s = document.createElement('style');
  s.textContent = EQ_STYLE;
  document.head.appendChild(s);
}
injectQueueStyles();

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const QueueItem = memo(({ track, index, isActive, onSelect, onToggleFavorite, isToggling, slideDir = 'left' }) => {
  const [imgError, setImgError] = useState(false);
  const fileId = track.file_id || track._file_id;
  const showImg = !!fileId && !imgError;
  const isFav = useIsFavorite(fileId || track.id, track.is_favorite ? 1 : 0);
  const isPlaying = usePlaybackStore(s => s.isPlaying);
  const eqActive = isActive && isPlaying;
  const eqPaused = isActive && !isPlaying;
  const dirRef = useRef(slideDir);
  if (dirRef.current !== slideDir) dirRef.current = slideDir;
  const entrySide = dirRef.current === 'left' ? -1 : 1;

  // Phase machine drives the slide-in / slide-out of the active marker so the
  // bar visibly slides from the edge instead of just fading in place.
  const [phase, setPhase] = useState(isActive ? 'active' : 'idle');
  const rafRef = useRef(0);
  const timeoutRef = useRef(0);
  useEffect(() => {
    if (isActive) {
      if (phase === 'active' || phase === 'enter') return;
      setPhase('enter');
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => setPhase('active'));
      });
    } else {
      if (phase === 'idle' || phase === 'exit') return;
      setPhase('exit');
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setPhase('idle'), 340);
    }
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(timeoutRef.current);
    };
  }, [isActive, phase]);

  const COVER_SIZE = 36;
  const COVER_GAP = 10;
  const COVER_SHIFT = 48;
  const BAR_LEFT = 32;
  const INDICATOR_W = 16;
  const BAR_TRAVEL = 24;
  const CLIP_GAP = 8;

  const isEnter = phase === 'enter';
  const isShown = phase === 'active';
  const pkgX = isShown ? COVER_SHIFT : 0;
  const barX = isShown ? 0 : (isEnter ? entrySide * BAR_TRAVEL : -entrySide * BAR_TRAVEL);
  const barOpacity = isShown ? 1 : 0;
  const gradScale = isShown ? 1 : 0;
  const gradOrigin = entrySide < 0 ? 'left' : 'right';
  const animating = phase !== 'idle';

  const ext = (track.ext || '').toLowerCase();
  const extLabel = ext ? ext.replace('.', '').toUpperCase() : '';
  const fmtBg = FMT_BG[ext] || 'rgba(148,163,184,0.18)';
  const fmtFg = FMT_FG[ext] || '#cbd5e1';
  const hasMv = !!track.youtube_id;

  return (
    <div
      onClick={() => onSelect?.(index)}
      style={{
        position: 'relative',
        overflow: 'hidden',
        padding: '8px 12px',
        cursor: 'pointer',
        borderRadius: '8px',
        backgroundColor: 'transparent',
        transition: 'background-color 0.15s ease',
        height: ITEM_HEIGHT,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = `${COLORS.border.primary}40`;
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0, borderRadius: '8px', pointerEvents: 'none', zIndex: 0,
          background: 'linear-gradient(to top right, rgba(118,178,231,0.22), rgba(140,152,237,0.22))',
          transform: `scaleX(${gradScale})`,
          transformOrigin: gradOrigin,
          transition: 'transform 340ms ease',
          willChange: animating ? 'transform' : 'auto',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute', left: BAR_LEFT, top: 0, bottom: 0, width: INDICATOR_W, zIndex: 2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: barOpacity, transform: `translateX(${barX}px)`,
          transition: 'transform 300ms cubic-bezier(.2,.8,.2,1), opacity 300ms ease',
          willChange: animating ? 'transform, opacity' : 'auto',
        }}
      >
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: '#8C98ED', borderRadius: '0 2px 2px 0' }} />
         {isActive && (
           <span className={eqActive ? 'queue-eq-active' : eqPaused ? 'queue-eq-paused' : ''} style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 16 }}>
             <span className="queue-eq-bar" />
             <span className="queue-eq-bar" />
             <span className="queue-eq-bar" />
           </span>
         )}
      </div>
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: `${CLIP_GAP}px`, width: '100%' }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: `${COVER_GAP}px`, width: '100%',
            transform: `translateX(${pkgX}px)`,
            transition: 'transform 280ms cubic-bezier(.2,.8,.2,1)',
            willChange: animating ? 'transform' : 'auto',
          }}>
            <div
              style={{
                width: COVER_SIZE, height: COVER_SIZE, borderRadius: '6px',
                overflow: 'hidden', flexShrink: 0, background: '#262626',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {showImg ? (
                <img
                  src={`${API_BASE}/thumbnails/list/${fileId}.jpg`}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={() => setImgError(true)}
                />
              ) : (
                <Music style={{ width: 16, height: 16, color: '#737373' }} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                margin: 0, fontSize: '13px', fontWeight: isActive ? 600 : 400,
                color: isActive ? '#8892E6' : COLORS.text.primary,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {track.display_name || track.title || 'Unknown'}
              </p>
              {track.artist && (
                <p style={{
                  margin: '2px 0 0', fontSize: '10px', color: COLORS.text.tertiary,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {track.artist}
                </p>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {hasMv && (
            <span style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px', padding: '1px 6px',
              borderRadius: '4px', background: 'rgba(129,140,248,0.2)', color: '#a5b4fc', flexShrink: 0,
            }}>
              MV
            </span>
          )}
          {extLabel && (
            <span style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px', padding: '1px 6px',
              borderRadius: '4px', background: fmtBg, color: fmtFg, flexShrink: 0,
            }}>
              {extLabel}
            </span>
          )}
          {track.duration > 0 && (
            <span style={{ fontSize: '10px', color: COLORS.text.tertiary, flexShrink: 0 }}>
              {formatDuration(track.duration)}
            </span>
          )}
        </div>
        {onToggleFavorite && (
          <span
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); if (!isToggling) onToggleFavorite(track); }}
            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, flexShrink: 0, cursor: 'pointer', opacity: isToggling ? 0.5 : 1 }}
          >
            <Heart size={14} style={{ color: isFav ? '#ef4444' : COLORS.text.tertiary, fill: isFav ? '#ef4444' : 'none' }} />
          </span>
        )}
      </div>
    </div>
  );
});
QueueItem.displayName = 'QueueItem';

const QueueList = memo(({ isOpen, tracks, filteredTracks, indexMap, currentTrackIndex, slideDir, togglingIds, onSelect, onToggleFav }) => {
  const listRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const rafRef = useRef(0);

  const totalHeight = filteredTracks.length * ITEM_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
  const endIndex = Math.min(filteredTracks.length, Math.ceil((scrollTop + 800) / ITEM_HEIGHT) + BUFFER);
  const visibleTracks = filteredTracks.slice(startIndex, endIndex);

  const handleScroll = useCallback((e) => {
    const st = e.currentTarget.scrollTop;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setScrollTop(st);
    });
  }, []);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  useEffect(() => {
    if (!isOpen && listRef.current) {
      listRef.current.scrollTop = 0;
      setScrollTop(0);
    }
  }, [isOpen]);

  // Auto-scroll to the currently playing track when the panel opens or the
  // active track changes. The list is virtualized by `scrollTop`, so setting
  // `scrollTop` fires onScroll → setScrollTop → the active row enters the
  // rendered window (no imperative scrollIntoView needed).
  useEffect(() => {
    if (!isOpen) return;
    const el = listRef.current;
    if (!el || !tracks || tracks.length === 0) return;
    const active = tracks[currentTrackIndex];
    if (!active) return;
    const activeId = active.file_id || active.id;
    const idx = filteredTracks.findIndex((t) => (t.file_id || t.id) === activeId);
    if (idx < 0) return; // active track hidden by search filter
    const target = Math.max(0, Math.min(
      idx * ITEM_HEIGHT - el.clientHeight / 2 + ITEM_HEIGHT / 2,
      el.scrollHeight - el.clientHeight,
    ));
    el.scrollTop = target;
    setScrollTop(target);
  }, [isOpen, currentTrackIndex, filteredTracks, tracks]);

  if (!tracks || tracks.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: COLORS.text.secondary }}>
        <Music size={32} style={{ marginBottom: '8px', opacity: 0.3 }} />
        <p style={{ margin: 0, fontSize: '12px' }}>No tracks in queue</p>
      </div>
    );
  }

  if (filteredTracks.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: COLORS.text.secondary }}>
        <Music size={32} style={{ marginBottom: '8px', opacity: 0.3 }} />
        <p style={{ margin: 0, fontSize: '12px' }}>No matches</p>
      </div>
    );
  }

  return (
    <div ref={listRef} onScroll={handleScroll} style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleTracks.map((track, vi) => {
          const realIndex = startIndex + vi;
          const key = track.file_id || track.id || realIndex;
          const origIndex = indexMap.get(key);
          return (
            <div key={key} style={{ position: 'absolute', top: realIndex * ITEM_HEIGHT, left: 0, right: 0 }}>
              <QueueItem
                track={track}
                index={origIndex}
                isActive={origIndex === currentTrackIndex}
                onSelect={onSelect}
                onToggleFavorite={onToggleFav}
                isToggling={togglingIds.has(track.file_id || track.id || realIndex)}
                slideDir={slideDir}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});
QueueList.displayName = 'QueueList';

export default function QueuePanel({ isOpen, onClose, tracks, currentTrackIndex, onTrackSelect, onFavoriteToggle }) {
  const { setCurrentTrackIndex, play } = usePlaybackStore();
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const [togglingIds, setTogglingIds] = useState(new Set());
  const [slideDir, setSlideDir] = useState('left');
  const prevIndexRef = useRef(currentTrackIndex);
  useEffect(() => {
    if (prevIndexRef.current !== currentTrackIndex) {
      setSlideDir(currentTrackIndex > prevIndexRef.current ? 'left' : 'right');
      prevIndexRef.current = currentTrackIndex;
    }
  }, [currentTrackIndex]);

  const handleToggleFav = useCallback((track) => {
    const fileId = track.file_id || track._file_id || track.id;
    if (togglingIds.has(fileId)) return;
    setTogglingIds(prev => new Set(prev).add(fileId));
    onFavoriteToggle?.(track).finally(() => {
      setTogglingIds(prev => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    });
  }, [togglingIds, onFavoriteToggle]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
    if (!isOpen) setQuery('');
  }, [isOpen]);

  const filteredTracks = useMemo(() => {
    if (!tracks || !query.trim()) return tracks || [];
    const q = query.toLowerCase();
    return tracks.filter((t) => {
      const name = (t.display_name || t.title || '').toLowerCase();
      const artist = (t.artist || '').toLowerCase();
      return name.includes(q) || artist.includes(q);
    });
  }, [tracks, query]);

  const indexMap = useMemo(() => {
    const map = new Map();
    if (tracks) {
      for (let i = 0; i < tracks.length; i++) {
        const key = tracks[i].file_id || tracks[i].id || i;
        map.set(key, i);
      }
    }
    return map;
  }, [tracks]);

  const handleSelect = (index) => {
    if (onTrackSelect) {
      onTrackSelect(index);
    } else {
      setCurrentTrackIndex(index);
      play();
    }
  };

  if (!isOpen) return null;

  return (
    <div data-debug-id="5.2.5" data-debug-name="QueuePanel" data-debug-type="drawer" style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: 440, maxWidth: '92vw', height: '100%',
        background: COLORS.bg.primary, borderLeft: `1px solid ${COLORS.border.primary}`,
        display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px', borderBottom: `1px solid ${COLORS.border.primary}`,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: COLORS.text.primary }}>
              Now Playing
            </h3>
            <button
              onClick={onClose}
              style={{
                padding: '6px', borderRadius: '6px', border: 'none',
                background: 'transparent', color: COLORS.text.secondary,
                cursor: 'pointer', display: 'flex', alignItems: 'center',
              }}
            >
              <X size={18} />
            </button>
          </div>
          {/* Search bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 10px', borderRadius: '8px',
            background: COLORS.bg.secondary, border: `1px solid ${COLORS.border.primary}`,
          }}>
            <Search size={14} color={COLORS.text.tertiary} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tracks..."
              style={{
                flex: 1, border: 'none', background: 'transparent', outline: 'none',
                color: COLORS.text.primary, fontSize: '12px',
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                style={{
                  padding: '2px', borderRadius: '4px', border: 'none',
                  background: 'transparent', color: COLORS.text.tertiary,
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Track list — virtualized, isolated to keep scrolling cheap */}
        <QueueList
          isOpen={isOpen}
          tracks={tracks}
          filteredTracks={filteredTracks}
          indexMap={indexMap}
          currentTrackIndex={currentTrackIndex}
          slideDir={slideDir}
          togglingIds={togglingIds}
          onSelect={handleSelect}
          onToggleFav={handleToggleFav}
        />

        {/* Footer */}
        {tracks && tracks.length > 0 && (
          <div style={{
            padding: '12px 16px', borderTop: `1px solid ${COLORS.border.primary}`,
            fontSize: '10px', color: COLORS.text.tertiary, flexShrink: 0,
          }}>
            Track {currentTrackIndex + 1} of {tracks.length}
          </div>
        )}
      </div>
    </div>
  );
}
