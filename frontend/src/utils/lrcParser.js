export function parseLRC(lrcString) {
  if (!lrcString) return [];
  const lines = lrcString.split('\n');
  const result = [];

  for (const line of lines) {
    const match = line.match(/\[(\d{1,2}):(\d{2})\.(\d{2,3})\](.*)/);
    if (!match) continue;

    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const msStr = match[3];
    const ms = msStr.length === 3 ? parseInt(msStr, 10) : parseInt(msStr, 10) * 10;
    const time = minutes * 60 + seconds + ms / 1000;
    const text = match[4].trim();

    result.push({ time, text });
  }

  return result.sort((a, b) => a.time - b.time);
}

export function getActiveLineIndex(parsedLyrics, currentTime) {
  if (!parsedLyrics || parsedLyrics.length === 0) return -1;

  let lo = 0;
  let hi = parsedLyrics.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (parsedLyrics[mid].time <= currentTime) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return Math.max(0, lo - 1);
}

export function formatLRCTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');
  return `${mm}:${ss}.${mmm}`;
}
