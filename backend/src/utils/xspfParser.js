/**
 * XSPF (XML Shareable Playlist Format) Parser
 *
 * Parses .xspf playlist files using fast-xml-parser.
 * Supports:
 * - title, creator, annotation, info, image
 * - trackList with location, title, creator, album, duration, image, trackNum
 * - Path resolution (file://, absolute, relative)
 * - File existence validation
 * - Metadata enrichment from audio files
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const xmlParser = new XMLParser({
  ignoreNameSpace: true,
  removeNSPrefix: true,
  textNodeName: '#text',
  isArray: (name) => name === 'track',
  trimValues: true,
});

/**
 * Resolve a track location to an absolute filesystem path
 * Supports:
 * - file:// URLs
 * - Absolute paths
 * - Relative paths (resolved against playlist directory)
 */
function resolveTrackPath(location, playlistDir) {
  if (!location) return null;

  let path = location;

  if (path.startsWith('file://')) {
    path = fileURLToPath(path);
  }

  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed percent sequence — use as-is
  }

  if (path.startsWith('/')) {
    return path;
  }

  return resolve(playlistDir, path);
}

/**
 * Check if a file exists and is accessible
 */
function validateFileAccess(filePath) {
  try {
    const stats = statSync(filePath);
    return {
      exists: true,
      isFile: stats.isFile(),
      size: stats.size,
      mtime: stats.mtimeMs,
    };
  } catch {
    return {
      exists: false,
      isFile: false,
      size: 0,
      mtime: 0,
    };
  }
}

/**
 * Extract metadata from audio file if track metadata is missing
 * Falls back to filename parsing
 */
function enrichTrackMetadata(track, filePath) {
  const enriched = { ...track };

  if (filePath && !track.title) {
    const filename = filePath.split('/').pop();
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');

    const trackNumMatch = nameWithoutExt.match(/^(\d+)[\s.-]+(.+)$/);
    if (trackNumMatch) {
      enriched.trackNum = parseInt(trackNumMatch[1], 10);
      enriched.title = trackNumMatch[2].trim();
    } else if (/^\d+$/.test(nameWithoutExt)) {
      // Pure number filename — try parent folder name as title
      const parts = filePath.split('/');
      const parentDir = parts.length >= 2 ? parts[parts.length - 2] : null;
      enriched.title = (parentDir && !/^\d+$/.test(parentDir)) ? parentDir : `Track ${nameWithoutExt}`;
      enriched.trackNum = parseInt(nameWithoutExt, 10);
    } else {
      enriched.title = nameWithoutExt;
    }
  }

  return enriched;
}

/**
 * Safely decode XML entities in string content
 */
function decodeXMLEntities(text) {
  if (typeof text !== 'string') return text;
  
  return text.replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

/**
 * Safely get a string value from parsed XML node
 */
function str(val) {
  if (val == null) return '';
  if (typeof val === 'string') return decodeXMLEntities(val);
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object' && val['#text'] != null) return str(val['#text']);
  return decodeXMLEntities(String(val));
}

/**
 * Parse an XSPF playlist file
 *
 * @param {string} playlistPath - Absolute path to .xspf file
 * @returns {Promise<Object>} Parsed playlist with metadata and tracks
 */
export async function parseXSPF(playlistPath) {
  const playlistDir = dirname(playlistPath);

  let xmlContent;
  try {
    xmlContent = readFileSync(playlistPath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read playlist file: ${err.message}`);
  }

  const parsed = xmlParser.parse(xmlContent);
  const playlist = parsed.playlist || {};

  const result = {
    title: str(playlist.title),
    creator: str(playlist.creator),
    annotation: str(playlist.annotation),
    info: str(playlist.info),
    image: playlist.image ? resolveTrackPath(str(playlist.image), playlistDir) : null,
    tracks: [],
  };

  const trackList = playlist.trackList;
  if (!trackList) {
    return result;
  }

  const tracks = Array.isArray(trackList.track) ? trackList.track : trackList.track ? [trackList.track] : [];

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const location = str(track.location) || null;
    const resolvedPath = resolveTrackPath(location, playlistDir);

    const fileStat = resolvedPath ? validateFileAccess(resolvedPath) : { exists: false };

    const trackObj = {
      id: `xspf_${playlistPath.replace(/\//g, '_')}_track_${i}`,
      title: str(track.title),
      artist: str(track.creator),
      album: str(track.album),
      duration: track.duration ? parseInt(track.duration, 10) : null,
      path: resolvedPath,
      originalLocation: location,
      artwork: track.image ? resolveTrackPath(str(track.image), playlistDir) : null,
      trackNum: track.trackNum ? parseInt(track.trackNum, 10) : null,
      exists: fileStat.exists,
      isFile: fileStat.isFile,
      size: fileStat.size,
      mtime: fileStat.mtime,
      playlistPath: playlistPath,
      playlistIndex: i,
    };

    if (!trackObj.title && fileStat.exists) {
      const enriched = enrichTrackMetadata(trackObj, resolvedPath);
      trackObj.title = enriched.title;
      trackObj.trackNum = enriched.trackNum;
    }

    result.tracks.push(trackObj);
  }

  return result;
}

/**
 * Validate XSPF file format
 *
 * @param {string} filePath - Path to validate
 * @returns {boolean} True if valid XSPF file
 */
export function isValidXSPF(filePath) {
  if (!filePath.toLowerCase().endsWith('.xspf')) {
    return false;
  }

  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.includes('<playlist') &&
           (content.includes('xspf.org') || content.includes('<trackList>'));
  } catch {
    return false;
  }
}

/**
 * Get summary statistics for a playlist
 *
 * @param {Object} playlist - Parsed playlist object
 * @returns {Object} Summary statistics
 */
export function getPlaylistSummary(playlist) {
  const totalTracks = playlist.tracks.length;
  const availableTracks = playlist.tracks.filter(t => t.exists).length;
  const totalDuration = playlist.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const totalSize = playlist.tracks.reduce((sum, t) => sum + (t.size || 0), 0);

  return {
    totalTracks,
    availableTracks,
    missingTracks: totalTracks - availableTracks,
    totalDuration,
    totalSize,
    hasArtwork: !!playlist.image,
    hasCreator: !!playlist.creator,
  };
}

export default { parseXSPF, isValidXSPF, getPlaylistSummary };
