import { useEffect } from 'react';
import useDebugStore from './useDebugStore';

export default function useDebugTrack(debugId, debugName) {
  const { activeLevels, trackRender, trackMount, trackUnmount } = useDebugStore();

  useEffect(() => {
    if (!activeLevels.includes(4)) return;
    trackRender(debugId);
  });

  useEffect(() => {
    if (!activeLevels.includes(4)) return;
    trackMount(debugId);
    return () => trackUnmount(debugId);
  }, [debugId, trackMount, trackUnmount]);
}
