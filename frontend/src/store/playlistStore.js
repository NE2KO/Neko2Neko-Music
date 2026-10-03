import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const usePlaylistStore = create(
  persist(
    (set, get) => ({
      // Playlist state
      playlists: [],
      currentPlaylist: null,
      currentPlaylistTracks: [],
      loading: false,
      error: null,
      
      // Actions
      setPlaylists: (playlistsOrFn) => set((state) => ({
        playlists: typeof playlistsOrFn === 'function' ? playlistsOrFn(state.playlists) : playlistsOrFn,
      })),
      
      setCurrentPlaylist: (playlist) => set({ currentPlaylist: playlist }),
      
      setCurrentPlaylistTracks: (tracks) => set({ currentPlaylistTracks: tracks }),
      
      setLoading: (loading) => set({ loading }),
      
      setError: (error) => set({ error }),
      
      clearCurrentPlaylist: () => set({ 
        currentPlaylist: null, 
        currentPlaylistTracks: [] 
      }),

      // Reset only detail state (keeps playlist list intact)
      clearPlaylistDetail: () => set({
        currentPlaylist: null,
        currentPlaylistTracks: [],
      }),

      // Add playlist to list
      addPlaylist: (playlist) => {
        const current = get().playlists;
        set({ playlists: [...current, playlist] });
      },

      // Remove playlist from list
      removePlaylist: (id) => {
        const current = get().playlists;
        set({ playlists: current.filter(p => p.id !== id) });
      },

      // Update playlist in list
      updatePlaylist: (id, updates) => {
        const current = get().playlists;
        set({ 
          playlists: current.map(p => 
            p.id === id ? { ...p, ...updates } : p
          ) 
        });
      },

      // Clear all playlists
      clearAll: () => set({ 
        playlists: [],
        currentPlaylist: null,
        currentPlaylistTracks: [],
        loading: false,
        error: null,
      }),
    }),
    {
      name: 'playlistStore',
      partialize: (state) => ({
        playlists: state.playlists,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...persistedState,
        playlists: Array.isArray(persistedState?.playlists)
          ? persistedState.playlists
          : currentState.playlists,
      }),
    }
  )
);

export default usePlaylistStore;