import { parseFile, selectCover } from 'music-metadata';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function readMetadata(filePath) {
  try {
    const metadata = await parseFile(filePath, { duration: true });
    const common = metadata.common || {};
    const format = metadata.format || {};

    return {
      title: common.title || null,
      artist: common.artist || null,
      album: common.album || null,
      genre: common.genre?.[0] || null,
      year: common.year || null,
      track: common.track?.no || null,
      disk: common.disk?.no || null,
      duration: format.duration || null,
      bitrate: format.bitrate || null,
      codec: format.codec || null,
      hasCover: !!(common.picture && common.picture.length > 0),
      cover: common.picture?.[0] || null,
    };
  } catch (err) {
    console.error('[metadataWriter] readMetadata error:', err.message);
    return null;
  }
}

export async function extractCover(filePath) {
  try {
    const metadata = await parseFile(filePath);
    const pic = selectCover(metadata.common.picture);
    if (!pic) return null;
    return {
      format: pic.format,
      data: pic.data,
    };
  } catch (err) {
    console.error('[metadataWriter] extractCover error:', err.message);
    return null;
  }
}

export async function writeMetadata(filePath, updates) {
  const ext = extname(filePath).toLowerCase();
  const isFLAC = ext === '.flac';
  const isMP3 = ext === '.mp3';
  const isOGG = ext === '.ogg' || ext === '.opus';

  const current = await readMetadata(filePath);
  if (!current) throw new Error('Failed to read current metadata');

  const merged = { ...current, ...updates };

  return {
    title: merged.title,
    artist: merged.artist,
    album: merged.album,
    genre: merged.genre,
  };
}

async function _runEmbedPy(filePath, imageBuffer, mimeType) {
  const { execSync } = await import('node:child_process');
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');

  const ext = extname(filePath).toLowerCase();
  const mimeExt = (mimeType || '').split('/').pop()?.split(';')[0]?.trim() || 'bin';
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(mimeExt) ? mimeExt : 'bin';
  const tmpFile = join(tmpdir(), `cover_${Date.now()}.${safeExt}`);

  try {
    writeFileSync(tmpFile, imageBuffer);
    const pyScript = join(dirname(fileURLToPath(import.meta.url)), 'embed_cover.py');
    execSync(`python3 "${pyScript}" "${filePath}" "${tmpFile}" "${mimeType}"`, { stdio: 'pipe', timeout: 120000 });
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function _runEmbedWebm(filePath, imageBuffer, mimeType) {
  const { execSync } = await import('node:child_process');
  const { writeFileSync, unlinkSync, statSync, utimesSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');

  const ext = extname(filePath).toLowerCase();
  const mimeExt = (mimeType || '').split('/').pop()?.split(';')[0]?.trim() || 'bin';
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(mimeExt) ? mimeExt : 'bin';
  const tmpFile = join(tmpdir(), `cover_${Date.now()}.${safeExt}`);
  const outTmp = `${filePath}.tmp`;

  const originalStat = statSync(filePath);
  const originalAtime = originalStat.atime;
  const originalMtime = originalStat.mtime;

  try {
    writeFileSync(tmpFile, imageBuffer);
    const ffmpegArgs = `-i "${filePath}" -i "${tmpFile}" -map 0:a -map 1:0 -c:a copy -c:v libvpx-vp9 -deadline realtime -cpu-used 5 -f webm "${outTmp}"`;
    execSync(`ffmpeg -y ${ffmpegArgs}`, { stdio: 'pipe', timeout: 120000 });
    const { renameSync } = await import('node:fs');
    renameSync(outTmp, filePath);
    utimesSync(filePath, originalAtime, originalMtime);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
    try { unlinkSync(outTmp); } catch {}
  }
}

export async function embedCover(filePath, imageBuffer, mimeType) {
  const ext = extname(filePath).toLowerCase();

  if (['.flac', '.mp3', '.m4a', '.mp4', '.opus', '.ogg'].includes(ext)) {
    await _runEmbedPy(filePath, imageBuffer, mimeType);
    return;
  }

  if (ext === '.webm') {
    await _runEmbedWebm(filePath, imageBuffer, mimeType);
    return;
  }

  throw new Error(`Unsupported format for cover embedding: ${ext}`);
}
