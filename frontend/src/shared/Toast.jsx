import { useState, useCallback, useRef, useEffect } from 'react';

const TOAST_DEFAULTS = {
  duration: 4000,
  types: {
    success: { bg: 'bg-green-600/90', border: 'border-green-500/40', icon: 'CheckCircle' },
    error: { bg: 'bg-red-600/90', border: 'border-red-500/40', icon: 'XCircle' },
    warning: { bg: 'bg-amber-600/90', border: 'border-amber-500/40', icon: 'AlertTriangle' },
    info: { bg: 'bg-sky-600/90', border: 'border-sky-500/40', icon: 'Info' },
  },
};

let toastId = 0;

export function useToast() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const removeToast = useCallback((id) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message, type = 'info', duration = TOAST_DEFAULTS.duration) => {
    const id = ++toastId;
    const toast = { id, message, type, duration, createdAt: Date.now() };
    setToasts(prev => [...prev, toast]);
    timers.current[id] = setTimeout(() => removeToast(id), duration);
    return id;
  }, [removeToast]);

  useEffect(() => {
    return () => {
      Object.values(timers.current).forEach(clearTimeout);
    };
  }, []);

  return { toasts, showToast, removeToast };
}

export default function ToastContainer({ toasts, removeToast, maxVisible = 3 }) {
  const visible = toasts.slice(-maxVisible);
  if (visible.length === 0) return null;

  return (
    <div
      className="fixed z-[60] pointer-events-none toast-desktop-right"
      data-debug-id="X.2"
      data-debug-name="ToastContainer"
      data-debug-type="overlay"
      style={{
        bottom: 'max(calc(80px + env(safe-area-inset-bottom, 0px)), 5rem)',
        // Fill from left on mobile; no reserved space (upload is in bottom bar now).
        left: 'calc(env(safe-area-inset-left, 0px) + 8px)',
        right: 'calc(env(safe-area-inset-right, 0px) + 8px)',
      }}
    >
      <div className="flex flex-col-reverse gap-2 w-full sm:max-w-sm sm:ml-auto">
        {visible.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </div>
      {/* Desktop override: allow toasts on the far right */}
      <style>{`
        @media (min-width: 640px) {
          .toast-desktop-right {
            left: auto !important;
            right: calc(env(safe-area-inset-right, 0px) + 16px) !important;
          }
        }
      `}</style>
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  const [exiting, setExiting] = useState(false);
  const style = TOAST_DEFAULTS.types[toast.type] || TOAST_DEFAULTS.types.info;

  const handleDismiss = () => {
    setExiting(true);
    setTimeout(onDismiss, 200);
  };

  useEffect(() => {
    const t = setTimeout(() => setExiting(true), toast.duration - 200);
    return () => clearTimeout(t);
  }, [toast.duration]);

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg border shadow-lg
        ${style.bg} ${style.border} backdrop-blur-md text-white text-xs
        transition-all duration-200 ease-out
        ${exiting ? 'opacity-0 translate-y-2 scale-95' : 'opacity-100 translate-y-0 scale-100'}`}
      role="alert"
    >
      <Icon name={style.icon} className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <span className="flex-1 min-w-0 leading-relaxed break-words">{toast.message}</span>
      <button onClick={handleDismiss}
        className="flex-shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors opacity-60 hover:opacity-100">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function Icon({ name, className }) {
  const icons = {
    CheckCircle: <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>,
    XCircle: <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>,
    AlertTriangle: <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
    Info: <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>,
  };
  return icons[name] || icons.Info;
}
