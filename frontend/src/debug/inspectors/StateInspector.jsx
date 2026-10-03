import { useMemo } from 'react';

const STORE_REGISTRY = [
  { id: 'monitoringStore', file: 'monitoring/stores/monitoringStore.js', throttle: '1000ms', note: 'MetricsTable bypasses throttle' },
  { id: 'folderSortStore', file: 'store/folderSortStore.js', throttle: 'none', note: 'persisted localStorage' },
  { id: 'folderMetaSortStore', file: 'store/folderMetaSortStore.js', throttle: 'none', note: 'persisted localStorage' },
  { id: 'playbackStore', file: 'store/playbackStore.js', throttle: 'none', note: 'in-memory' },
  { id: 'playlistStore', file: 'store/playlistStore.js', throttle: 'none', note: 'persisted localStorage' },
];

let storeUpdateCounters = {};

export function registerStoreUpdate(storeId) {
  if (!storeUpdateCounters[storeId]) storeUpdateCounters[storeId] = 0;
  storeUpdateCounters[storeId]++;
}

export function getStoreUpdateCount(storeId) {
  return storeUpdateCounters[storeId] || 0;
}

export default function StateInspector() {
  const entries = useMemo(() => {
    return STORE_REGISTRY.map(s => ({
      ...s,
      updates: getStoreUpdateCount(s.id),
    }));
  }, []);

  return (
    <div className="text-xs font-mono space-y-1.5">
      <div className="text-neutral-400 mb-2 font-bold">ZUSTAND STORES</div>
      {entries.map(s => (
        <div key={s.id} className="text-neutral-300">
          <div className="flex justify-between">
            <span className="text-cyan-400">{s.id}</span>
            <span className="text-yellow-400">{s.updates} updates</span>
          </div>
          <div className="text-neutral-600 text-[10px]">{s.file}</div>
          <div className="text-neutral-600 text-[10px]">
            throttle: {s.throttle} | {s.note}
          </div>
        </div>
      ))}
    </div>
  );
}
