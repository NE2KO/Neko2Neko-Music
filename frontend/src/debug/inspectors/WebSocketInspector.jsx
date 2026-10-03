import { useState, useEffect } from 'react';
import useDebugStore from '../useDebugStore';
import { getWsInfo, getSseInfo } from '../utils/websocket';

export default function WebSocketInspector() {
  const { activeLevels } = useDebugStore();
  const [wsInfo, setWsInfo] = useState(() => getWsInfo());
  const [sseInfo, setSseInfo] = useState(() => getSseInfo());

  useEffect(() => {
    if (!activeLevels.includes(4)) return;
    const id = setInterval(() => {
      setWsInfo(getWsInfo());
      setSseInfo(getSseInfo());
    }, 1000);
    return () => clearInterval(id);
  }, [activeLevels]);

  if (!activeLevels.includes(4)) return null;

  return (
    <div className="fixed bottom-4 left-4 bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl p-3 text-xs font-mono z-[99999] min-w-[220px]">
      <div className="text-neutral-400 mb-2 font-bold">CONNECTIONS</div>
      <div className="space-y-2">
        <div className="text-neutral-300">
          <div className="flex justify-between">
            <span className="text-cyan-400">WebSocket</span>
            <span className={wsInfo.connected ? 'text-green-400' : 'text-red-400'}>
              {wsInfo.connected ? 'connected' : 'disconnected'}
            </span>
          </div>
          <div className="text-neutral-600 text-[10px]">
            messages: {wsInfo.messageCount}
          </div>
          {wsInfo.lastMessage && (
            <div className="text-neutral-600 text-[10px]">
              last: {wsInfo.lastMessage.type} @ {new Date(wsInfo.lastMessage.ts).toLocaleTimeString()}
            </div>
          )}
        </div>

        <div className="text-neutral-300 border-t border-neutral-700 pt-2">
          <span className="text-cyan-400">SSE Endpoints</span>
          {Object.keys(sseInfo).length === 0 ? (
            <div className="text-neutral-600 text-[10px]">no activity</div>
          ) : (
            Object.entries(sseInfo).map(([endpoint, data]) => (
              <div key={endpoint} className="text-neutral-600 text-[10px]">
                {endpoint}: {data.count} events
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
