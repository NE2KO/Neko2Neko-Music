import { useState, useEffect, useCallback } from 'react';
import useDebugStore from './useDebugStore';

function getHierarchyPath(el) {
  const path = [];
  let current = el;
  while (current && current !== document.body) {
    if (current.dataset && current.dataset.debugId) {
      path.unshift({
        id: current.dataset.debugId,
        name: current.dataset.debugName || current.tagName.toLowerCase(),
      });
    }
    current = current.parentElement;
  }
  return path;
}

export default function DebugTooltip() {
  const { enabled, activeLevels } = useDebugStore();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [target, setTarget] = useState(null);
  const [path, setPath] = useState([]);

  const handleMouseMove = useCallback((e) => {
    if (!enabled || !activeLevels.includes(2)) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;

    const debugEl = el.closest('[data-debug-id]');
    if (debugEl) {
      const rect = debugEl.getBoundingClientRect();
      const isSmall = rect.width < 80 || rect.height < 40;

      setTarget({
        id: debugEl.dataset.debugId,
        name: debugEl.dataset.debugName || '',
        type: debugEl.dataset.debugType || 'other',
        isSmall,
      });
      setPath(getHierarchyPath(debugEl));

      let x = e.clientX + 12;
      let y = e.clientY + 12;

      if (x + 200 > window.innerWidth) x = e.clientX - 200;
      if (y + 80 > window.innerHeight) y = e.clientY - 80;

      setPos({ x, y });
      setVisible(true);
    } else {
      setVisible(false);
      setTarget(null);
    }
  }, [enabled, activeLevels]);

  const handleMouseLeave = useCallback(() => {
    setVisible(false);
    setTarget(null);
  }, []);

  useEffect(() => {
    if (!enabled || !activeLevels.includes(2)) {
      setVisible(false);
      return;
    }

    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [enabled, activeLevels, handleMouseMove, handleMouseLeave]);

  if (!visible || !target) return null;

  if (target.isSmall) {
    return (
      <div
        className="fixed z-[100002] pointer-events-none bg-neutral-900/95 border border-neutral-700 rounded px-1.5 py-0.5 text-[9px] font-mono"
        style={{ left: pos.x, top: pos.y }}
      >
        <span className="text-emerald-400">{target.id}</span>
        <span className="text-neutral-500 ml-1">{target.name}</span>
      </div>
    );
  }

  return (
    <div
      className="fixed z-[100002] pointer-events-none bg-neutral-900/95 border border-neutral-700 rounded-lg shadow-2xl p-2 text-[10px] font-mono max-w-[250px]"
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-emerald-400 font-bold">[{target.id}]</span>
        <span className="text-white">{target.name}</span>
      </div>
      {path.length > 1 && (
        <div className="text-neutral-500 border-t border-neutral-700 pt-1 mt-1">
          {path.map((p, i) => (
            <span key={i}>
              {i > 0 && <span className="text-neutral-700"> &gt; </span>}
              <span className="text-neutral-400">{p.id}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
