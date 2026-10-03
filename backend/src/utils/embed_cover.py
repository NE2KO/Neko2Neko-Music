#!/usr/bin/env python3
"""Embed cover art into audio files using mutagen.

Formats handled in-place (preserves inode / birth time):
  - .flac  : mutagen.flac
  - .opus  : mutagen.oggopus
  - .ogg   : mutagen.oggvorbis
  - .mp3   : mutagen.mp3  (ID3 APIC)
  - .m4a   : mutagen.mp4  (MP4Cover / covr atom)

WebM still requires ffmpeg on the JS side; see metadataWriter.js.
"""
import sys
import base64
from struct import unpack

from mutagen.flac import FLAC, Picture
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4, MP4Cover
from mutagen.id3 import ID3, APIC
from mutagen.oggopus import OggOpus
from mutagen.oggvorbis import OggVorbis


def _build_picture(image_path, mime_type="image/jpeg"):
    pic = Picture()
    pic.type = 3  # Front cover
    pic.mime = mime_type

    with open(image_path, "rb") as f:
        data = f.read()
    pic.data = data

    if data[:2] == b'\xff\xd8':  # JPEG
        i = 2
        while i < len(data) - 1:
            if data[i] == 0xff:
                marker = data[i + 1]
                if marker in (0xc0, 0xc1, 0xc2):
                    pic.width = unpack('>H', data[i + 5:i + 7])[0]
                    pic.height = unpack('>H', data[i + 7:i + 9])[0]
                    pic.depth = 24
                    break
                length = unpack('>H', data[i + 2:i + 4])[0]
                i += 2 + length
            else:
                i += 1
    elif data[:8] == b'\x89PNG\r\n\x1a\n':  # PNG
        pic.width, pic.height = unpack('>II', data[16:24])
        pic.depth = {8: 24, 16: 48}.get(data[24], 24)

    return pic


def _set_ogg_picture(audio, pic):
    """Embed a FLAC Picture block into an Ogg file via METADATA_BLOCK_PICTURE."""
    block = pic.write()
    b64 = base64.b64encode(block).decode('ascii')
    if audio.tags is None:
        audio.add_tags()
    tags = audio.tags
    for key in [k for k in tags.keys() if k.upper() == 'METADATA_BLOCK_PICTURE']:
        del tags[key]
    tags['METADATA_BLOCK_PICTURE'] = b64


def _embed_mp3(path, image_path, mime_type):
    audio = MP3(path)
    if audio.tags is None:
        audio.add_tags()
    audio.tags.add(APIC(
        encoding=3,
        mime=mime_type,
        type=3,
        desc="Cover",
        data=open(image_path, "rb").read(),
    ))
    audio.save()


def _embed_m4a(path, image_path, mime_type):
    fmt = {
        'image/jpeg': MP4Cover.FORMAT_JPEG,
        'image/png': MP4Cover.FORMAT_PNG,
        'image/webp': MP4Cover.FORMAT_JPEG,
        'image/gif': MP4Cover.FORMAT_JPEG,
    }.get(mime_type, MP4Cover.FORMAT_JPEG)

    audio = MP4(path)
    audio.tags['covr'] = [MP4Cover(open(image_path, "rb").read(), imageformat=fmt)]
    audio.save()


def embed_cover(path, image_path, mime_type="image/jpeg"):
    p = path.lower()
    if p.endswith('.flac'):
        audio = FLAC(path)
        audio.clear_pictures()
        audio.add_picture(_build_picture(image_path, mime_type))
        audio.save()
    elif p.endswith('.mp3'):
        _embed_mp3(path, image_path, mime_type)
    elif p.endswith('.m4a') or p.endswith('.mp4'):
        _embed_m4a(path, image_path, mime_type)
    elif p.endswith('.opus'):
        audio = OggOpus(path)
        _set_ogg_picture(audio, _build_picture(image_path, mime_type))
        audio.save()
    elif p.endswith('.ogg'):
        audio = OggVorbis(path)
        _set_ogg_picture(audio, _build_picture(image_path, mime_type))
        audio.save()
    else:
        raise SystemExit("Unsupported format for cover embedding: " + path)

    print("OK")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: embed_cover.py <audio_path> <image_path> [mime_type]")
        sys.exit(1)

    mime = sys.argv[3] if len(sys.argv) > 3 else "image/jpeg"
    embed_cover(sys.argv[1], sys.argv[2], mime)
