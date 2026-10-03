import React from 'react';
import NetworkImage from '../shared/NetworkImage';
import { listeningTracker } from '../utils/listeningTracker.js';

const COLORS = {
  bg: { primary: '#0a0a0a', secondary: '#171717' },
  border: { primary: '#262626', secondary: '#404040' },
  text: { primary: '#e5e5e5', secondary: '#a3a3a3', tertiary: '#737373' },
};

function formatListeningDuration(seconds) {
  if (!seconds) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h} jam ${m} menit`;
  if (m > 0) return `${m} menit ${s} detik`;
  return `${s} detik`;
}

export default function LeaderboardPanel({
  listeningLeaderboardMetric,
  onMetricChange,
  leaderboardDisplayMode,
  onDisplayModeChange,
  formatListeningDuration,
}) {
  const globalStats = listeningTracker.getGlobalStats();
  const activeSessionSeconds = listeningTracker.getActiveSessionSeconds();
  const currentTrackId = listeningTracker.getCurrentTrackId();
  const leaderboard = listeningTracker.getLeaderboard(listeningLeaderboardMetric, 10).map(entry => {
    if (entry.trackId === currentTrackId && activeSessionSeconds > 0) {
      return { ...entry, listenedSeconds: (entry.listenedSeconds || 0) + activeSessionSeconds };
    }
    return entry;
  });
  const displayTotalListened = globalStats.totalListenedSeconds + activeSessionSeconds;
  const isGrid = leaderboardDisplayMode === 'grid';
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 2 }}>
        <button
          onClick={() => onMetricChange('plays')}
          style={{
            flex: 1, padding: '4px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontSize: 10, fontWeight: 600, textAlign: 'center',
            background: listeningLeaderboardMetric === 'plays' ? 'rgba(255,255,255,0.12)' : 'transparent',
            color: listeningLeaderboardMetric === 'plays' ? '#fff' : COLORS.text.tertiary,
          }}
        >
          MOST PLAYED
        </button>
        <button
          onClick={() => onMetricChange('listened')}
          style={{
            flex: 1, padding: '4px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontSize: 10, fontWeight: 600, textAlign: 'center',
            background: listeningLeaderboardMetric === 'listened' ? 'rgba(255,255,255,0.12)' : 'transparent',
            color: listeningLeaderboardMetric === 'listened' ? '#fff' : COLORS.text.tertiary,
          }}
        >
          MOST LISTENED
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, padding: '0 2px' }}>
        <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 10px' }}>
          <div style={{ fontSize: 10, color: COLORS.text.tertiary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Plays</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{globalStats.totalPlayCount}</div>
        </div>
        <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 10px' }}>
          <div style={{ fontSize: 10, color: COLORS.text.tertiary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Time</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{formatListeningDuration(displayTotalListened)}</div>
        </div>
        <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 10px' }}>
          <div style={{ fontSize: 10, color: COLORS.text.tertiary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tracks</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{globalStats.uniqueTracks}</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 2px' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.text.tertiary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Top 10</span>
        <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 6, padding: 2 }}>
          <button
            onClick={() => onDisplayModeChange('list')}
            style={{
              padding: '2px 6px', borderRadius: 4, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 600, textAlign: 'center',
              background: leaderboardDisplayMode === 'list' ? 'rgba(255,255,255,0.12)' : 'transparent',
              color: leaderboardDisplayMode === 'list' ? '#fff' : COLORS.text.tertiary,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }}>
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            List
          </button>
          <button
            onClick={() => onDisplayModeChange('grid')}
            style={{
              padding: '2px 6px', borderRadius: 4, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 600, textAlign: 'center',
              background: leaderboardDisplayMode === 'grid' ? 'rgba(255,255,255,0.12)' : 'transparent',
              color: leaderboardDisplayMode === 'grid' ? '#fff' : COLORS.text.tertiary,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }}>
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
            </svg>
            Grid
          </button>
        </div>
      </div>
      {leaderboard.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: COLORS.text.tertiary, fontSize: 12 }}>
          No listening history yet.
        </div>
      ) : isGrid ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 2px' }} className="sidebar-scroll">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 1fr)', gap: 8 }}>
            {leaderboard.map((entry) => {
              const isActive = entry.trackId === currentTrackId;
              return (
                <div
                  key={entry.trackId}
                  style={{
                    borderRadius: 12,
                    background: '#171717',
                    border: `1px solid ${isActive ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.08)'}`,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    transition: 'background 200ms ease, border-color 200ms ease, transform 200ms ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = isActive ? 'rgba(52,211,153,0.14)' : 'rgba(255,255,255,0.05)';
                    e.currentTarget.style.borderColor = isActive ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.14)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#171717';
                    e.currentTarget.style.borderColor = isActive ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.08)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ width: '100%', aspectRatio: '1/1', background: '#0a0a0a', overflow: 'hidden' }}>
                    {entry.trackId ? (
                       <NetworkImage src={`/thumbnails/list/${entry.trackId}.jpg`} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#525252" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 12, color: COLORS.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>{entry.displayName || entry.trackId}</div>
                    <div style={{ fontSize: 10, color: COLORS.text.tertiary }}>{formatListeningDuration(entry.listenedSeconds)}</div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#34d399' }}>{entry.playCount} plays</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {leaderboard.map((entry, idx) => {
            const isActive = entry.trackId === currentTrackId;
            return (
              <div
                key={entry.trackId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 12,
                  background: isActive ? 'rgba(52,211,153,0.08)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(52,211,153,0.18)' : 'transparent'}`,
                  cursor: 'pointer',
                  transition: 'background 200ms ease, border-color 200ms ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = isActive ? 'rgba(52,211,153,0.14)' : 'rgba(255,255,255,0.06)';
                  e.currentTarget.style.borderColor = isActive ? 'rgba(52,211,153,0.3)' : 'rgba(255,255,255,0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isActive ? 'rgba(52,211,153,0.08)' : 'transparent';
                  e.currentTarget.style.borderColor = isActive ? 'rgba(52,211,153,0.18)' : 'transparent';
                }}
              >
                <div style={{ width: 22, textAlign: 'center', fontSize: 12, fontWeight: 700, color: COLORS.text.tertiary, flexShrink: 0 }}>#{idx + 1}</div>
                <div style={{ width: 38, height: 38, borderRadius: 8, background: '#171717', border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0, overflow: 'hidden' }}>
                  {entry.trackId ? (
                     <NetworkImage src={`/thumbnails/list/${entry.trackId}.jpg`} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#525252" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                      </svg>
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: COLORS.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>{entry.displayName || entry.trackId}</div>
                  <div style={{ fontSize: 10, color: COLORS.text.tertiary, marginTop: 1 }}>{formatListeningDuration(entry.listenedSeconds)}</div>
                </div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#34d399', whiteSpace: 'nowrap' }}>{entry.playCount} plays</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
