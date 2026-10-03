import React from 'react';
import { ChevronLeft, X } from 'lucide-react';

export default function PlaylistSidebar({
  open,
  mode,
  leaderboardDisplayMode,
  onModeChange,
  onClose,
  onOpen,
  hasActivePlayback,
  queue,
  currentTrackIndex,
  listeningLeaderboardMetric,
  onLeaderboardMetricChange,
  onLeaderboardDisplayModeChange,
  formatListeningDuration,
  toggleHovered,
  onToggleHover,
  NowPlayingPanel,
  LeaderboardPanel,
  COLORS,
}) {
  return (
    <>
      <div
        data-debug-id="5.3"
        data-debug-name="NowPlayingSidebar"
        data-debug-type="panel"
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 360,
          background: 'linear-gradient(180deg, #1a1a1a 0%, #121212 100%)',
          borderLeft: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          opacity: open ? 1 : 0,
          transition: 'transform 300ms ease, opacity 300ms ease',
          pointerEvents: open ? 'auto' : 'none',
          zIndex: 20,
        }}
      >
        <>
          <div style={{ padding: '24px 24px 0', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 2 }}>
                <button
                  onClick={() => onModeChange('nowplaying')}
                  style={{
                    padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: 600, textAlign: 'center',
                    background: mode === 'nowplaying' ? 'rgba(255,255,255,0.12)' : 'transparent',
                    color: mode === 'nowplaying' ? '#fff' : COLORS.text.tertiary,
                  }}
                >
                  Now Playing
                </button>
                <button
                  onClick={() => onModeChange('leaderboard')}
                  style={{
                    padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: 600, textAlign: 'center',
                    background: mode === 'leaderboard' ? 'rgba(255,255,255,0.12)' : 'transparent',
                    color: mode === 'leaderboard' ? '#fff' : COLORS.text.tertiary,
                  }}
                >
                  Leaderboard
                </button>
              </div>
              <button
                onClick={onClose}
                style={{ width: 28, height: 28, borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title="Close sidebar"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', padding: '0 24px 24px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {mode === 'nowplaying' && hasActivePlayback && (
              <NowPlayingPanel queue={queue} currentTrackIndex={currentTrackIndex} />
            )}
            {mode === 'nowplaying' && !hasActivePlayback && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: COLORS.text.tertiary, fontSize: 13, flexShrink: 0 }}>
                No track is playing
              </div>
            )}
            {mode === 'leaderboard' && (
              <LeaderboardPanel
                listeningLeaderboardMetric={listeningLeaderboardMetric}
                onMetricChange={onLeaderboardMetricChange}
                leaderboardDisplayMode={leaderboardDisplayMode}
                onDisplayModeChange={onLeaderboardDisplayModeChange}
                formatListeningDuration={formatListeningDuration}
              />
            )}
          </div>
        </>
      </div>
      {!open && (hasActivePlayback || true) && (
        <button
          onClick={onOpen}
          onMouseEnter={() => onToggleHover?.(true)}
          onMouseLeave={() => onToggleHover?.(false)}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 40,
            cursor: 'pointer',
            zIndex: 10,
            background: 'transparent',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title={hasActivePlayback ? "Open Now Playing" : "Open Leaderboard"}
        >
          <ChevronLeft size={16} style={{ opacity: toggleHovered ? 1 : 0, transition: 'opacity 0.2s', color: '#a3a3a3' }} />
        </button>
      )}
    </>
  );
}
