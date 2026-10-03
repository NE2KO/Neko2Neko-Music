import { create } from 'zustand';

// Single source of truth for favorite (love) status across every surface that
// shows audio/video/image items: the full AudioPlayer, the MiniPlayer, the
// Carousel strip, the QueuePanel list, and the MediaGrid. Components read
// `useIsFavorite(id, fallback)` and toggle via App's `handleToggleFavorite`,
// which seeds this store so all surfaces re-render in sync.
const useFavoritesStore = create((set) => ({
  // fileId -> 1 | 0
  map: {},
  set: (fileId, val) =>
    set((s) => ({ map: { ...s.map, [fileId]: val } })),
}));

// `fallback` is the prop-fed initial is_favorite (so we don't need to reseed
// the store on every data load). Once the user toggles, the store entry wins.
export function useIsFavorite(fileId, fallback = 0) {
  const v = useFavoritesStore((s) => s.map[fileId]);
  return (v == null ? fallback : v) === 1;
}

export default useFavoritesStore;
