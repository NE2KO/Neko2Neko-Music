import React from 'react';
import { Lock, LockOpen } from 'lucide-react';

// Clear on/off lock toggle for the Media Vault carousel.
// Locked ("Ikuti") = the carousel follows the playing item and snaps back to it
// after a short idle pause. Unlocked ("Bebas") = the carousel stays exactly
// where you scrolled; nothing pulls it back.
export default function CarouselLockToggle({ lockEnabled = true, onToggleLock = null }) {
  if (!onToggleLock) return null;
  return (
    <button
      onClick={onToggleLock}
      title={lockEnabled
        ? 'Ikuti aktif: setelah 30 detik diam, carousel kembali ke item yang sedang diputar'
        : 'Bebas: carousel tetap di posisi sekarang (tidak kembali otomatis)'}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-2 transition-all duration-150 active:scale-90 focus:outline-none focus:ring-0 ${
        lockEnabled
          ? 'bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
          : 'text-white/60 hover:bg-white/10 hover:text-white'
      }`}
    >
      {lockEnabled ? <Lock size={15} className="text-amber-400 fill-amber-400/20" /> : <LockOpen size={15} />}
      <span className="text-[11px] font-semibold leading-none">{lockEnabled ? 'Ikuti' : 'Bebas'}</span>
    </button>
  );
}