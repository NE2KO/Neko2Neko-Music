import { useMemo } from 'react';
import useDebugStore from '../useDebugStore';

export default function ZIndexInspector() {
  const { zIndexMode } = useDebugStore();

  const zIndexedElements = useMemo(() => {
    if (!zIndexMode) return [];
    const elements = [];
    document.querySelectorAll('*').forEach(el => {
      const z = window.getComputedStyle(el).zIndex;
      if (z && z !== 'auto' && parseInt(z) > 0) {
        const attrs = el.dataset;
        if (attrs && attrs.debugId) {
          elements.push({
            id: attrs.debugId,
            name: attrs.debugName || el.tagName.toLowerCase(),
            z,
          });
        }
      }
    });
    elements.sort((a, b) => parseInt(b.z) - parseInt(a.z));
    return elements;
  }, [zIndexMode]);

  if (!zIndexMode) return null;

  return (
    <div className="fixed top-16 right-4 bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl p-3 text-xs font-mono z-[100000] max-h-[60vh] overflow-y-auto min-w-[200px]">
      <div className="text-neutral-400 mb-2 font-bold">Z-INDEX STACK</div>
      <div className="space-y-1">
        {zIndexedElements.map((el, i) => (
          <div key={i} className="flex justify-between text-neutral-300">
            <span className="text-emerald-400">[{el.id}]</span>
            <span className="text-white truncate max-w-[120px]">{el.name}</span>
            <span className="text-yellow-400">z:{el.z}</span>
          </div>
        ))}
        {zIndexedElements.length === 0 && (
          <div className="text-neutral-600">No debugged elements with z-index</div>
        )}
      </div>
    </div>
  );
}
