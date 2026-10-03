import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useFolderSortStore = create(
  persist(
    (set, get) => ({
      folderSortState: {},

      getSort: (path) => {
        const state = get().folderSortState;
        return state[path] || 'all';
      },

      setSort: (path, sort) => {
        set(state => ({
          folderSortState: { ...state.folderSortState, [path]: sort }
        }));
      },

      clearAll: () => set({ folderSortState: {} }),
    }),
    {
      name: 'folderSortState',
    }
  )
);

export default useFolderSortStore;