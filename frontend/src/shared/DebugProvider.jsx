import { useEffect, useRef } from 'react';
import useDebugStore from './useDebugStore';

export default function DebugProvider({ children }) {
  const { enabled } = useDebugStore();

  useEffect(() => {
    window.DEBUG_MODE = enabled;
    window.DEBUG_LEVEL = useDebugStore.getState().level;

    const unsub = useDebugStore.subscribe((state) => {
      window.DEBUG_MODE = state.enabled;
      window.DEBUG_LEVEL = state.level;
    });
    return unsub;
  }, [enabled]);

  if (!enabled) return <>{children}</>;

  return <>{children}</>;
}
