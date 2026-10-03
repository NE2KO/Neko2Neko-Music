import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../config/paths.js';

const VAAPI_DEVICE = existsSync('/dev/dri/renderD128') ? '/dev/dri/renderD128' : null;
const HWACCEL = VAAPI_DEVICE ? ['-hwaccel', 'vaapi', '-hwaccel_device', VAAPI_DEVICE] : [];
export const VAAPI_AVAILABLE = !!VAAPI_DEVICE;

export const THUMB_SIZES = {
  full: 300,
  list: 150,
};

export const THUMBNAIL_DIR = PATHS.thumbnails;

export function getThumbPath(id, size = 'full') {
  if (!id || id.length < 6) {
    return join(THUMBNAIL_DIR, size, id + '.jpg');
  }
  return join(THUMBNAIL_DIR, size, id + '.jpg');
}

export function getSharedPlaceholderPath(size = 'full') {
  return join(THUMBNAIL_DIR, size, 'placeholder_audio.jpg');
}

export async function hasEmbeddedCover(inputPath) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      inputPath,
    ];

    let stdout = '';
    const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    proc.stdout.on('data', (chunk) => { stdout += chunk; });

    proc.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try {
        const data = JSON.parse(stdout);
        const coverStream = data.streams?.find((s) =>
          s.codec_type === 'video' &&
          (s.disposition?.attached_pic === 1 || s.codec_name === 'mjpeg' || s.codec_name === 'png')
        );
        resolve(coverStream || null);
      } catch {
        resolve(null);
      }
    });

    proc.on('error', () => resolve(null));
  });
}

export async function extractEmbeddedThumbnail(inputPath, outputPath) {
  return new Promise((resolve) => {
    const args = [
      '-i', inputPath,
      '-map', '0:v:0',
      '-c:v', 'copy',
      '-frames:v', '1',
      '-y',
      outputPath,
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stderr.on('data', () => {});

    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

export async function extractFrameThumbnail(inputPath, outputPath, quality = 12, size = 300) {
  return new Promise((resolve) => {
    const baseArgs = VAAPI_DEVICE
      ? ['-hwaccel', 'vaapi', '-hwaccel_device', VAAPI_DEVICE]
      : ['-skip_frame', 'nokey'];

    const args = [
      ...baseArgs,
      '-ss', '1.0',
      '-i', inputPath,
      '-vframes', '1',
      '-vf', `scale=${size}:-1:flags=fast_bilinear`,
      '-f', 'image2',
      '-c:v', 'mjpeg',
      '-q:v', String(quality),
      '-y',
      outputPath,
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(true);
      } else if (VAAPI_DEVICE) {
        const fallback = spawn('ffmpeg', [
          '-ss', '1.0',
          '-i', inputPath,
          '-vframes', '1',
          '-vf', `scale=${size}:-1:flags=fast_bilinear`,
          '-f', 'image2',
          '-c:v', 'mjpeg',
          '-q:v', String(quality),
          '-y',
          outputPath,
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        fallback.on('close', (c) => resolve(c === 0));
        fallback.on('error', () => resolve(false));
      } else {
        resolve(false);
      }
    });

    proc.on('error', () => resolve(false));
  });
}

export async function generateImageThumbnail(inputPath, outputPath, quality = 10, size = 300) {
  return new Promise((resolve) => {
    const baseArgs = VAAPI_DEVICE
      ? ['-hwaccel', 'vaapi', '-hwaccel_device', VAAPI_DEVICE]
      : [];

    const args = [
      ...baseArgs,
      '-i', inputPath,
      '-vf', `scale=${size}:-1:flags=fast_bilinear`,
      '-f', 'image2',
      '-c:v', 'mjpeg',
      '-q:v', String(quality),
      '-y',
      outputPath,
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(true);
      } else if (VAAPI_DEVICE) {
        const fallback = spawn('ffmpeg', [
          '-i', inputPath,
          '-vf', `scale=${size}:-1:flags=fast_bilinear`,
          '-f', 'image2',
          '-c:v', 'mjpeg',
          '-q:v', String(quality),
          '-y',
          outputPath,
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        fallback.on('close', (c) => resolve(c === 0));
        fallback.on('error', () => resolve(false));
      } else {
        resolve(false);
      }
    });

    proc.on('error', () => resolve(false));
  });
}

export async function generateAudioPlaceholder(outPath, size = 300) {
  const fontSize = Math.round(size * 0.27);
  return new Promise((resolve) => {
    const args = [
      '-f', 'lavfi',
      '-i', `color=c=#0f172a:s=${size}x${size}:d=1`,
      '-f', 'lavfi',
      '-i', `color=c=#3b82f6:s=${size}x${size}:d=1`,
      '-filter_complex', `[0][1]overlay=format=auto:alpha=0.25,drawtext=text=♪:fontcolor=#ffffff:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2`,
      '-frames:v', '1',
      '-f', 'image2',
      '-c:v', 'mjpeg',
      '-q:v', '6',
      '-y',
      outPath,
    ];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}
