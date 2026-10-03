import React, { useEffect, useMemo, useState } from 'react';

const FALLBACK_GRADIENT = ['#989FF8', '#76B2E7'];

function resolveCover(playlist) {
  const img = playlist?.image;
  if (!img) return null;
  if (/^(data:|https?:|\/\/)/i.test(img)) return img;
  const id = playlist.id ?? playlist._id;
  if (id == null) return null;
  return `/api/playlists/${id}/image`;
}

const wrapApi = (url) => {
  if (!url) return null;
  return url.startsWith('/') && !url.startsWith('//') ? `${(import.meta.env.VITE_API_URL || '')}${url}` : url;
};

function useDominantColors(src) {
  const [colors, setColors] = useState(null);

  useEffect(() => {
    setColors(null);
    if (!src) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = 50;
        const h = 50;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        const buckets = new Map();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue;
          const kr = (r >> 5) << 5;
          const kg = (g >> 5) << 5;
          const kb = (b >> 5) << 5;
          const key = `${kr},${kg},${kb}`;
          const cur = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
          cur.r += r;
          cur.g += g;
          cur.b += b;
          cur.n += 1;
          buckets.set(key, cur);
        }
        const sorted = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 2);
        const avg = (items, idx) => Math.round(items.reduce((s, it) => s + (idx === 0 ? it.r : idx === 1 ? it.g : it.b) / it.n, 0) / items.length);
        const c1 = sorted.length ? [avg(sorted, 0), avg(sorted, 1), avg(sorted, 2)] : FALLBACK_GRADIENT.map(c => parseInt(c.slice(1, 3), 16));
        let c2;
        if (sorted.length > 1) {
          c2 = [avg(sorted.slice(0, 2), 0), avg(sorted.slice(0, 2), 1), avg(sorted.slice(0, 2), 2)];
        } else {
          c2 = c1.map(v => Math.max(0, v - 40));
        }
        if (!cancelled) setColors([c1, c2]);
      } catch {
        if (!cancelled) setColors(FALLBACK_GRADIENT.map(c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]));
      }
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [src]);

  return colors;
}

const rgb = (c) => c ? `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})` : null;

// Transient blurred-image flash shown briefly when entering a playlist.
function BlurFlash({ src }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setLoaded(false); setFailed(false); }, [src]);
  if (failed || !src) return null;
  return (
    <div className="pv-flash" style={{ position: 'absolute', inset: 0, opacity: 0 }}>
      <img
        src={src}
        alt=""
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover',
          filter: 'blur(40px) saturate(140%) brightness(0.5)',
          transform: 'scale(1.15)',
          opacity: loaded ? 1 : 0,
        }}
      />
    </div>
  );
}

export default function PlaylistBackdrop({ playlist, isLoved, color }) {
  const cover = isLoved ? null : resolveCover(playlist);
  const src = wrapApi(cover);
  const dominant = useDominantColors(src);
  const id = playlist?.id ?? playlist?._id ?? null;

  // Crossfade stack (last two playlists). The CURRENT layer must always stay
  // visible: true — the old layer is dropped after the transition.
  const [layers, setLayers] = useState(() => [{ id, src, visible: true }]);
  const [shownId, setShownId] = useState(id);

  useEffect(() => {
    if (id === shownId) return;
    setShownId(id);
    setLayers((prev) => [{ id, src, visible: true }, ...prev].slice(0, 2));
    const t = setTimeout(() => {
      setLayers((prev) => prev.filter((l) => l.id === id));
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const c1 = useMemo(() => color?.c1 ?? dominant?.[0] ?? null, [color, dominant]);

  const bandGradient = useMemo(() => {
    const a = rgb(c1) || FALLBACK_GRADIENT[0];
    const b = FALLBACK_GRADIENT[1];
    return `linear-gradient(180deg, ${a} 0%, ${b} 60%, rgba(18,18,18,0.85) 84%, #121212 100%)`;
  }, [c1]);

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      {layers.map((l) => (
        <div
          key={l.id}
          className="pv-backdrop-layer"
          style={{ opacity: l.visible ? 1 : 0 }}
        >
          {l.id === id && <div style={{ position: 'absolute', inset: 0, background: bandGradient }} />}
        </div>
      ))}
      <BlurFlash key={`flash-${id}`} src={src} />
    </div>
  );
}