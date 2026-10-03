import React, { memo } from 'react';

const COLORS = {
  bg: { primary: '#0a0a0a', secondary: '#171717' },
  border: { primary: '#262626', secondary: '#404040' },
  text: { primary: '#e5e5e5', secondary: '#a3a3a3', tertiary: '#737373' },
  accent: '#0ea5e9',
};

const ROW_STYLE = `
  .playlist-list-item-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    margin-bottom: 8px;
    border-radius: 8px;
    border: 1px solid ${COLORS.border.primary};
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
    background: transparent;
  }
  .playlist-list-item-row:hover {
    background: ${COLORS.bg.secondary} !important;
    border-color: ${COLORS.border.secondary} !important;
  }
  .playlist-list-item-row.selected {
    background: ${COLORS.accent}20 !important;
  }
  .playlist-list-item-row .delete-btn {
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
  }
  .playlist-list-item-row:hover .delete-btn {
    opacity: 1;
    pointer-events: auto;
  }
`;

let styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement('style');
  s.textContent = ROW_STYLE;
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

const PlaylistListItemRow = memo(({ index, style, data }) => {
  const { playlists, playlistDeleteMode, selectedPlaylistIds, onSelect, onDelete, onToggleSelect } = data;
  const playlist = playlists[index];
  if (!playlist) return null;

  const isSelected = selectedPlaylistIds?.has(playlist.id);
  const rowClass = `playlist-list-item-row${isSelected ? ' selected' : ''}`;

  return (
    <div style={style} className={rowClass} onClick={() => onSelect?.(playlist)}>
      <div style={{
        width: 40, height: 40, borderRadius: 8,
        background: '#262626',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, border: `1px solid ${COLORS.border.primary}`,
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{
          margin: 0, fontSize: 14, fontWeight: 500,
          color: COLORS.text.primary,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {playlist.title}
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: COLORS.text.secondary }}>
          {playlist.available_tracks}/{playlist.track_count} tracks · {formatDuration(playlist.total_duration || 0)}
        </p>
      </div>
      {playlist.missing_tracks > 0 && (
        <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 500 }}>
          {playlist.missing_tracks} missing
        </span>
      )}
      <button
        className="delete-btn"
        onClick={(e) => { e.stopPropagation(); onDelete?.(playlist.id, e); }}
        style={{
          padding: 6, borderRadius: 6, border: 'none',
          background: 'transparent', color: COLORS.text.secondary,
          cursor: 'pointer', display: 'flex', alignItems: 'center',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
      </button>
    </div>
  );
});

PlaylistListItemRow.displayName = 'PlaylistListItemRow';

export { injectStyles as injectPlaylistListItemRowStyles };
export default PlaylistListItemRow;
