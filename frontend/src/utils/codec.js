// Determines whether a media file can be sent over WhatsApp.
// WA (and therefore Channel/Status) does NOT support HEVC (hvc1/hev1/hevc);
// H.264 (avc1/h264) is fine. Images/audio are always supported.

const H264_RE = /(^|\s)(avc1|avc3|h264)(\s|$)/;
const HEVC_RE = /(^|\s)(hev1|hvc1|hevc)(\s|$)/;
// Any video codec WhatsApp (Status/Channel) cannot process — not just HEVC.
const UNSUPPORTED_VIDEO_RE = /(^|\s)(hev1|hvc1|hevc|h265|av1|av01|vp8|vp09|vp9|mpeg4|mpeg2video|mjpeg|msmpeg4|msmpeg4v3|wmv1|wmv2|wmv3|vc1|flv1|rv40|theora)(\s|$)/;
// WhatsApp requires AAC audio. mp4a is the AAC codec tag.
const AAC_RE = /(^|\s)(aac|mp4a)(\s|$)/;

function parseCodecInfo(ci) {
  if (!ci) return null;
  if (typeof ci === 'string') {
    try { return JSON.parse(ci); } catch { return null; }
  }
  return ci && typeof ci === 'object' ? ci : null;
}

// Accepts a parsed object or a JSON string (file.codec_info).
export function isHevcCodec(codecInfo) {
  if (!codecInfo) return false;
  let c = codecInfo;
  if (typeof c === 'string') {
    try { c = JSON.parse(c); } catch { return false; }
  }
  if (!c || typeof c !== 'object') return false;
  const codec = `${c.video_codec || ''} ${c.video_codec_tag || ''}`.toLowerCase();
  if (!codec.trim()) return false;
  return HEVC_RE.test(codec) && !H264_RE.test(codec);
}

export function isVideoHevc(file) {
  if (!file || file.type !== 'video') return false;
  if (isHevcCodec(file.codec_info)) return true;
  const ext = (file.ext || file.name || '').toLowerCase();
  if (ext === '.hevc' || ext === '.h265') return true;
  return false;
}

// True when a video's codec is NOT supported by WhatsApp (Status/Channel).
// WhatsApp requires whole-media compatibility: the video must be H.264 AND any
// audio present must be AAC. Prefers the normalized videoCodec / audioCodec
// fields (populated by the ffprobe scan); otherwise falls back to regex /
// extension checks. H.264 (+ AAC audio) is the only broadly supported combo, so
// anything else (HEVC, AV1, VP9, or H.264-with-Opus/MP3 audio, …) is unsupported.
export function isWaUnsupportedVideo(file) {
  if (!file || file.type !== 'video') return false;

  const ci = parseCodecInfo(file.codec_info);
  if (ci) {
    // `compatible` (when present) reflects BROWSER/HLS playability, NOT whether
    // WhatsApp can send the file — so a true value must NOT short-circuit the
    // WA check (an H.264 + Opus file is browser-playable but WA-incompatible).
    // Only a definitively-false value means the media is unusable everywhere.
    if (typeof ci.compatible === 'boolean' && !ci.compatible) return true;
    const v = `${ci.videoCodec || ''} ${ci.video_codec || ''}`.toLowerCase().trim();
    const a = `${ci.audioCodec || ''} ${ci.audio_codec || ''}`.toLowerCase().trim();
    // Unsupported video codec (HEVC, AV1, VP9, …).
    if (v && !H264_RE.test(v) && UNSUPPORTED_VIDEO_RE.test(v)) return true;
    // Video is H.264 but audio is present and not AAC → WhatsApp rejects it.
    if (v && H264_RE.test(v) && a && !AAC_RE.test(a)) return true;
  }

  const ext = (file.ext || file.name || '').toLowerCase();
  if (ext === '.hevc' || ext === '.h265' || ext === '.av1') return true;
  return false;
}
