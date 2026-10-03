import { useEffect } from 'react';
import useDebugStore from './useDebugStore';

export default function DebugBadge({ debugId, debugName }) {
  const { activeLevels } = useDebugStore();
  const showBadge = activeLevels.includes(1);

  useEffect(() => {
    if (!showBadge) return;
  }, [showBadge]);

  return null;
}
