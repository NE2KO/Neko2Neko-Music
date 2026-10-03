/**
 * Playlist Scanner - Discovers and caches XSPF playlists
 * 
 * Scans media roots for .xspf files and caches their metadata
 * in the database for fast access.
 */

import { readdir as readdirAsync, stat as statAsync, access as accessAsync, constants } from 'node:fs/promises';
import { join, extname } from 'node:path';
import db, { playlistStmts } from '../db.js';
import { parseXSPF, isValidXSPF, getPlaylistSummary } from './xspfParser.js';
import { MEDIA_ROOT } from '../server.js';

let scanAborted = false;
let lastScanTime = null;
let playlistCount = 0;

function getPlaylistScannerStatus() {
  return {
    lastScanTime,
    playlistCount,
    scanning: !scanAborted,
  };
}

function stopScan() {
  scanAborted = true;
  console.log('[playlistScanner] Scan stop requested');
}

/**
 * Recursively find all XSPF files in a directory
 */
async function findXSPFFiles(dir, fileList = []) {
  let files;
  try {
    files = await readdirAsync(dir);
  } catch (err) {
    console.warn(`[playlistScanner] Cannot read directory ${dir}:`, err.message);
    return fileList;
  }
  
  for (const file of files) {
    const fullPath = join(dir, file);
    
    let stats;
    try {
      stats = await statAsync(fullPath);
    } catch (err) {
      continue;
    }
    
    if (stats.isDirectory()) {
      if (file.startsWith('.') || file === 'node_modules') continue;
      await findXSPFFiles(fullPath, fileList);
    } else if (file.toLowerCase().endsWith('.xspf')) {
      fileList.push(fullPath);
    }
  }
  
  return fileList;
}

async function fileExists(path) {
  try {
    await accessAsync(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse an XSPF file and cache it in the database
 */
export async function parseAndCachePlaylist(playlistPath) {
  const now = Date.now();
  
  try {
    // Parse XSPF file
    const playlist = await parseXSPF(playlistPath);
    const summary = getPlaylistSummary(playlist);
    
    // Check if playlist already exists
    const existing = playlistStmts.getPlaylistByPath.get(playlistPath);
    
    // If the playlist was soft-deleted, skip re-adding it
    if (existing && existing.deleted_at) {
      console.log(`[playlistScanner] Skipping soft-deleted playlist: ${playlistPath}`);
      return {
        id: existing.id,
        path: playlistPath,
        title: playlist.title,
        track_count: summary.totalTracks,
        skipped: true,
        reason: 'soft-deleted',
      };
    }

    let playlistId;
    if (existing) {
      playlistId = existing.id;
      
      // Update playlist metadata
      playlistStmts.upsertPlaylist.run({
        path: playlistPath,
        title: playlist.title,
        creator: playlist.creator,
        annotation: playlist.annotation,
        info: playlist.info,
        image: playlist.image,
        track_count: summary.totalTracks,
        total_duration: summary.totalDuration,
        total_size: summary.totalSize,
        available_tracks: summary.availableTracks,
        missing_tracks: summary.missingTracks,
        last_scanned: now,
        last_updated: now,
        created_at: existing.created_at || now,
      });
      
      // Delete old tracks
      playlistStmts.deletePlaylistTracks.run(playlistId);
    } else {
      // Insert new playlist
      const result = playlistStmts.upsertPlaylist.run({
        path: playlistPath,
        title: playlist.title,
        creator: playlist.creator,
        annotation: playlist.annotation,
        info: playlist.info,
        image: playlist.image,
        track_count: summary.totalTracks,
        total_duration: summary.totalDuration,
        total_size: summary.totalSize,
        available_tracks: summary.availableTracks,
        missing_tracks: summary.missingTracks,
        last_scanned: now,
        last_updated: now,
        created_at: now,
      });
      playlistId = result.lastInsertRowid;
    }
    
    // Insert tracks
    const insertTrack = playlistStmts.insertPlaylistTrack;
    const tx = db.transaction(() => {
      for (let i = 0; i < playlist.tracks.length; i++) {
        const track = playlist.tracks[i];
        insertTrack.run(
          playlistId,
          track.playlistIndex,
          track.originalLocation,
          track.path,
          track.title,
          track.artist,
          track.album,
          track.duration,
          track.artwork,
          track.trackNum,
          track.exists ? 1 : 0,
          track.size || 0,
          track.mtime || 0,
        );
      }
    });
    tx();
    
    return {
      id: playlistId,
      path: playlistPath,
      title: playlist.title,
      track_count: summary.totalTracks,
      available_tracks: summary.availableTracks,
    };
  } catch (err) {
    console.error(`[playlistScanner] Failed to parse ${playlistPath}:`, err.message);
    throw err;
  }
}

/**
 * Scan all media roots for XSPF playlists
 */
export async function scanPlaylists() {
  scanAborted = false;
  const startTime = Date.now();
  const found = [];
  const updated = [];
  const failed = [];
  
  console.log('[playlistScanner] Starting playlist discovery...');
  
  // Find all XSPF files in media roots
  const allPlaylists = [];
  for (const root of MEDIA_ROOT) {
    if (await fileExists(root)) {
      const rootPlaylists = await findXSPFFiles(root);
      allPlaylists.push(...rootPlaylists);
    }
  }
  
  console.log(`[playlistScanner] Found ${allPlaylists.length} XSPF files`);
  
  // Parse and cache each playlist
  for (const playlistPath of allPlaylists) {
    if (scanAborted) {
      console.log('[playlistScanner] Scan aborted');
      break;
    }
    try {
      const result = await parseAndCachePlaylist(playlistPath);
      found.push(result);
      
      // Check if it was an update
      const existing = playlistStmts.getPlaylistByPath.get(playlistPath);
      if (existing && existing.last_scanned !== result.last_scanned) {
        updated.push(result);
      }
    } catch (err) {
      failed.push({ path: playlistPath, error: err.message });
    }
  }
  
  const duration = Date.now() - startTime;
  lastScanTime = Date.now();
  playlistCount = found.length;
  console.log(`[playlistScanner] Completed in ${duration}ms: ${found.length} playlists, ${updated.length} updated, ${failed.length} failed`);
  
  return {
    found: found.length,
    updated: updated.length,
    failed: failed.length,
    failed_list: failed,
    duration,
  };
}

/**
 * Check if a file is a playlist that should be scanned
 */
export function isPlaylistFile(filePath) {
  return filePath.toLowerCase().endsWith('.xspf');
}

/**
 * Handle playlist file change (add/update/delete)
 */
export async function handlePlaylistChange(filePath, eventType) {
  if (!isPlaylistFile(filePath)) {
    return;
  }
  
  try {
    if (eventType === 'add' || eventType === 'change') {
      if (await fileExists(filePath)) {
        await parseAndCachePlaylist(filePath);
        console.log(`[playlistScanner] Updated: ${filePath}`);
      }
    } else if (eventType === 'unlink') {
      // Remove from cache
      const existing = playlistStmts.getPlaylistByPath.get(filePath);
      if (existing) {
        playlistStmts.deletePlaylistTracks.run(existing.id);
        playlistStmts.deletePlaylist.run(existing.id);
        console.log(`[playlistScanner] Removed: ${filePath}`);
      }
    }
  } catch (err) {
    console.error(`[playlistScanner] Error handling ${filePath}:`, err.message);
  }
}

export { stopScan, getPlaylistScannerStatus };

export default { scanPlaylists, parseAndCachePlaylist, handlePlaylistChange, isPlaylistFile, stopScan, getPlaylistScannerStatus };