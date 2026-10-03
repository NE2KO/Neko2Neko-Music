import { useState, useEffect } from 'react';
import useDebugStore from '../useDebugStore';

export default function PerformanceInspector() {
  const { selectedElement, activeLevels, renderCounts, lastRenderTime, mountCounts, unmountCounts } = useDebugStore();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!activeLevels.includes(4)) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [activeLevels]);

  if (!activeLevels.includes(4)) return null;
  if (!selectedElement) return null;

  const attrs = selectedElement.dataset;
  const debugId = attrs.debugId;
  if (!debugId) return null;

  const count = renderCounts.get(debugId) || 0;
  const mounts = mountCounts.get(debugId) || 0;
  const unmounts = unmountCounts.get(debugId) || 0;
  const lastTime = lastRenderTime.get(debugId);
  const updateRate = lastTime && (now - lastTime) > 0
    ? (1000 / (now - lastTime)).toFixed(1)
    : '0';
  const isHighRate = count > 100 && parseFloat(updateRate) > 5;

  return (
    <div className="fixed bottom-4 right-4 bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl p-3 text-xs font-mono z-[99999] max-w-[260px]">
      <div className="text-neutral-400 mb-2 font-bold">PERFORMANCE</div>
      <div className="space-y-1 text-neutral-300">
        <div>
          <span className="text-neutral-500">ID:</span>{' '}
          <span className="text-emerald-400">{debugId}</span>
        </div>
        <div>
          <span className="text-neutral-500">NAME:</span>{' '}
          <span className="text-white">{attrs.debugName || '\u2014'}</span>
        </div>
        <div>
          <span className="text-neutral-500">RENDER COUNT:</span>{' '}
          <span className={count > 200 ? 'text-red-400' : count > 50 ? 'text-yellow-400' : 'text-neutral-300'}>
            {count}
          </span>
        </div>
        <div>
          <span className="text-neutral-500">MOUNTED:</span>{' '}
          <span className="text-neutral-300">{mounts}</span>
        </div>
        <div>
          <span className="text-neutral-500">UNMOUNTED:</span>{' '}
          <span className="text-neutral-300">{unmounts}</span>
        </div>
        <div>
          <span className="text-neutral-500">UPDATE RATE:</span>{' '}
          <span className={isHighRate ? 'text-red-400' : 'text-neutral-300'}>
            {updateRate}/s
          </span>
        </div>
        {lastTime && (
          <div>
            <span className="text-neutral-500">LAST RENDER:</span>{' '}
            <span className="text-neutral-400">
              {new Date(lastTime).toLocaleTimeString()}
            </span>
          </div>
        )}
        {isHighRate && (
          <div className="mt-1 px-2 py-1 bg-red-900/50 border border-red-700 rounded text-red-300 font-bold animate-pulse">
            HIGH RENDER RATE
          </div>
        )}
      </div>
    </div>
  );
}
