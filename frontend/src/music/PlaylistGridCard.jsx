import React, { memo, useCallback, useState } from 'react';
import { Heart } from 'lucide-react';
import { toggleFavorite } from '../utils/api';

const CARD_ANIM_STYLE = `
  @keyframes playlistCardIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .playlist-card-in {
    animation: playlistCardIn 0.25s ease;
  }
  .grid-card-eq {
    width: 3px; border-radius: 2px; background: #052e16; height: 6px;
    animation: gridCardEq 0.9s ease-in-out infinite;
  }
  @keyframes gridCardEq {
    0%, 100% { height: 5px; }
    50% { height: 14px; }
  }
`;

let animStyleInjected = false;
function injectCardAnimStyles() {
  if (animStyleInjected) return;
  animStyleInjected = true;
  const s = document.createElement('style');
  s.textContent = CARD_ANIM_STYLE;
  document.head.appendChild(s);
}
injectCardAnimStyles();

const ThumbnailImage = memo(({ src, alt }) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="media-thumb-loading">
        <svg className="w-6 h-6 text-neutral-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      </div>
    );
  }

  return (
    <div className="media-thumb-wrapper">
      <img
        src={src}
        alt={alt}
        className={`media-thumb transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        loading="lazy"
        decoding="async"
        fetchpriority="low"
        onContextMenu={(e) => e.preventDefault()}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        style={{
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          objectFit: 'cover',
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
});

const PlaylistGridCard = memo(({ item, onSelect, onDelete, onToggleFavorite, typeLabel = 'PLAYLIST', itemWidth, cardHeight, _rawItem, isSelected, isDeleting, isLeaving, isEntering, slideX = 0, slideY = 0, selectMode, isPlaying }) => {
  const { title, subtitle, thumbnailUrl, isFavorite } = item;
  const [localFav, setLocalFav] = useState(null);
  const isFav = localFav !== null ? localFav : isFavorite;

  const hasSlide = slideX !== 0 || slideY !== 0;
  const slideTransform = hasSlide ? `translate(${slideX}px, ${slideY}px)` : undefined;

  const handleClick = () => {
    onSelect?.(_rawItem);
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
  };

  const handleToggleFav = useCallback(async (e) => {
    e.stopPropagation();
    const fileId = _rawItem?._file_id || _rawItem?.file_id || _rawItem?.id;
    if (!fileId) return;
    const prev = isFav;
    setLocalFav(!prev);
    try {
      const result = await toggleFavorite(fileId);
      setLocalFav(result.is_favorite === 1);
    } catch {
      setLocalFav(prev);
    }
  }, [_rawItem, isFav]);

  return (
    <div
      style={{
        width: itemWidth,
        height: cardHeight,
        contentVisibility: hasSlide ? 'visible' : 'auto',
        containIntrinsicSize: `${itemWidth}px ${cardHeight}px`,
        ...(hasSlide ? { transform: slideTransform, willChange: 'transform', transition: 'transform 200ms ease' } : {}),
      }}
      className="flex flex-col flex-shrink-0 select-none"
    >
      <div
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={`group relative rounded-xl overflow-hidden bg-neutral-900 border w-full h-full cursor-pointer flex flex-col flex-shrink-0 select-none transition-[border-color,opacity,transform] duration-200 ${
          isSelected ? 'border-sky-500 ring-2 ring-sky-500/40' : isPlaying ? 'border-green-500 ring-2 ring-green-500/50' : 'border-neutral-800/80'
        } ${isDeleting ? 'opacity-0 scale-90' : ''} ${isLeaving ? 'opacity-0' : ''} ${isEntering ? 'playlist-card-in' : ''} ${selectMode ? (isSelected ? 'opacity-100 scale-100' : 'opacity-40 scale-90') : ''}`}
        style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
      >
        <div className="w-full flex-1 min-h-0 flex items-center justify-center overflow-hidden relative" style={{ background: thumbnailUrl ? undefined : 'linear-gradient(135deg,#989FF8,#76B2E7)' }}>
          {thumbnailUrl ? (
            <ThumbnailImage src={thumbnailUrl} alt={title} />
          ) : (
            <div className="text-white flex flex-col items-center justify-center" style={{ opacity: 0.85 }}>
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            </div>
          )}
          <div className="absolute top-1 right-1 px-1.5 py-0.5 bg-black/75 rounded text-[8px] font-bold tracking-wide text-white/90 uppercase">{typeLabel}</div>

          {/* Love toggle */}
          <button
            onClick={handleToggleFav}
            className="absolute top-1 left-1 p-1 rounded-full bg-black/60 transition-transform active:scale-90 z-10"
            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Heart size={14} className={isFav ? 'text-red-500 fill-red-500' : 'text-white/70'} />
          </button>

          {/* Selection checkmark */}
          {isSelected && (
            <div className="absolute top-1 left-1 w-5 h-5 bg-sky-500 rounded-full flex items-center justify-center">
              <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
          )}

          {/* Now-playing badge */}
          {isPlaying && (
            <div className="absolute bottom-1 left-1 flex items-end gap-[2px] h-3.5 px-1 py-0.5 rounded z-10" title="Now playing" style={{ background: 'linear-gradient(90deg,#0EA5E9,#8892E6)' }}>
              <span className="grid-card-eq" />
              <span className="grid-card-eq" style={{ animationDelay: '0.15s' }} />
              <span className="grid-card-eq" style={{ animationDelay: '0.3s' }} />
            </div>
          )}

          {/* Delete button (hover, non-delete mode) */}
          {!isSelected && onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete?.(_rawItem?.id, e); }}
              className="absolute bottom-1 right-1 p-1 rounded bg-black/75 text-neutral-400 hover:text-red-400 transition-colors"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          )}
        </div>
        <div className="h-[44px] p-2 bg-neutral-900 border-t border-neutral-800/60 flex flex-col justify-center flex-shrink-0 w-full overflow-hidden">
          <p className="text-[10px] sm:text-[11px] font-medium truncate text-neutral-200 w-full leading-tight">{title}</p>
          <p className="text-[9px] text-neutral-500 mt-0.5 font-mono truncate">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}, (prev, next) => {
  return prev._rawItem?.id === next._rawItem?.id
    && prev._rawItem?._is_favorite === next._rawItem?._is_favorite
    && prev.onSelect === next.onSelect
    && prev.onToggleFavorite === next.onToggleFavorite
    && prev.itemWidth === next.itemWidth
    && prev.cardHeight === next.cardHeight
    && prev.isSelected === next.isSelected
    && prev.isDeleting === next.isDeleting
    && prev.isLeaving === next.isLeaving
    && prev.isEntering === next.isEntering
    && prev.slideX === next.slideX
    && prev.slideY === next.slideY
    && prev.selectMode === next.selectMode
    && prev.isPlaying === next.isPlaying;
});

export { PlaylistGridCard };
