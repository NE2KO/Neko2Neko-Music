import { applySink, getStoredDevice, isOutputRoutingSupported } from '../utils/audioOutput';
import usePlaybackStore from '../store/playbackStore';

let audioEl = null;
let ready = false;
const listeners = {};

function emit(event, ...args) {
  (listeners[event] || []).forEach(fn => fn(...args));
}

function init() {
  if (ready) return;

  audioEl = new Audio();
  audioEl.preload = 'metadata';
  audioEl.style.cssText =
    'position:fixed;width:0;height:0;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
  document.body.appendChild(audioEl);
  ready = true;

  try {
    const savedVol = localStorage.getItem('audio.volume');
    if (savedVol != null) {
      audioEl.volume = Math.max(0, Math.min(1, Number(savedVol) / 100));
    }
  } catch { /* ignore */ }

  const onVolumeChange = () => {
    try { localStorage.setItem('audio.volume', String(Math.round(audioEl.volume * 100))); } catch { /* ignore */ }
  };
  audioEl.addEventListener('volumechange', onVolumeChange);

  const storedOut = getStoredDevice();
  if (storedOut && storedOut.deviceId) applySink(audioEl, storedOut);

  const onDeviceChange = async () => {
    const s = getStoredDevice();
    if (!s || !s.deviceId) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const present = list.some((d) => d.kind === 'audiooutput' && d.deviceId === s.deviceId);
      if (present) applySink(audioEl, s);
      else applySink(audioEl, null);
    } catch {
      /* ignore */
    }
  };
  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
  }

  const debugSink = typeof location !== 'undefined' && location.search.includes('debugSink');
  const enforceSink = () => {
    if (!isOutputRoutingSupported()) return;
    const s = getStoredDevice();
    const desired = s && s.deviceId ? s.deviceId : '';
    if (debugSink) {
      try { console.debug(`[sink] desired=${desired} actual=${audioEl.sinkId}`); } catch { /* ignore */ }
    }
    if (audioEl.sinkId !== desired) {
      audioEl.setSinkId(desired).catch(() => {});
    }
  };

  ['play', 'loadstart', 'loadedmetadata', 'canplay', 'seeked', 'playing'].forEach((ev) =>
    audioEl.addEventListener(ev, enforceSink)
  );

  let lastEnforceTime = 0;
  const onTimeUpdate = () => {
    const now = Date.now();
    if (now - lastEnforceTime < 1000) return;
    lastEnforceTime = now;
    enforceSink();
    emit('timeupdate');
  };
  audioEl.addEventListener('timeupdate', onTimeUpdate);

  let endedGuard = false;
  audioEl.addEventListener('ended', () => {
    if (endedGuard) return;
    endedGuard = true;
    setTimeout(() => { endedGuard = false; }, 300);

    const store = usePlaybackStore.getState();
    const { loopMode, shuffle, queue, currentTrackIndex } = store;

    if (loopMode === 'one') {
      audioEl.currentTime = 0;
      enforceSink();
      audioEl.play().catch(() => {});
      return;
    }

    if (loopMode === 'off' && !shuffle && currentTrackIndex === queue.length - 1) {
      store.pause();
      return;
    }

    store.next();
    emit('trackEnded');
  });

  audioEl.addEventListener('play', () => emit('play'));
  audioEl.addEventListener('pause', () => emit('pause'));
  audioEl.addEventListener('loadedmetadata', () => emit('loadedmetadata'));
  audioEl.addEventListener('canplay', () => emit('canplay'));
  audioEl.addEventListener('waiting', () => emit('waiting'));
  audioEl.addEventListener('error', (e) => emit('error', e));
  audioEl.addEventListener('playing', () => emit('playing'));
}

export function getAudioEngine() {
  if (!ready) init();
  return {
    getElement: () => audioEl,
    load: (fileId) => {
      if (!audioEl) return;
      audioEl.currentTime = 0;
      audioEl.src = `/file/${fileId}`;
      audioEl.load();
    },
    play: () => audioEl.play(),
    pause: () => audioEl.pause(),
    seek: (seconds) => { if (audioEl) audioEl.currentTime = seconds; },
    setVolume: (volume) => { if (audioEl) audioEl.volume = volume; },
    setMuted: (muted) => { if (audioEl) audioEl.muted = muted; },
    on: (event, fn) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    off: (event, fn) => {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(f => f !== fn);
    },
  };
}
