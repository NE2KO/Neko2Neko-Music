import React, { useState } from 'react';
import { Heart } from 'lucide-react';

const COLORS = {
  bg: { primary: '#121212', secondary: '#171717' },
  border: { primary: '#262626' },
  text: { primary: '#e5e5e5', secondary: '#e5e5e5', tertiary: '#e5e5e5' },
  selected: '#2a2a2a',
};

const HOVER_BG = 'rgba(255,255,255,0.06)';

function PlaylistSidebar({ playlists, favoritesCount, activeId, lovedActive, onSelect, onSelectLoved }) {
  const [hoverId, setHoverId] = useState(null);
  return (
    <div style={{
      width: 260,
      flexShrink: 0,
      background: '#121212',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '16px 16px 8px',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: COLORS.text.tertiary,
      }}>
        Playlist
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px', minHeight: 0 }}>
        {playlists.map((p) => {
          const active = String(p.id) === String(activeId) && !lovedActive;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p)}
              onMouseEnter={() => setHoverId(p.id)}
              onMouseLeave={() => setHoverId(null)}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '8px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                marginBottom: 2,
                background: hoverId === p.id && !active ? HOVER_BG : 'transparent',
                outline: 'none',
              }}
            >
              {active && (
                <div style={{
                  position: 'absolute',
                  left: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 3,
                  height: 28,
                  borderRadius: 999,
                  background: 'var(--color-primary)',
                }} />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 13, fontWeight: 500,
                  color: active ? COLORS.text.primary : COLORS.text.secondary,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{p.title}</div>
                <div style={{ fontSize: 11, color: COLORS.text.tertiary }}>{p.track_count ?? 0} lagu</div>
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ padding: '8px', borderTop: `1px solid ${COLORS.border.primary}`, display: 'flex', flexDirection: 'column', gap: 6, background: '#121212' }}>
        <button
          onClick={onSelectLoved}
          onMouseEnter={() => setHoverId('loved')}
          onMouseLeave={() => setHoverId(null)}
          style={{
            position: 'relative',
            display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px',
            borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left',
            background: hoverId === 'loved' && !lovedActive ? HOVER_BG : 'transparent', outline: 'none',
          }}
        >
          {lovedActive && (
            <div style={{
              position: 'absolute',
              left: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 3,
              height: 28,
              borderRadius: 999,
              background: 'var(--color-primary)',
            }} />
          )}
          <div style={{
            width: 40, height: 40, borderRadius: 6, flexShrink: 0,
            background: '#262626',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Heart size={18} color="#737373" fill="#737373" />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 13, fontWeight: 500,
              color: lovedActive ? COLORS.text.primary : COLORS.text.secondary,
            }}>Loved</div>
            <div style={{ fontSize: 11, color: COLORS.text.tertiary }}>{favoritesCount} lagu</div>
          </div>
        </button>
      </div>
    </div>
  );
}

export default function PlaylistLeftModule({
  showSidebar,
  leftHovered,
  setLeftHovered,
  onToggleSidebar,
  sortedPlaylists,
  favoritesCount,
  selectedPlaylist,
  showLoved,
  handleSelectPlaylist,
  selectLoved,
}) {
  return (
    <div
      style={{
        width: showSidebar ? 260 : 0,
        transition: 'width 0.3s ease',
        overflow: 'hidden',
        flexShrink: 0,
        position: 'relative',
        height: '100%',
      }}
    >
      {showSidebar && (
        <>
          <div
            onMouseEnter={() => setLeftHovered(true)}
            onMouseLeave={() => setLeftHovered(false)}
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: 24,
              zIndex: 40,
              cursor: 'pointer',
            }}
          />
           <button
             onClick={onToggleSidebar}
             style={{
               position: 'absolute',
               right: 6,
               top: '50%',
               transform: 'translateY(-50%)',
               width: 24,
               height: 48,
               borderRadius: '0 8px 8px 0',
               background: COLORS.bg.secondary,
               border: `1px solid ${COLORS.border.primary}`,
               borderLeft: 'none',
               color: COLORS.text.secondary,
               cursor: 'pointer',
               display: 'flex',
               alignItems: 'center',
               justifyContent: 'center',
               zIndex: 40,
               opacity: leftHovered ? 1 : 0,
               transition: 'opacity 0.2s ease',
               pointerEvents: leftHovered ? 'auto' : 'none',
             }}
             title="Hide sidebar"
           >
           </button>
           <PlaylistSidebar
             playlists={sortedPlaylists}
             favoritesCount={favoritesCount}
             activeId={selectedPlaylist?.id}
             lovedActive={showLoved}
             onSelect={handleSelectPlaylist}
             onSelectLoved={selectLoved}
           />
        </>
      )}
      {!showSidebar && (
        <>
          <div
            onMouseEnter={() => setLeftHovered(true)}
            onMouseLeave={() => setLeftHovered(false)}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 40,
              zIndex: 40,
              cursor: 'pointer',
            }}
          />
           <button
             onClick={onToggleSidebar}
             style={{
               position: 'absolute',
               left: 8,
               top: '50%',
               transform: 'translateY(-50%)',
               width: 24,
               height: 48,
               borderRadius: '0 8px 8px 0',
               background: COLORS.bg.secondary,
               border: `1px solid ${COLORS.border.primary}`,
               borderLeft: 'none',
               color: COLORS.text.secondary,
               cursor: 'pointer',
               display: 'flex',
               alignItems: 'center',
               justifyContent: 'center',
               zIndex: 40,
               opacity: leftHovered ? 1 : 0,
               transition: 'opacity 0.2s ease',
               pointerEvents: leftHovered ? 'auto' : 'none',
             }}
             title="Show sidebar"
           >
           </button>
        </>
      )}
    </div>
  );
}
