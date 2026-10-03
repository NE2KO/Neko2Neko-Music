import { useState, useCallback } from 'react';
import useDebugStore from '../useDebugStore';
import { getDebugAttributes, getParentInfo, getElementSize, countDebugChildren } from '../utils/dom';
import { getCurrentRoute } from '../utils/route';
import { getVirtualizationInfo } from '../utils/virtualization';
import { X, Move } from 'lucide-react';

export default function HierarchyInspector() {
  const { selectedElement, setSelectedElement, inspectorPos, setInspectorPos } = useDebugStore();
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e) => {
    setDragging(true);
    setDragStart({ x: e.clientX - inspectorPos.x, y: e.clientY - inspectorPos.y });
  }, [inspectorPos]);

  const handleMouseMove = useCallback((e) => {
    if (!dragging) return;
    setInspectorPos({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  }, [dragging, dragStart, setInspectorPos]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  if (!selectedElement) return null;

  const attrs = getDebugAttributes(selectedElement);
  const parent = getParentInfo(selectedElement);
  const size = getElementSize(selectedElement);
  const route = getCurrentRoute();
  const childCount = countDebugChildren(selectedElement);

  const virtInfo = getVirtualizationInfo();
  const isVirtualized = attrs?.id === '1.1.6' || attrs?.id === '2.3.4';
  const virtData = attrs?.id === '1.1.6'
    ? virtInfo.mediaGrid
    : attrs?.id === '2.3.4'
    ? virtInfo.metricsTable
    : null;

  const handleContentClick = (e) => e.stopPropagation();

  return (
    <>
      {dragging && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 99998 }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        />
      )}
      <div
        className="fixed bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl p-3 text-xs font-mono z-[99999] min-w-[220px]"
        style={{ left: inspectorPos.x, top: inspectorPos.y }}
        onClick={handleContentClick}
      >
        <div
          className="flex items-center justify-between mb-2 cursor-move select-none"
          onMouseDown={handleMouseDown}
        >
          <span className="text-neutral-400 flex items-center gap-1">
            <Move size={10} /> DEBUG INSPECTOR
          </span>
          <button
            onClick={() => setSelectedElement(null)}
            className="text-neutral-500 hover:text-white"
          >
            <X size={12} />
          </button>
        </div>

        <div className="space-y-1.5 text-neutral-300">
          <div>
            <span className="text-neutral-500">ID:</span>{' '}
            <span className="text-emerald-400">{attrs?.id || '\u2014'}</span>
          </div>
          <div>
            <span className="text-neutral-500">NAME:</span>{' '}
            <span className="text-white">{attrs?.name || '\u2014'}</span>
          </div>
          <div>
            <span className="text-neutral-500">TYPE:</span>{' '}
            <span className="text-cyan-400">{attrs?.type || 'other'}</span>
          </div>
          <div>
            <span className="text-neutral-500">PARENT:</span>{' '}
            <span className="text-neutral-400">{parent}</span>
          </div>
          <div>
            <span className="text-neutral-500">ROUTE:</span>{' '}
            <span className="text-yellow-400">{route}</span>
          </div>
          <div>
            <span className="text-neutral-500">SIZE:</span>{' '}
            <span className="text-neutral-300">
              {size.width} \u00d7 {size.height}
            </span>
          </div>
          <div>
            <span className="text-neutral-500">CHILDREN:</span>{' '}
            <span className="text-neutral-300">{childCount}</span>
          </div>

          {isVirtualized && virtData && (
            <>
              <div className="border-t border-neutral-700 pt-1.5 mt-1.5">
                <span className="text-neutral-500">VIRTUALIZED:</span>{' '}
                <span className="text-purple-400">YES</span>
              </div>
              <div>
                <span className="text-neutral-500">VISIBLE:</span>{' '}
                <span className="text-neutral-300">{virtData.visible || '?'}</span>
              </div>
              <div>
                <span className="text-neutral-500">RENDERED:</span>{' '}
                <span className="text-neutral-300">{virtData.rendered || '?'}</span>
              </div>
              <div>
                <span className="text-neutral-500">TOTAL:</span>{' '}
                <span className="text-neutral-300">{virtData.total || '?'}</span>
              </div>
              {virtData.scrollPercent !== undefined && (
                <div>
                  <span className="text-neutral-500">SCROLL:</span>{' '}
                  <span className="text-neutral-300">{virtData.scrollPercent}%</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
