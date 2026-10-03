import React, { useState, useEffect } from 'react';
import { Music, WifiOff, RefreshCw } from 'lucide-react';

// Image that survives transient network loss (e.g. wifi toggled off then on).
// - While offline or after a load error it shows a clear fallback (not a broken
//   image icon), with an optional manual retry.
// - On the browser `online` event it automatically re-requests the source.
// `className` is applied to BOTH the <img> and the fallback <div> so layout
// (e.g. absolute inset-0) is preserved in either state.
export default function NetworkImage({
  src,
  alt = '',
  className = '',
  style,
  showRetry = true,
  offlineHint = 'Offline',
  retryLabel = 'Coba lagi',
  icon: Icon = Music,
}) {
  const [errored, setErrored] = useState(false);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const goOnline = () => { setOnline(true); setErrored(false); setNonce((n) => n + 1); };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Reset when the source itself changes (track skip, new cover, etc.)
  useEffect(() => { setErrored(false); setNonce((n) => n + 1); }, [src]);

  const retry = () => { setErrored(false); setNonce((n) => n + 1); };

  if (errored || !online) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={style}>
        <div className="flex flex-col items-center justify-center gap-1 text-neutral-500">
          {!online ? <WifiOff size={20} /> : <Icon size={20} className="opacity-60" />}
          {!online && <span className="text-[10px] leading-none">{offlineHint}</span>}
          {errored && online && showRetry && (
            <button
              type="button"
              onClick={retry}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-neutral-800/80 border border-neutral-700 text-neutral-300 hover:text-white"
            >
              <RefreshCw size={11} /> {retryLabel}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <img
      key={nonce}
      src={src}
      alt={alt}
      className={className}
      style={style}
      decoding="async"
      onError={() => setErrored(true)}
      onLoad={() => setErrored(false)}
    />
  );
}
