import React from 'react';
import { X } from 'lucide-react';
import NowPlayingPanel from './NowPlayingPanel';
import LeaderboardPanel from './LeaderboardPanel';

const COLORS = {
  bg: { primary: '#0a0a0a', secondary: '#171717' },
  border: { primary: '#262626' },
  text: { tertiary: '#a3a3a3' },
};

// Full sidebar content. Rendered ONLY when open — the collapsed bar, hover
// peek animation and resize affordances live in PlaylistView's right
// sidebar assembly. Width follows the resizable container so drag-resize
// reflows the contents instead of clipping a hardcoded layout.
export default function PlaylistRightModule({
  open,
  width = 360,
  mode,
  onModeChange,
  onClose,
  hasActivePlayback,
  queue,
  currentTrackIndex,
  listeningLeaderboardMetric,
  onMetricChange,
  leaderboardDisplayMode,
  onDisplayModeChange,
  formatListeningDuration,
}) {
  if (!open) return null;

  return (
    <div
      style={{
        width,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        height: '100%',
        background: '#121212',
      }}
    >
      <div style={{ padding: '24px 24px 0', flexShrink: 0 }}>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ position: 'relative', display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 2 }}>
            <div style={{
              position: 'absolute',
              top: 2,
              left: 2,
              width: 'calc(50% - 4px)',
              height: 'calc(100% - 4px)',
              borderRadius: 6,
              background: 'rgba(255,255,255,0.12)',
              transition: 'transform 250ms ease',
              transform: mode === 'nowplaying' ? 'translateX(0)' : 'translateX(100%)',
            }} />
            <button
              onClick={() => onModeChange?.('nowplaying')}
              style={{
                position: 'relative',
                zIndex: 1,
                flex: 1,
                padding: '4px 12px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
                textAlign: 'center',
                background: 'transparent',
                color: mode === 'nowplaying' ? '#fff' : COLORS.text.tertiary,
                transition: 'color 200ms ease',
              }}
            >
              Now Playing
            </button>
            <button
              onClick={() => onModeChange?.('leaderboard')}
              style={{
                position: 'relative',
                zIndex: 1,
                flex: 1,
                padding: '4px 12px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
                textAlign: 'center',
                background: 'transparent',
                color: mode === 'leaderboard' ? '#fff' : COLORS.text.tertiary,
                transition: 'color 200ms ease',
              }}
            >
              Leaderboard
            </button>
          </div>
          <button
            onClick={onClose}
            style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Close sidebar"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div style={{
        flex: 1,
        background: 'transparent',
        borderRadius: 0,
        overflow: 'hidden',
        position: 'relative',
        padding: 16,
      }}>
        {/* Slide 1 — Now Playing */}
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: '#121212',
          padding: 16,
          transition: 'transform 300ms ease',
          transform: mode === 'nowplaying' ? 'translateX(0)' : 'translateX(-100%)',
        }}>
          {hasActivePlayback ? (
            <NowPlayingPanel queue={queue} currentTrackIndex={currentTrackIndex} />
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: COLORS.text.tertiary, fontSize: 13 }}>
              No track is playing
            </div>
          )}
        </div>
        {/* Slide 2 — Leaderboard */}
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: '#121212',
          padding: 16,
          transition: 'transform 300ms ease',
          transform: mode === 'leaderboard' ? 'translateX(0)' : 'translateX(100%)',
        }}>
          <LeaderboardPanel
            listeningLeaderboardMetric={listeningLeaderboardMetric}
            onMetricChange={onMetricChange}
            leaderboardDisplayMode={leaderboardDisplayMode}
            onDisplayModeChange={onDisplayModeChange}
            formatListeningDuration={formatListeningDuration}
          />
        </div>
      </div>
    </div>
  );
}
