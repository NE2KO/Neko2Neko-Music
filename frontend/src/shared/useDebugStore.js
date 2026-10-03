import { create } from 'zustand';

let renderCounts = new Map();
let lastRenderTime = new Map();
let mountCounts = new Map();
let unmountCounts = new Map();

const useDebugStore = create((set, get) => ({
  enabled: false,
  level: 0,
  activeLevels: [],

  selectedElement: null,
  inspectorPos: { x: 20, y: 20 },
  setSelectedElement: (el) => set({ selectedElement: el }),
  setInspectorPos: (pos) => set({ inspectorPos: pos }),

  renderCounts,
  lastRenderTime,
  mountCounts,
  unmountCounts,

  currentRoute: '',
  zIndexMode: false,

  toggle: () => set(s => {
    if (!s.enabled) {
      return { enabled: true, level: 2, activeLevels: [1, 2] };
    }
    return { enabled: false, level: 0, activeLevels: [] };
  }),
  setLevel: (lvl) => {
    const levels = [];
    for (let i = 1; i <= lvl; i++) levels.push(i);
    set({ level: lvl, activeLevels: levels });
  },
  enableZIndex: () => set({ zIndexMode: true }),
  disableZIndex: () => set({ zIndexMode: false }),

  trackRender: (debugId) => {
    renderCounts.set(debugId, (renderCounts.get(debugId) || 0) + 1);
    lastRenderTime.set(debugId, Date.now());
  },
  trackMount: (debugId) => {
    mountCounts.set(debugId, (mountCounts.get(debugId) || 0) + 1);
  },
  trackUnmount: (debugId) => {
    unmountCounts.set(debugId, (unmountCounts.get(debugId) || 0) + 1);
  },
  resetTracking: () => {
    renderCounts = new Map();
    lastRenderTime = new Map();
    mountCounts = new Map();
    unmountCounts = new Map();
    set({});
  },
}));

export default useDebugStore;
