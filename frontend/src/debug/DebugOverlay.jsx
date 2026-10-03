import HierarchyInspector from './inspectors/HierarchyInspector';
import RealtimeInspector from './inspectors/RealtimeInspector';
import MemoryInspector from './inspectors/MemoryInspector';
import WebSocketInspector from './inspectors/WebSocketInspector';
import useDebugStore from './useDebugStore';
import { X } from 'lucide-react';

export default function DebugOverlay() {
  const { activeLevels, setSelectedElement } = useDebugStore();

  return (
    <>
      {/* Close button when inspector is active */}
      {activeLevels.includes(2) && (
        <div className="fixed top-2 right-2 z-[100001]">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedElement(null);
            }}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-neutral-400 border border-neutral-700"
            title="Close inspector (ESC)"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {activeLevels.includes(2) && <HierarchyInspector />}
      {activeLevels.includes(4) && <RealtimeInspector />}
      {activeLevels.includes(4) && <MemoryInspector />}
      {activeLevels.includes(4) && <WebSocketInspector />}
    </>
  );
}
