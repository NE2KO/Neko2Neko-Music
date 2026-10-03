import React, { useState, useEffect } from 'react';
import { Menu, Search } from 'lucide-react';
import PlaylistView from './PlaylistView';

// Color constants (same as in PlaylistView)
const COLORS = {
  bg: {
    primary: '#0a0a0a',
    secondary: '#171717',
    tertiary: '#0a0a0a',
  },
  border: {
    primary: '#262626',
    secondary: '#404040',
  },
  text: {
    primary: '#e5e5e5',
    secondary: '#a3a3a3',
    tertiary: '#737373',
  },
  accent: '#0ea5e9',
};

/**
 * MusicLayout – renders a header (search & menu button) above the PlaylistView.
 * The header is intentionally not panel‑styled (no border radius) and the
 * search query state is persisted to localStorage.
 */
export default function MusicLayout(props) {
  const {
    setMenuSidebarOpen,
    // Pass through rest of props to PlaylistView
    ...rest
  } = props;

  const [trackSearchQuery, setTrackSearchQuery] = useState(() => {
    try {
      return localStorage.getItem('trackSearchQuery') || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('trackSearchQuery', trackSearchQuery);
    } catch {}
  }, [trackSearchQuery]);

  const header = (
    <div style={{ background: '#000', height: 80, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, borderRadius: 12 }}>
      {/* Left: menu button */}
      <button
        onClick={() => setMenuSidebarOpen?.(true)}
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          color: '#737373',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'color 0.15s, background 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#e5e5e5'; e.currentTarget.style.background = '#171717'; }}
        onMouseLeave={e => { e.currentTarget.style.color = '#737373'; e.currentTarget.style.background = 'transparent'; }}
        title="Buka menu"
      >
        <Menu size={16} />
      </button>

      {/* Center: shortened search bar */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: 400 }}>
          <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: COLORS.text.secondary, pointerEvents: 'none' }} />
          <input
            value={trackSearchQuery}
            onChange={e => setTrackSearchQuery(e.target.value)}
            placeholder="Cari di playlist…"
            style={{
              width: '100%',
              height: 36,
              padding: '0 14px 0 40px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.04)',
              color: '#fff',
              fontSize: 14,
              outline: 'none',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = '#8892E6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(136,146,230,0.15)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.boxShadow = 'none'; }}
          />
        </div>
      </div>

      {/* Right: placeholder for future icons */}
      <div style={{ width: 28, height: 28, flexShrink: 0 }} />
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {header}
      <div className="flex-1 min-h-0">
        <PlaylistView
          trackSearchQuery={trackSearchQuery}
          setTrackSearchQuery={setTrackSearchQuery}
          setMenuSidebarOpen={setMenuSidebarOpen}
          {...rest}
        />
      </div>
    </div>
  );
}
