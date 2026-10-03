import { useMemo } from 'react';
import useMonitoringStore from '../../monitoring/stores/monitoringStore';

const REALTIME_COMPONENTS = [
  { id: '2.2.6', name: 'CpuWidget' },
  { id: '2.2.7', name: 'MemoryWidget' },
  { id: '2.2.8', name: 'DiskWidget' },
  { id: '2.2.9', name: 'GpuWidget' },
  { id: '2.2.10', name: 'NetworkWidget' },
  { id: '2.10.5', name: 'LogTerminal' },
  { id: '2.3.3', name: 'MetricChart' },
];

export default function RealtimeInspector() {
  const connected = useMonitoringStore(s => s.connected);
  const refreshInterval = useMonitoringStore(s => s.refreshIntervalMs);

  const entries = useMemo(() => {
    return REALTIME_COMPONENTS.map(c => {
      let interval;
      if (c.id === '2.10.5') interval = 'SSE stream';
      else if (c.id === '2.3.3') interval = 'HTTP 30s';
      else interval = connected ? `WS ${refreshInterval}ms` : 'disconnected';
      return { ...c, interval };
    });
  }, [connected, refreshInterval]);

  return (
    <div className="text-xs font-mono space-y-1.5">
      <div className="text-neutral-400 mb-2 font-bold">REALTIME FEED</div>
      {entries.map(e => (
        <div key={e.id} className="flex justify-between text-neutral-300">
          <span>
            <span className="text-emerald-400">[{e.id}]</span> {e.name}
          </span>
          <span className={connected ? 'text-green-400' : 'text-red-400'}>
            {e.interval}
          </span>
        </div>
      ))}
    </div>
  );
}
