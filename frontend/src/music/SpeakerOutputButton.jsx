import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, Check, ChevronDown } from 'lucide-react';
import { useToast } from '../shared/Toast';
import {
  isOutputRoutingSupported,
  getStoredDevice,
  storeDevice,
  pickOutputDevice,
  listOutputDevices,
  applySink,
} from '../utils/audioOutput';

// Speaker / audio-output selector. Sits next to the Now Playing / Queue control.
// Routes the shared <audio> element to a chosen output device via setSinkId.
export default function SpeakerOutputButton({ audioRef }) {
  const { showToast } = useToast();
  const supported = isOutputRoutingSupported();
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState([]);
  const [current, setCurrent] = useState(() => getStoredDevice());
  const wrapRef = useRef(null);

  const refresh = useCallback(async () => {
    setDevices(await listOutputDevices());
  }, []);

  // Reveal audio-output device IDs/labels. Modern Chromium unlocks these via the
  // `speaker-selection` permission (or the native picker), so no microphone prompt
  // is needed. Wrapped in try/catch: unsupported browsers throw and the native
  // "Pilih speaker…" picker still works without it.
  const ensurePermission = useCallback(async () => {
    try {
      if (navigator.permissions?.query) {
        await navigator.permissions.query({ name: 'speaker-selection' });
      }
    } catch {
      /* unsupported / denied — native picker may still work */
    }
  }, []);

  const onToggle = useCallback(async () => {
    if (!open) {
      await ensurePermission();
      refresh();
    }
    setOpen((o) => !o);
  }, [open, ensurePermission, refresh]);

  useEffect(() => {
    if (open && supported) refresh();
  }, [open, supported, refresh]);

  // Keep the list fresh and fall back to default if the chosen device vanishes.
  // Be conservative: a `devicechange` can fire with labels/IDs momentarily
  // unavailable (e.g. before permission is re-granted). Do NOT clear the stored
  // preference on a transient absence — keep it so App's enforceSink re-asserts
  // the device once it reappears. We only fall back to default output for now,
  // while preserving the user's choice. (Explicit "System default" still clears
  // the preference via selectDevice(null).)
  useEffect(() => {
    if (!supported) return undefined;
    const onChange = async () => {
      const list = await listOutputDevices();
      setDevices(list);
      const stored = getStoredDevice();
      if (stored && stored.deviceId) {
        const stillThere = list.some((d) => d.deviceId === stored.deviceId);
        if (!stillThere) {
          // Do NOT storeDevice(null): the absence may be transient.
          if (audioRef?.current) await applySink(audioRef.current, null);
          showToast('Speaker terputus, balik ke default', 'warning');
        }
      }
    };
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange);
  }, [supported, audioRef, showToast]);

  // Close popover on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selectDevice = useCallback(async (device) => {
    const el = audioRef?.current;
    const ok = await applySink(el, device);
    if (ok) {
      storeDevice(device);
      setCurrent(device);
      showToast(
        device && device.deviceId ? `Output: ${device.label || 'speaker'}` : 'Output: default',
        'success',
      );
    } else {
      showToast('Gagal set speaker (perlu HTTPS + Chrome/Edge)', 'error');
    }
    setOpen(false);
  }, [audioRef, showToast]);

  const handlePick = useCallback(async () => {
    await ensurePermission();
    try {
      const device = await pickOutputDevice();
      await selectDevice(device);
    } catch {
      showToast('Picker tidak tersedia, pilih dari list', 'warning');
      setOpen(true);
      refresh();
    }
  }, [ensurePermission, selectDevice, showToast, refresh]);

  if (!supported) {
    return (
      <button
        type="button"
        disabled
        title="Routing output cuma didukung di Chrome/Edge via HTTPS"
        className="p-2 rounded-full text-white/30 cursor-not-allowed"
      >
        <Volume2 className="w-5 h-5" />
      </button>
    );
  }

  const isDefault = !current || !current.deviceId;
  const label = isDefault ? 'Default' : (current.label || 'Speaker');

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={onToggle}
        title={`Output: ${label}`}
        className="flex items-center gap-1 max-w-[150px] p-2 rounded-full hover:bg-white/20 transition-colors text-white/70 hover:text-white"
      >
        <span className={`relative flex items-center ${isDefault ? '' : 'text-purple-300'}`}>
          <Volume2 className="w-5 h-5" />
          {!isDefault && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-purple-400" />
          )}
        </span>
        <span className="text-[11px] truncate">{label}</span>
        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-60 z-50 rounded-xl border border-white/10 bg-neutral-900/95 backdrop-blur-md shadow-2xl p-1.5 text-white text-sm">
          <button
            type="button"
            onClick={handlePick}
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 transition-colors flex items-center gap-2"
          >
            <Volume2 className="w-4 h-4 text-purple-300" />
            <span>Pilih speaker…</span>
          </button>

          <div className="my-1 h-px bg-white/10" />

          <button
            type="button"
            onClick={() => selectDevice(null)}
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 transition-colors flex items-center justify-between gap-2"
          >
            <span>System default</span>
            {isDefault && <Check className="w-4 h-4 text-purple-300" />}
          </button>

          <div className="max-h-56 overflow-y-auto">
            {devices.map((d, i) => {
              const active = current && d.deviceId === current.deviceId;
              return (
                <button
                  key={`${d.deviceId || 'unk'}-${i}`}
                  type="button"
                  onClick={() => selectDevice(d)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 transition-colors flex items-center justify-between gap-2"
                >
                  <span className="truncate">{d.label || 'Speaker'}</span>
                  {active && <Check className="w-4 h-4 text-purple-300 flex-shrink-0" />}
                </button>
              );
            })}
            {devices.length === 0 && (
              <div className="px-3 py-2 text-white/40 text-xs">Tidak ada device terdeteksi</div>
            )}
          </div>
          <div className="px-3 py-1.5 text-[10px] text-white/30">
            Daftar speaker butuh izin sekali (Chrome menyembunyikan nama device tanpa izin). Gunakan "Pilih speaker…" untuk picker native.
          </div>
        </div>
      )}
    </div>
  );
}
