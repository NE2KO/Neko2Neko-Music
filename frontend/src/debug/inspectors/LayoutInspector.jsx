import { useEffect } from 'react';
import useDebugStore from '../useDebugStore';
import { injectLayoutStyles, removeLayoutStyles } from '../utils/css';

export default function LayoutInspector({ forceEnable }) {
  const { enabled } = useDebugStore();

  useEffect(() => {
    if (enabled || forceEnable) {
      injectLayoutStyles();
    } else {
      removeLayoutStyles();
    }
    return () => removeLayoutStyles();
  }, [enabled, forceEnable]);

  return null;
}
