import { useState, useEffect, useRef } from 'react';
import useDebugStore from '../useDebugStore';

export default function EventInspector() {
  const { activeLevels } = useDebugStore();
  const countRef = useRef(0);
  const [count, setCount] = useState(0);
  const [lastEvents, setLastEvents] = useState([]);

  useEffect(() => {
    if (!activeLevels.includes(4)) return;

    const events = ['click', 'scroll', 'keydown'];
    let lastUpdate = Date.now();

    const handler = (e) => {
      countRef.current++;
      setLastEvents(prev => {
        const next = [...prev, { type: e.type, ts: Date.now() }];
        return next.slice(-5);
      });

      const now = Date.now();
      if (now - lastUpdate > 500) {
        lastUpdate = now;
        setCount(countRef.current);
      }
    };

    events.forEach(evt => {
      window.addEventListener(evt, handler, { passive: true });
    });

    return () => {
      events.forEach(evt => {
        window.removeEventListener(evt, handler);
      });
    };
  }, [activeLevels]);

  if (!activeLevels.includes(4)) return null;

  if (count > 500) {
    return (
      <div className="fixed bottom-4 left-4 bg-red-900/90 border border-red-500 rounded-lg p-3 text-xs font-mono z-[100000]">
        <div className="text-red-300 font-bold animate-pulse">EVENT SPIKE WARNING</div>
        <div className="text-red-200">{count} events in this session</div>
        <div className="text-neutral-400 mt-1">Last: {lastEvents.map(e => e.type).join(', ') || 'none'}</div>
      </div>
    );
  }

  return null;
}
