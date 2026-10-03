import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const buildShuffleOrder = (queue) => {
  if (!queue || queue.length === 0) return [];
  const order = queue.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
};

const usePlaybackStore = create(
  persist(
    (set, get) => ({
      // Playback state
      queue: [],
      currentTrackIndex: 0,
      isPlaying: false,
      videoPlaying: false,
      shuffle: false,
      loopMode: 'off',
      playerMode: 'full',
      position: 0,

      // Shuffle state: fixed shuffled order of queue indices.
      shuffleOrder: [],
      shufflePosition: -1,

      // Playlist mode
      hasPlaylist: false,
      playlistId: null,
      playlistTracks: [],
      activePlaybackId: null,

      // Shared audio element ref
      audioRef: null,

      // Actions
      setQueue: (queue, startIndex = 0) => set({
        queue,
        currentTrackIndex: startIndex,
        hasPlaylist: queue.length > 0,
        position: 0,
        shuffleOrder: [],
        shufflePosition: -1,
      }),

      play: () => set({ isPlaying: true }),
      pause: () => set({ isPlaying: false }),
      togglePlay: () => set(s => ({ isPlaying: !s.isPlaying })),

      setVideoPlaying: (v) => set({ videoPlaying: v }),

      setCurrentTrackIndex: (index) => set({ currentTrackIndex: index, position: 0 }),

      next: () => {
        const { queue, currentTrackIndex, loopMode, shuffle, shuffleOrder, shufflePosition } = get();
        if (queue.length === 0) return;

        if (shuffle && shuffleOrder.length === queue.length) {
          const len = shuffleOrder.length;
          const nextPos = shufflePosition + 1;
          if (nextPos >= len) {
            if (loopMode === 'all') {
              set({ currentTrackIndex: shuffleOrder[0], shufflePosition: 0, isPlaying: true, position: 0 });
            } else if (loopMode === 'one') {
              set({ isPlaying: true, position: 0 });
            } else {
              set({ isPlaying: false });
            }
            return;
          }
          set({ currentTrackIndex: shuffleOrder[nextPos], shufflePosition: nextPos, isPlaying: true, position: 0 });
          return;
        }

        if (loopMode === 'off' && currentTrackIndex === queue.length - 1) {
          set({ isPlaying: false });
          return;
        }

        const nextIndex = (currentTrackIndex + 1) % queue.length;
        set({ currentTrackIndex: nextIndex, isPlaying: true, position: 0 });
      },

      previous: () => {
        const { queue, currentTrackIndex, loopMode, shuffle, shuffleOrder, shufflePosition } = get();
        if (queue.length === 0) return;

        if (shuffle && shuffleOrder.length === queue.length) {
          const len = shuffleOrder.length;
          const prevPos = shufflePosition - 1;
          if (prevPos < 0) {
            if (loopMode === 'all') {
              set({ currentTrackIndex: shuffleOrder[len - 1], shufflePosition: len - 1, isPlaying: true, position: 0 });
            } else if (loopMode === 'one') {
              set({ isPlaying: true, position: 0 });
            } else {
              set({ isPlaying: false });
            }
            return;
          }
          set({ currentTrackIndex: shuffleOrder[prevPos], shufflePosition: prevPos, isPlaying: true, position: 0 });
          return;
        }

        if (loopMode === 'off' && currentTrackIndex === 0) {
          set({ isPlaying: false });
          return;
        }

        const prevIndex = currentTrackIndex === 0 ? queue.length - 1 : currentTrackIndex - 1;
        set({ currentTrackIndex: prevIndex, isPlaying: true, position: 0 });
      },

      setActivePlaylist: (playlistId, playlist, tracks) => set({
        playlistId,
        playlistTracks: tracks || [],
        hasPlaylist: true,
      }),

      clearPlayback: () => {
        console.log('[store] clearPlayback CALLED');
        set({
          queue: [],
          currentTrackIndex: 0,
          isPlaying: false,
          hasPlaylist: false,
          playlistId: null,
          playlistTracks: [],
          activePlaybackId: null,
          playerMode: 'full',
          position: 0,
          shuffle: false,
          shuffleOrder: [],
          shufflePosition: -1,
        });
      },

      setActiveFile: (fileId) => set({ activePlaybackId: fileId }),

      setShuffle: (shuffle) => set((state) => {
        if (shuffle && !state.shuffle) {
          const order = buildShuffleOrder(state.queue);
          const startPos = order.indexOf(state.currentTrackIndex);
          return {
            shuffle: true,
            shuffleOrder: order,
            shufflePosition: startPos >= 0 ? startPos : 0,
          };
        }
        if (!shuffle && state.shuffle) {
          return {
            shuffle: false,
            shuffleOrder: [],
            shufflePosition: -1,
          };
        }
        return { shuffle };
      }),
      setLoopMode: (mode) => set({ loopMode: mode }),

      setPlayerMode: (mode) => set({ playerMode: mode }),
      setPosition: (position) => set({ position }),

      setAudioRef: (ref) => set({ audioRef: ref }),
    }),
    {
      name: 'playbackStore',
      partialize: (state) => ({
        shuffle: state.shuffle,
        loopMode: state.loopMode,
        playerMode: state.playerMode,
        currentTrackIndex: state.currentTrackIndex,
        activePlaybackId: state.activePlaybackId,
        position: state.position,
      }),
    }
  )
);

export default usePlaybackStore;
