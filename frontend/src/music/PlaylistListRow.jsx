import React, { memo, useState, useRef, useEffect } from 'react';
import { formatBytes as formatSize } from '../utils/format.js';

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
  bg: { primary: '#0a0a0a', secondary: '#171717' },
  border: { primary: '#262626', secondary: '#404040' },
  text: { primary: '#e5e5e5', secondary: '#e5e5e5', tertiary: '#e5e5e5' },
  accent: '#0ea5e9',
};

const EXT_COLORS = {
  flac: { bg: 'rgba(123,180,235,0.3)', fg: '#fff' },
  aac:  { bg: 'rgba(239,68,68,0.2)',   fg: '#ef4444' },
  m4a:  { bg: 'rgba(255,165,0,0.2)',   fg: '#b45309' },
  mp3:  { bg: 'rgba(168,139,250,0.2)', fg: '#7c3aed' },
  opus: { bg: 'rgba(159,197,232,0.2)', fg: '#0369a1' },
  webm: { bg: 'rgba(255,165,0,0.2)',   fg: '#b45309' },
};

const LIST_ROW_STYLE = `
  .playlist-list-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    cursor: pointer;
    transition: background 0.15s ease, opacity 0.18s ease;
  }
  .playlist-list-row:hover {
    background: ${COLORS.border.primary}40 !important;
  }
  .playlist-list-row.selected {
    background: ${COLORS.accent}15 !important;
    box-shadow: inset 0 0 0 1.5px ${COLORS.accent} !important;
  }
  .playlist-list-row.playing {
    background: linear-gradient(90deg, rgba(14,165,233,0.12), rgba(136,146,230,0.12)) !important;
    box-shadow: inset 3px 0 0 0 #8892E6 !important;
  }
  .playlist-list-row.playing .track-index {
    color: #8892E6 !important;
  }
  .playlist-list-row .track-eq-bar {
    width: 3px; border-radius: 2px; background: #8892E6; height: 6px;
    transition: height 300ms ease;
  }
  .playlist-list-row.eq-active .track-eq-bar {
    animation: eqPulse 0.9s ease-in-out infinite;
  }
  .playlist-list-row.eq-active .track-eq-bar:nth-child(2) { animation-delay: 0.15s; }
  .playlist-list-row.eq-active .track-eq-bar:nth-child(3) { animation-delay: 0.3s; }
  .playlist-list-row.eq-paused .track-eq-bar { animation: none; }
  @keyframes eqPulse {
    0%, 100% { height: 5px; }
    50% { height: 15px; }
  }
  .playlist-list-row.not-exists {
    cursor: default;
  }
  .playlist-list-row.row-enter {
    animation: playlistRowIn 0.25s ease;
  }
  @keyframes playlistRowIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .playlist-list-row .trash-btn {
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
  }
  .playlist-list-row:hover .trash-btn {
    opacity: 1;
    pointer-events: auto;
  }
  .flac-badge {
    background: linear-gradient(135deg, #74B1E4, #939CF0, #74B1E4) !important;
    background-size: 300% 300% !important;
    animation: flacSlide 3.5s linear infinite !important;
    color: #fff !important;
    text-shadow: 0 1px 2px rgba(0,0,0,0.45) !important;
    font-weight: 800 !important;
    border: 1px solid rgba(255,255,255,0.2) !important;
  }
  @keyframes flacSlide {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
`;

let styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement('style');
  s.textContent = LIST_ROW_STYLE;
  document.head.appendChild(s);
}

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const ThumbImg = memo(function ThumbImg({ fileId, colorClass, size = 48 }) {
  const src = fileId ? `${API_BASE}/thumbnails/list/${fileId}.jpg` : null;
  if (!src) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '8px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, background: colorClass,
      }}>
        <svg style={{ width: 24, height: 24 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      style={{
        width: size, height: size, borderRadius: '8px',
        objectFit: 'cover', flexShrink: 0,
      }}
      onError={(e) => {
        e.target.style.display = 'none';
        if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
      }}
    >
    </img>
  );
});

const PlaylistListRow = memo(({ index, style, data }) => {
  const { tracks, deleteMode, selectedForDelete, deletingTrackIds, leavingTrackIds, shiftAbove, enteringTrackIds, itemSize, onSelect, onRemove, playingFileId, isPlayingActive } = data;
  const track = tracks[index];
  if (!track) return null;

  const ext = track.resolved_path ? track.resolved_path.split('.').pop()?.toLowerCase() : '';
  const extLabel = ext.toUpperCase();
  const extColor = EXT_COLORS[ext] || { bg: 'rgba(100,150,200,0.2)', fg: COLORS.text.tertiary };
  const isSelected = selectedForDelete?.has(track.id);
  const isDeleting = deletingTrackIds?.has(track.id);
  const trackId = track.id ?? track.file_id;
  const isLeaving = leavingTrackIds?.has(trackId);
  const shift = shiftAbove?.get(trackId) || 0;
  const isEntering = enteringTrackIds?.has(trackId);
  const isPlaying = !!(playingFileId && track.file_id && String(track.file_id) === String(playingFileId));
  const eqActive = isPlaying && isPlayingActive;
  const eqPaused = isPlaying && !isPlayingActive;
  const hasMv = !!track.youtube_id;

  // Phase machine for the EQ slide in/out, recycle-safe: react-window reuses row
  // instances across different tracks, so reset the phase when track.file_id changes.
  const [phase, setPhase] = useState(isPlaying ? 'active' : 'idle');
  const eqRaf = useRef(0);
  const eqTimeout = useRef(0);
  const lastFid = useRef(track.file_id);
  useEffect(() => {
    if (lastFid.current !== track.file_id) {
      lastFid.current = track.file_id;
      setPhase(isPlaying ? 'active' : 'idle');
      return;
    }
    if (isPlaying) {
      if (phase === 'active' || phase === 'enter') return;
      setPhase('enter');
      cancelAnimationFrame(eqRaf.current);
      eqRaf.current = requestAnimationFrame(() => {
        eqRaf.current = requestAnimationFrame(() => setPhase('active'));
      });
    } else {
      if (phase === 'idle' || phase === 'exit') return;
      setPhase('exit');
      clearTimeout(eqTimeout.current);
      eqTimeout.current = setTimeout(() => setPhase('idle'), 320);
    }
    return () => { cancelAnimationFrame(eqRaf.current); clearTimeout(eqTimeout.current); };
  }, [track.file_id, isPlaying, phase]);

  const eqX = phase === 'enter' || phase === 'exit' ? -6 : 0;
  const eqO = phase === 'idle' || phase === 'exit' ? 0 : 1;

  const rowClass = `playlist-list-row${isSelected ? ' selected' : ''}${!track.exists ? ' not-exists' : ''}${isEntering ? ' row-enter' : ''}${isPlaying ? ' playing' : ''}${eqActive ? ' eq-active' : ''}${eqPaused ? ' eq-paused' : ''}`;

  return (
    <div
      style={{
        ...style,
        ...(isDeleting ? { opacity: 0.4, pointerEvents: 'none' } : {}),
        ...(isLeaving ? { opacity: 0 } : {}),
        ...(shift > 0 ? { transform: `translateY(${-shift * (itemSize || 64)}px)`, transition: 'transform 200ms ease' } : {}),
      }}
      className={rowClass}
      onClick={() => onSelect?.(track, index)}
    >
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        {/* EQ indicator — sits to the left of the track number, slides in from the
            left + fades in when active, slides back out to the left + fades out. */}
        <div style={{ width: 24, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
          {isPlaying && phase !== 'idle' && (
            <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 16, transform: `translateX(${eqX}px)`, opacity: eqO, transition: 'transform 300ms cubic-bezier(.2,.8,.2,1), opacity 300ms ease' }} aria-label="Now playing">
              <span className="track-eq-bar" />
              <span className="track-eq-bar" />
              <span className="track-eq-bar" />
            </span>
          )}
        </div>
        <div className="track-index" style={{
          width: 32, flexShrink: 0, textAlign: 'right',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          fontSize: '13px', fontWeight: 700, color: COLORS.text.secondary,
          fontVariantNumeric: 'tabular-nums', userSelect: 'none',
        }}>
          {index + 1}
        </div>
      </div>
      <div style={{
        width: 48, height: 48, borderRadius: '8px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, overflow: 'hidden', background: '#262626',
      }}>
        {track.file_id ? (
          <img
            src={`${API_BASE}/thumbnails/list/${track.file_id}.jpg`}
            alt=""
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        ) : (
          <svg style={{ width: 24, height: 24, color: '#e5e5e5' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h4 style={{
          margin: 0, fontSize: '13px', fontWeight: 500,
          color: track.exists ? COLORS.text.primary : COLORS.text.secondary,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {track.display_name}
        </h4>
        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
          {track.size > 0 && (
            <span style={{ fontSize: '11px', color: COLORS.text.tertiary }}>
              {formatSize(track.size)}
            </span>
          )}
        </div>
      </div>
      {track.duration > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {hasMv && (
            <span style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px', padding: '1px 6px',
              borderRadius: '4px', background: 'rgba(255,192,203,0.2)', color: '#d63384', flexShrink: 0,
            }}>
              MV
            </span>
          )}
          {ext && (
            <span className={ext.toLowerCase() === 'flac' ? 'flac-badge' : undefined} style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px', padding: '1px 6px',
              borderRadius: '4px', background: ext.toLowerCase() === 'flac' ? undefined : extColor.bg, color: extColor.fg, flexShrink: 0,
              textShadow: ext.toLowerCase() === 'flac' ? '0 1px 0 rgba(255,255,255,0.6)' : undefined,
            }}>
              {extLabel}
            </span>
          )}
          <span style={{ fontSize: '9px', color: COLORS.text.secondary, flexShrink: 0 }}>
            {formatDuration(track.duration)}
          </span>
        </div>
      )}
      {deleteMode ? (
        <button
          onClick={(e) => { e.stopPropagation(); onSelect?.(track, index); }}
          style={{
            width: 20, height: 20, borderRadius: '4px',
            border: `1.5px solid ${isSelected ? '#ef4444' : COLORS.border.primary}`,
            background: isSelected ? '#ef4444' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'white', fontSize: '12px', fontWeight: 600,
          }}
        >
          {isSelected && '✓'}
        </button>
      ) : (
        <button
          className="trash-btn"
          onClick={(e) => { e.stopPropagation(); onRemove?.(track.id, e); }}
          style={{
            padding: '6px', borderRadius: '6px', border: 'none',
            background: 'transparent', color: COLORS.text.secondary,
            cursor: 'pointer', display: 'flex', alignItems: 'center',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
      )}
    </div>
  );
});

PlaylistListRow.displayName = 'PlaylistListRow';

export { injectStyles as injectPlaylistListRowStyles };
export default PlaylistListRow;
