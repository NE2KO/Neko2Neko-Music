import { useState, useEffect } from 'react';
import useDebugStore from '../useDebugStore';
import { getMemoryInfo } from '../utils/memory';

export default function MemoryInspector() {
  const { activeLevels } = useDebugStore();
  const [memory, setMemory] = useState(() => getMemoryInfo());

  useEffect(() => {
    if (!activeLevels.includes(4)) return;
    const id = setInterval(() => {
      setMemory(getMemoryInfo());
    }, 2000);
    return () => clearInterval(id);
  }, [activeLevels]);

  if (!activeLevels.includes(4)) return null;
  if (!memory.available) return null;

  const usedMB = Math.round(memory.usedJSHeapSize / (1024 * 1024));
  const limitMB = Math.round(memory.jsHeapSizeLimit / (1024 * 1024));
  const totalMB = Math.round(memory.totalJSHeapSize / (1024 * 1024));

  return (
    <div className="fixed bottom-4 left-4 bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl p-3 text-xs font-mono z-[99999] min-w-[180px]">
      <div className="text-neutral-400 mb-2 font-bold">MEMORY</div>
      <div className="space-y-1 text-neutral-300">
        <div>
          <span className="text-neutral-500">USED:</span>{' '}
          <span className={usedMB > 500 ? 'text-red-400' : 'text-emerald-400'}>
            {usedMB} MB
          </span>
        </div>
        <div>
          <span className="text-neutral-500">ALLOCATED:</span>{' '}
          <span className="text-neutral-300">{totalMB} MB</span>
        </div>
        <div>
          <span className="text-neutral-500">LIMIT:</span>{' '}
          <span className="text-neutral-400">{limitMB} MB</span>
        </div>
        <div className="mt-1">
          <div className="w-full bg-neutral-700 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full ${usedMB > 500 ? 'bg-red-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min((usedMB / limitMB) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
