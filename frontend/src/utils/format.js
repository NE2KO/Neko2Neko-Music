function smartDecimals(size) {
  return size < 10 ? 1 : 0;
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < UNITS.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(smartDecimals(size))} ${UNITS[i]}`;
}

export function formatBytesCompact(bytes) {
  if (!bytes || bytes <= 0) return '0B';
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < UNITS.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(smartDecimals(size))}${UNITS[i]}`;
}

const RATE_UNITS = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s'];

export function formatBytesRate(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
  let i = 0;
  let size = bytesPerSec;
  while (size >= 1024 && i < RATE_UNITS.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(smartDecimals(size))} ${RATE_UNITS[i]}`;
}

export function formatBytesRateCompact(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '0B/s';
  let i = 0;
  let size = bytesPerSec;
  while (size >= 1024 && i < RATE_UNITS.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(smartDecimals(size))}${RATE_UNITS[i]}`;
}

const SPEED_UNITS = ['b/s', 'Kb/s', 'Mb/s', 'Gb/s'];

export function formatSpeed(bps) {
  const bits = (Number(bps) || 0) * 8;
  if (bits <= 0) return '0 b/s';
  let i = 0;
  let size = bits;
  while (size >= 1000 && i < SPEED_UNITS.length - 1) { size /= 1000; i++; }
  return `${size.toFixed(smartDecimals(size))} ${SPEED_UNITS[i]}`;
}

export function formatSpeedCompact(bps) {
  const bits = (Number(bps) || 0) * 8;
  if (bits <= 0) return '0b/s';
  let i = 0;
  let size = bits;
  while (size >= 1000 && i < SPEED_UNITS.length - 1) { size /= 1000; i++; }
  return `${size.toFixed(smartDecimals(size))}${SPEED_UNITS[i]}`;
}
