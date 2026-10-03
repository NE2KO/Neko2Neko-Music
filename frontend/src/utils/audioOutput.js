// Audio output-device routing for the browser <audio> element.
// Uses navigator.mediaDevices.selectAudioOutput() + HTMLMediaElement.setSinkId.
// Requires a secure context (HTTPS/localhost) and Chromium (Chrome/Edge);
// Firefox/Safari do not expose setSinkId on media elements.

const STORAGE_KEY = 'audio.outputDevice';

export function isOutputRoutingSupported() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    typeof window.HTMLMediaElement !== 'undefined' &&
    typeof window.HTMLMediaElement.prototype.setSinkId === 'function'
  );
}

export function getStoredDevice() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeDevice(device) {
  try {
    if (device && device.deviceId) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ deviceId: device.deviceId, label: device.label || '' }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

// Open the native output-device picker (Chrome 111+). Resolves to {deviceId,label}.
export async function pickOutputDevice() {
  if (!isOutputRoutingSupported()) throw new Error('unsupported');
  if (navigator.mediaDevices?.selectAudioOutput) {
    const info = await navigator.mediaDevices.selectAudioOutput();
    return { deviceId: info.deviceId, label: info.label || info.deviceId || '' };
  }
  throw new Error('no-native-picker');
}

export async function listOutputDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audiooutput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId || 'Speaker' }));
  } catch {
    return [];
  }
}

// Apply the selected device to the audio element. deviceId '' / null = default.
export async function applySink(audioEl, device) {
  if (!audioEl || !isOutputRoutingSupported()) return false;
  try {
    const id = device && device.deviceId ? device.deviceId : '';
    await audioEl.setSinkId(id);
    return true;
  } catch {
    return false;
  }
}
