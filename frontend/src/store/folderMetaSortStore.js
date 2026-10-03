import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useFolderMetaSortStore = create(
  persist(
    (set, get) => ({
      sortState: {},

      getSort: (path) => {
        const state = get().sortState;
        return state[path] || { sortBy: null, sortOrder: 'asc' };
      },

      setSort: (path, sortBy, sortOrder) => {
        set(s => ({
          sortState: {
            ...s.sortState,
            [path]: { sortBy, sortOrder },
          },
        }));
      },

      clearAll: () => set({ sortState: {} }),
    }),
    {
      name: 'folderMetaSortState',
    }
  )
);

export default useFolderMetaSortStore;
