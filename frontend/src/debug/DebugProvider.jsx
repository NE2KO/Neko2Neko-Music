import { useEffect, useRef } from 'react';
import useDebugStore from './useDebugStore';
import DebugTooltip from './DebugTooltip';
import LayoutInspector from './inspectors/LayoutInspector';
import { scanAndInjectBadges, clearAllBadges } from './utils/dom';
import { removeLayoutStyles } from './utils/css';
import { startRouteTracking } from './utils/route';
import { registerStoreUpdate } from './inspectors/StateInspector';

function patchStore(storeId, store) {
  const originalSetState = store.setState;
  if (!originalSetState.__debugPatched) {
    store.setState = (updater, replace) => {
      registerStoreUpdate(storeId);
      return originalSetState(updater, replace);
    };
    originalSetState.__debugPatched = true;
  }
}

export default function DebugProvider({ children }) {
  const { enabled } = useDebugStore();
  const badgeIntervalRef = useRef(null);

  useEffect(() => {
    try {
      const monitoringStore = require('../../monitoring/stores/monitoringStore').default;
      patchStore('monitoringStore', monitoringStore);
    } catch (e) { /* store not found */ }

    try {
      const folderSortStore = require('../../store/folderSortStore').default;
      patchStore('folderSortStore', folderSortStore);
    } catch (e) { /* store not found */ }

    try {
      const folderMetaSortStore = require('../../store/folderMetaSortStore').default;
      patchStore('folderMetaSortStore', folderMetaSortStore);
    } catch (e) { /* store not found */ }

    try {
      const playbackStore = require('../../store/playbackStore').default;
      patchStore('playbackStore', playbackStore);
    } catch (e) { /* store not found */ }

    try {
      const playlistStore = require('../../store/playlistStore').default;
      patchStore('playlistStore', playlistStore);
    } catch (e) { /* store not found */ }

    startRouteTracking();

    return () => {
      clearAllBadges();
      removeLayoutStyles();
    };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        useDebugStore.getState().toggle();
      }
      if (e.key === 'Escape') {
        useDebugStore.getState().setSelectedElement(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    window.DEBUG_MODE = enabled;
    window.DEBUG_LEVEL = useDebugStore.getState().level;

    const unsub = useDebugStore.subscribe((state) => {
      window.DEBUG_MODE = state.enabled;
      window.DEBUG_LEVEL = state.level;
    });
    return unsub;
  }, [enabled]);

  useEffect(() => {
    const { activeLevels } = useDebugStore.getState();
    if (!activeLevels.includes(1)) {
      clearAllBadges();
      return;
    }

    scanAndInjectBadges();
    badgeIntervalRef.current = setInterval(scanAndInjectBadges, 3000);

    return () => {
      clearInterval(badgeIntervalRef.current);
      clearAllBadges();
    };
  }, [enabled]);

  if (!enabled) return <>{children}</>;

  return (
    <>
      {children}
      <DebugTooltip />
      <LayoutInspector forceEnable />
    </>
  );
}
