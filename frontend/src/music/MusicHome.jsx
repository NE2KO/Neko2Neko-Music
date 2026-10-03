import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Play, Pause, Music } from 'lucide-react';
import usePlaybackStore from '../store/playbackStore';

const API_BASE = import.meta.env.VITE_API_URL || '';

function formatListenedDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m listened`;
  if (m > 0) return `${m}m ${sec}s listened`;
  return `${sec}s listened`;
}

function formatAddedDate(createdAt) {
  if (!createdAt) return 'Added today';
  const date = new Date(createdAt);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Added today';
  if (diffDays === 1) return 'Added yesterday';
  if (diffDays < 7) return `Added ${diffDays} days ago`;
  return `Added ${date.toLocaleDateString()}`;
}

function Section({ title, children }) {
  const railRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);

  const handlePointerMove = useCallback((e) => {
    const state = dragRef.current;
    const container = railRef.current;
    if (!state || !container || state.pointerId !== e.pointerId) return;
    const dx = e.clientX - state.startX;
    if (!state.moved && Math.abs(dx) > 3) state.moved = true;
    if (state.moved) container.scrollLeft = state.startScrollLeft - dx;
  }, []);

  const handlePointerUp = useCallback((e) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    if (state.moved) suppressClickRef.current = true;
    dragRef.current = null;
    const container = railRef.current;
    if (container) container.style.cursor = 'grab';
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
  }, [handlePointerMove]);

  const handlePointerDown = useCallback((e) => {
    if (e.pointerType === 'touch') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const container = railRef.current;
    if (!container) return;
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScrollLeft: container.scrollLeft,
      moved: false,
    };
    container.style.cursor = 'grabbing';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }, [handlePointerMove, handlePointerUp]);

  const handleClickCapture = useCallback((e) => {
    if (suppressClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickRef.current = false;
    }
  }, []);

  useEffect(() => () => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
  }, [handlePointerMove, handlePointerUp]);

  return (
    <div style={{ marginBottom: 36 }}>
      <h2 style={{
        fontSize: 18,
        fontWeight: 700,
        color: '#fff',
        margin: '0 0 14px 0',
        letterSpacing: '-0.01em',
      }}>
        {title}
      </h2>
      <div
        ref={railRef}
        className="scrollbar-hide"
        onPointerDown={handlePointerDown}
        onClickCapture={handleClickCapture}
        style={{
          display: 'flex',
          gap: 16,
          overflowX: 'auto',
          overflowY: 'hidden',
          paddingBottom: 6,
          touchAction: 'pan-x',
          userSelect: 'none',
          minWidth: 0,
          minHeight: 0,
          cursor: 'grab',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function PlaylistCard({ playlist, onClick }) {
  const thumbSrc = playlist.image
    ? `${API_BASE}${playlist.image}`
    : playlist.has_image
      ? `${API_BASE}/api/playlists/${playlist.id}/image`
      : null;

  return (
    <div
      onClick={() => onClick(playlist)}
      style={{
        width: 160,
        flexShrink: 0,
        cursor: 'pointer',
      }}
    >
      <div style={{
        width: 160,
        height: 160,
        borderRadius: 8,
        overflow: 'hidden',
        background: thumbSrc ? undefined : 'linear-gradient(135deg,#989FF8,#76B2E7)',
        marginBottom: 8,
        position: 'relative',
      }}>
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt={playlist.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.85)',
          }}>
            <Music size={36} />
          </div>
        )}
      </div>
      <p style={{
        margin: 0,
        fontSize: 14,
        fontWeight: 500,
        color: '#fff',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {playlist.title}
      </p>
      <p style={{
        margin: '2px 0 0',
        fontSize: 12,
        color: '#a3a3a3',
      }}>
        Playlist
      </p>
    </div>
  );
}

function TrackCard({ track, onClick, metadata }) {
  const thumbSrc = `${API_BASE}/thumbnails/full/${track.file_id || track.id}.jpg`;
  const [hovered, setHovered] = useState(false);

  const queue = usePlaybackStore(s => s.queue);
  const currentTrackIndex = usePlaybackStore(s => s.currentTrackIndex);
  const isPlaying = usePlaybackStore(s => s.isPlaying);

  const currentTrack = queue && queue.length > 0 ? queue[currentTrackIndex] : null;
  const currentFileId = currentTrack ? (currentTrack.file_id || currentTrack.id) : null;
  const trackFileId = track.file_id || track.id;
  const isCurrentTrack = currentFileId === trackFileId;
  const showPause = isCurrentTrack && isPlaying;

  const title = track.display_name || track.name?.replace(/\.[^/.]+$/, '') || 'Unknown';
  const artist = track.artist || '';

  const handlePlayClick = (e) => {
    e.stopPropagation();
    onClick(track);
  };

  return (
    <div
      onClick={() => onClick(track)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 160,
        flexShrink: 0,
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      <div style={{
        width: 160,
        height: 160,
        borderRadius: 8,
        overflow: 'hidden',
        background: thumbSrc ? undefined : 'linear-gradient(135deg,#1e1b4b,#312e81)',
        marginBottom: 8,
        position: 'relative',
      }}>
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt={title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
            draggable={false}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.85)',
          }}>
            <Music size={36} />
          </div>
        )}
        {hovered && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            padding: 8,
            transition: 'opacity 0.15s ease',
          }}>
            <button
              onClick={handlePlayClick}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(0,0,0,0.65)',
                color: '#fff',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                lineHeight: 0,
              }}
            >
              {showPause ? <Pause size={18} /> : <Play size={18} />}
            </button>
          </div>
        )}
      </div>
      <p style={{
        margin: 0,
        fontSize: 14,
        fontWeight: 500,
        color: '#fff',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {title}
      </p>
      {artist ? (
        <p style={{
          margin: '2px 0 0',
          fontSize: 12,
          color: '#a3a3a3',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {artist}
        </p>
      ) : null}
      {metadata ? (
        <p style={{
          margin: '2px 0 0',
          fontSize: 11,
          color: '#737373',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {metadata}
        </p>
      ) : null}
    </div>
  );
}

export default function MusicHome({
  playlists,
  onPlayPlaylist,
  onPlayTrack,
  onSelectPlaylist,
  favorites = [],
}) {
  const [recentlyAdded, setRecentlyAdded] = useState([]);
  const [mostPlayed, setMostPlayed] = useState([]);
  const [mostListened, setMostListened] = useState([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState([]);
  const [homeLoading, setHomeLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function loadHomeData() {
      setHomeLoading(true);
      setError(null);
      try {
        const [recentRes, mostRes, mostListenedRes, recentPlayedRes, favoritesRes] = await Promise.all([
          fetch(`${API_BASE}/api/files?type=audio&sortBy=created_at&sortOrder=desc&limit=20`),
          fetch(`${API_BASE}/api/listening/leaderboard?metric=plays&limit=20`),
          fetch(`${API_BASE}/api/listening/leaderboard?metric=listened&limit=20`),
          fetch(`${API_BASE}/api/listening/recent?limit=20`),
          fetch(`${API_BASE}/api/files/favorites`),
        ]);

        if (!cancelled) {
          if (recentRes.ok) {
            const data = await recentRes.json();
            setRecentlyAdded((data.items || []).map(item => ({
              ...item,
              metadata: formatAddedDate(item.created_at),
            })));
          } else {
            setRecentlyAdded([]);
          }
          if (mostRes.ok) {
            const data = await mostRes.json();
            setMostPlayed((data.leaderboard || []).map(item => ({
              ...item,
              id: item.trackId,
              name: item.displayName,
              playCount: item.playCount,
              listenedSeconds: item.listenedSeconds,
              metadata: `+${item.playCount || 0} plays`,
            })));
          } else {
            setMostPlayed([]);
          }
          if (mostListenedRes.ok) {
            const data = await mostListenedRes.json();
            setMostListened((data.leaderboard || []).map(item => ({
              ...item,
              id: item.trackId,
              name: item.displayName,
              playCount: item.playCount,
              listenedSeconds: item.listenedSeconds,
              metadata: formatListenedDuration(item.listenedSeconds),
            })));
          } else {
            setMostListened([]);
          }
          if (recentPlayedRes.ok) {
            const data = await recentPlayedRes.json();
            setRecentlyPlayed((data.leaderboard || []).map(item => ({
              ...item,
              id: item.trackId,
              name: item.displayName,
              playCount: item.playCount,
              listenedSeconds: item.listenedSeconds,
              metadata: null,
            })));
          } else {
            setRecentlyPlayed([]);
          }
        }
      } catch (err) {
        console.error('[MusicHome] Failed to load:', err);
        if (!cancelled) {
          setError(err.message);
          setRecentlyAdded([]);
          setMostPlayed([]);
          setMostListened([]);
          setRecentlyPlayed([]);
        }
      } finally {
        if (!cancelled) setHomeLoading(false);
      }
    }

    loadHomeData();
    return () => { cancelled = true; };
  }, []);

  const buildTrackQueue = (track) => {
    const name = track.display_name || track.name || '';
    return [{
      file_id: track.id,
      track_index: 0,
      title: name.replace(/\.[^/.]+$/, ''),
      artist: track.artist || '',
      album: track.album || '',
      duration: track.duration || 0,
      path: track.dir_path ? `${track.dir_path}/${track.name}` : track.name,
      exists: true,
      name: name,
      type: track.type || 'audio',
    }];
  };

  if (homeLoading) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#737373',
      }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#ef4444',
      }}>
        <p>Failed to load music: {error}</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '0 0 24px', minHeight: 0 }}>
      <Section title="Playlist">
        {playlists.length > 0 ? (
          playlists.slice(0, 20).map(playlist => (
            <PlaylistCard
              key={playlist.id}
              playlist={playlist}
              onClick={onSelectPlaylist}
            />
          ))
        ) : (
          <p style={{ color: '#737373', fontSize: 14 }}>No playlists yet</p>
        )}
      </Section>

      <Section title="Recently Added">
        {recentlyAdded.length > 0 ? (
          recentlyAdded.map(track => (
            <TrackCard
              key={track.id}
              track={track}
              metadata={track.metadata}
              onClick={(track) => onPlayTrack(track, buildTrackQueue(track), 0, null)}
            />
          ))
        ) : (
          <p style={{ color: '#737373', fontSize: 14 }}>No recently added tracks</p>
        )}
      </Section>

      <Section title="Most Played">
        {mostPlayed.length > 0 ? (
          mostPlayed.map(item => (
            <TrackCard
              key={item.trackId || item.file?.id}
              track={item.file || item}
              metadata={item.metadata}
              onClick={(track) => onPlayTrack(track, buildTrackQueue(track), 0, null)}
            />
          ))
        ) : (
          <p style={{ color: '#737373', fontSize: 14 }}>No plays yet</p>
        )}
      </Section>

      <Section title="Most Listened">
        {mostListened.length > 0 ? (
          mostListened.map(item => (
            <TrackCard
              key={item.trackId || item.file?.id}
              track={item.file || item}
              metadata={item.metadata}
              onClick={(track) => onPlayTrack(track, buildTrackQueue(track), 0, null)}
            />
          ))
        ) : (
          <p style={{ color: '#737373', fontSize: 14 }}>No listening history yet</p>
        )}
      </Section>

      <Section title="Recently Played">
        {recentlyPlayed.length > 0 ? (
          recentlyPlayed.map(item => (
            <TrackCard
              key={item.trackId || item.file?.id}
              track={item.file || item}
              metadata={item.metadata}
              onClick={(track) => onPlayTrack(track, buildTrackQueue(track), 0, null)}
            />
          ))
        ) : (
          <p style={{ color: '#737373', fontSize: 14 }}>No recently played tracks</p>
        )}
      </Section>

      <Section title="Loved Music">
        {favorites.length > 0 ? (
          favorites.map(track => (
            <TrackCard
              key={track.id || track.file_id}
              track={track}
              metadata={null}
              onClick={(track) => onPlayTrack(track, buildTrackQueue(track), 0, null)}
            />
          ))
        ) : (
          <p style={{ color: '#737373', fontSize: 14 }}>No loved tracks yet</p>
        )}
      </Section>
    </div>
  );
}
