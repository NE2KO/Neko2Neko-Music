import db, { musicStmts } from '../db.js';

function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s |= 0;
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deterministicShuffle(ids, seed) {
  const arr = ids.slice();
  const rng = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function getShuffledFiles(folderId, seed, limit = 50000) {
  const folder = musicStmts.getFolder.get(folderId);
  if (!folder) throw new Error('Folder not found');

  const ids = db.prepare(`
    SELECT f.id
    FROM files f
    WHERE f.dir_id = ? AND f.type IN ('video', 'audio')
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT ?
  `).all(folderId, limit);

  const idList = ids.map(r => r.id);
  const shuffled = deterministicShuffle(idList, seed);

  const placeholders = shuffled.map(() => '?').join(',');
  const items = db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.dir_id, f.duration, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.id IN (${placeholders})
  `).all(...shuffled);

  const shaped = items.map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    ext: item.ext,
    size: item.size,
    mtime: item.mtime,
    created_at: item.created_at,
    uploaded_at: item.uploaded_at || null,
    has_thumb: item.has_thumb,
    dir_id: item.dir_id,
    dir_path: item.dir_path,
    duration: item.duration || 0,
    bitrate: item.duration > 0 ? Math.round(item.size / item.duration) : 0,
  }));

  return shaped;
}
