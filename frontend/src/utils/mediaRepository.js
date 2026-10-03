import { API } from './api';

// ============================================================================
// MediaRepository — index-driven playback/navigation engine.
//
// Decouples Player / Modal / Carousel from any full array of media objects.
// The Grid keeps its own page-cache; this module owns a lightweight ordered ID
// index (stored outside React) plus a small LRU object cache.
//
//   Index Cache  -> whole-folder ordered IDs (16-byte binary from the server).
//                   Persisted to IndexedDB; revalidated via per-folder
//                   generation (ETag / 304). "Almost never changes."
//   Object Cache -> LRU of hydrated full media objects. "Changes constantly."
//
// Backend file IDs are 32-char hex strings == 16 raw bytes. The server sends
// the index as concatenated 16-byte records; we decode each to its hex string
// ONCE on load and build an O(1) `id -> index` Map. Navigation is:
//
//   next(id)     = ids[(idx+1) % total]
//   previous(id) = ids[(idx-1+total) % total]
//
// which always wraps (previous at index 0 -> last item, and vice versa).
// ============================================================================

const BATCH_LIMIT = 100;
const HYD_RADIUS = 60;            // silent prefetch window around the active item
const OBJECT_CACHE_MAX = 300;     // LRU cap for hydrated objects
const IDB_NAME = 'media-repo';
const IDB_STORE = 'indexes';
const IDB_VERSION = 1;

// ---- Module-level caches (outside React) ---------------------------------
const indexes = new Map();        // filterKey -> { ids, idToIndex, total, generation, etag }
const objectCache = new Map();    // id -> object  (LRU: re-set on access)
const inFlight = new Set();       // ids currently being batch-fetched
let idbPromise = null;

function openIDB() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return idbPromise;
}

async function idbGet(key) {
  const db = await openIDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function idbPut(key, value) {
  const db = await openIDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

async function idbDelete(key) {
  const db = await openIDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

export function buildFilterKey({ folderId, type, sortBy, sortOrder, favoriteOnly }) {
  const safeType = type || 'all';
  return `${folderId}:${safeType}:${sortBy || 'created_at'}:${sortOrder || 'desc'}:${favoriteOnly ? '1' : '0'}`;
}

// Decode a 16-byte record buffer into a string[] of hex ids (single pass).
function decodeHexTable(buffer) {
  const u8 = new Uint8Array(buffer);
  const total = u8.length % 16 === 0 ? u8.length / 16 : -1;
  if (total < 0) {
    // Legacy plain-string payload fallback.
    const arr = Array.isArray(buffer) ? buffer : Array.from(u8);
    const ids = arr.filter((x) => typeof x === 'string');
    return { ids, total: ids.length };
  }
  const ids = new Array(total);
  const hex = '0123456789abcdef';
  for (let i = 0; i < total; i++) {
    const o = i * 16;
    let h = '';
    for (let k = 0; k < 16; k++) {
      const v = u8[o + k];
      h += hex[v >> 4] + hex[v & 15];
    }
    ids[i] = h;
  }
  return { ids, total };
}

function buildIndexRecord(ids) {
  const idToIndex = new Map();
  for (let i = 0; i < ids.length; i++) idToIndex.set(ids[i], i);
  return { ids, idToIndex, total: ids.length, generation: 0, etag: null };
}

async function fetchIndex(filter, etag) {
  const qs = new URLSearchParams();
  if (filter.sortBy) qs.set('sortBy', filter.sortBy);
  if (filter.sortOrder) qs.set('sortOrder', filter.sortOrder);
  if (filter.type) qs.set('type', filter.type);
  if (filter.favoriteOnly) qs.set('favoriteOnly', '1');
  const url = `${API}/api/files/folders/${filter.folderId}/index?${qs.toString()}`;
  const headers = etag ? { 'If-None-Match': etag } : {};
  const res = await fetch(url, { headers });
  if (res.status === 304) {
    return { notModified: true, generation: res.headers.get('X-Index-Version') };
  }
  if (!res.ok) throw new Error(`Index ${res.status}`);
  const bytes = await res.arrayBuffer();
  return {
    bytes,
    generation: res.headers.get('X-Index-Version') || '0',
    etag: res.headers.get('etag'),
    total: parseInt(res.headers.get('X-Index-Total') || '0', 10),
  };
}

function cacheObject(obj) {
  if (!obj || obj.id == null) return;
  objectCache.delete(obj.id); // re-insert to refresh LRU position
  objectCache.set(obj.id, obj);
  if (objectCache.size > OBJECT_CACHE_MAX) {
    const oldest = objectCache.keys().next().value;
    if (oldest != null) objectCache.delete(oldest);
  }
}

// Hydrate a set of ids via the batch endpoint. Returns void; results land in
// the LRU object cache. Missing ids (deleted server-side) are reported back.
// `signal` (AbortSignal) cancels in-flight fetches — used to drop stale
// prefetches when the carousel jumps to a new region.
async function hydrateIds(ids, onMissing, signal) {
  const need = ids.filter((id) => !objectCache.has(id) && !inFlight.has(id));
  for (let i = 0; i < need.length; i += BATCH_LIMIT) {
    const chunk = need.slice(i, i + BATCH_LIMIT);
    chunk.forEach((id) => inFlight.add(id));
    let aborted = false;
    try {
      const res = await fetch(`${API}/api/files/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: chunk }),
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        for (const obj of data.items || []) cacheObject(obj);
        if (data.missingIds && data.missingIds.length && onMissing) onMissing(data.missingIds);
      }
    } catch (err) {
      // A genuine network error also lands here; only AbortError should stop us.
      if (err && err.name === 'AbortError') aborted = true;
    } finally {
      // Only clear the chunk THIS call owns — never another call's inFlight ids.
      chunk.forEach((id) => inFlight.delete(id));
    }
    if (aborted) break;
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------
export function createMediaRepository(callbacks = {}) {
  const { onMissing = null } = callbacks;

  // Scoped state: which filter are we presenting right now?
  const scope = { filter: null };

  async function ensureIndex(filter) {
    const key = buildFilterKey(filter);
    let rec = indexes.get(key);
    if (rec) {
      scope.filter = key;
      return true;
    }

    let persisted = null;
    const stored = await idbGet(key);
    if (stored && stored.bytes) {
      persisted = stored;
      const { ids } = decodeHexTable(stored.bytes);
      if (ids.length === 0) return false;
      rec = buildIndexRecord(ids);
      rec.generation = stored.generation || 0;
      rec.etag = stored.etag || null;
      indexes.set(key, rec);
    }

    try {
      const fresh = await fetchIndex(filter, rec?.etag || persisted?.etag || null);
      if (fresh && !fresh.notModified) {
        const { ids } = decodeHexTable(fresh.bytes);
        if (ids.length === 0) return false;
        rec = buildIndexRecord(ids);
        rec.generation = fresh.generation || '0';
        rec.etag = fresh.etag || null;
        indexes.set(key, rec);
        idbPut(key, {
          bytes: fresh.bytes,
          generation: fresh.generation,
          etag: fresh.etag,
        });
      } else if (fresh?.notModified && rec) {
        // Server says cached index is current.
      } else if (!rec) {
        return false;
      }
    } catch (err) {
      // Network hiccup: fall back to the persisted index if we have one.
      if (!rec || !rec.ids || rec.ids.length === 0) return false;
    }

    scope.filter = key;
    return true;
  }

  function current() {
    const rec = scope.filter ? indexes.get(scope.filter) : null;
    return rec || null;
  }

  function findIndex(id) {
    const rec = current();
    if (!rec || id == null) return -1;
    return rec.idToIndex.has(id) ? rec.idToIndex.get(id) : -1;
  }

  function total() {
    const rec = current();
    return rec ? rec.total : 0;
  }

  function idAt(i) {
    const rec = current();
    if (!rec || i < 0 || i >= rec.total) return null;
    return rec.ids[i];
  }

  function nextId(id) {
    const i = findIndex(id);
    if (i < 0) return null;
    return idAt((i + 1) % total());
  }

  function prevId(id) {
    const i = findIndex(id);
    if (i < 0) return null;
    return idAt((i - 1 + total()) % total());
  }

  // --- True shuffle over the SCOPED index (full folder/scope, not the window) ---
  // `setShuffle(true)` builds a Fisher-Yates order over the whole index once.
  // `shuffledNext/Prev` walk that order (one pass, no repeats) and rebuild a
  // fresh random order when the pass is exhausted — never wrapping inside the
  // small hydrated window. The order is tied to the current index record, so a
  // refetch/invalidate (new scope/filter/generation) automatically re-shuffles
  // on the next step instead of reusing stale positions.
  let shuffle = null; // { rec, order, idToPos, pos }

  function buildShuffledOrder(rec) {
    if (!rec || rec.total <= 1) return null;
    const order = rec.ids.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const idToPos = new Map();
    for (let i = 0; i < order.length; i++) idToPos.set(order[i], i);
    return { rec, order, idToPos, pos: 0 };
  }

  function shuffleState(rec) {
    if (!shuffle || shuffle.rec !== rec) {
      shuffle = buildShuffledOrder(rec);
    }
    return shuffle;
  }

  function setShuffle(on, anchorId) {
    if (!on) { shuffle = null; return; }
    const rec = current();
    if (!rec || rec.total <= 1) { shuffle = null; return; }
    shuffle = buildShuffledOrder(rec);
    if (anchorId != null && shuffle.idToPos.has(anchorId)) {
      shuffle.pos = shuffle.idToPos.get(anchorId);
    }
  }

  function shuffledNext(id) {
    const rec = current();
    if (!rec) return nextId(id);
    const st = shuffleState(rec);
    if (!st || st.order.length === 0) return null;
    let pos = st.pos;
    if (id != null) {
      const ai = st.idToPos.get(id);
      if (ai >= 0) pos = ai;
    }
    const npos = (pos + 1) % st.order.length;
    const next = st.order[npos];
    st.pos = npos;
    if (npos === 0) {
      // Pass exhausted → refresh for the next step.
      const fresh = buildShuffledOrder(rec);
      if (fresh) shuffle = fresh;
    }
    return next;
  }

  function shuffledPrev(id) {
    const rec = current();
    if (!rec) return prevId(id);
    const st = shuffleState(rec);
    if (!st || st.order.length === 0) return null;
    let pos = st.pos;
    if (id != null) {
      const ai = st.idToPos.get(id);
      if (ai >= 0) pos = ai;
    }
    const npos = (pos - 1 + st.order.length) % st.order.length;
    const prev = st.order[npos];
    st.pos = npos;
    if (npos === st.order.length - 1) {
      const fresh = buildShuffledOrder(rec);
      if (fresh) shuffle = fresh;
    }
    return prev;
  }

  // Sync object lookup (LRU). Returns undefined if not hydrated yet.
  function get(id) {
    const obj = objectCache.get(id);
    if (obj !== undefined) {
      objectCache.delete(id);
      objectCache.set(id, obj);
      return obj;
    }
    return undefined;
  }

  // Resolve an object (hydrates if needed). Returns a promise that resolves to
  // the object or null.
  async function getOrHydrate(id) {
    if (id == null) return null;
    const cached = get(id);
    if (cached !== undefined) return cached;
    const ids = [id];
    // also prefetch a small window so the player can render neighbours
    const i = findIndex(id);
    if (i >= 0) {
      for (let k = 1; k <= 4; k++) {
        const n = idAt((i + k) % total());
        const p = idAt((i - k + total()) % total());
        if (n && !objectCache.has(n)) ids.push(n);
        if (p && !objectCache.has(p)) ids.push(p);
      }
    }
    await hydrateIds(ids, onMissing);
    return get(id) !== undefined ? get(id) : null;
  }

  // Silently hydrate a window around `centerIndex` (±radius). Used by the
  // carousel so scrolling feels local.
  function prefetchWindow(centerIndex, radius = HYD_RADIUS, signal) {
    const rec = current();
    if (!rec || rec.total === 0) return Promise.resolve();
    const ids = [];
    for (let k = Math.max(0, centerIndex - radius); k <= Math.min(rec.total - 1, centerIndex + radius); k++) {
      const id = rec.ids[k];
      if (id && !objectCache.has(id)) ids.push(id);
    }
    if (ids.length === 0) return Promise.resolve();
    return hydrateIds(ids, onMissing, signal);
  }

  // Build a bounded, ordered array of objects for the Carousel around the
  // active item. Uncached slots are `null`; call `prefetchWindow` then re-read.
  function getWindow(centerIndex, radius = HYD_RADIUS) {
    const rec = current();
    if (!rec || rec.total === 0) return [];
    const out = [];
    for (let k = Math.max(0, centerIndex - radius); k <= Math.min(rec.total - 1, centerIndex + radius); k++) {
      const id = rec.ids[k];
      out.push(id && get(id) !== undefined ? get(id) : null);
    }
    return out;
  }

  // Drop a filter's index + persisted copy (e.g. after a favorite toggle that
  // changes ordering/filter membership).
  function invalidate(filter) {
    const key = buildFilterKey(filter);
    indexes.delete(key);
    idbDelete(key);
    if (scope.filter === key) scope.filter = null;
    shuffle = null;
  }

  function clearObjects() {
    objectCache.clear();
  }

  return {
    ensureIndex,
    invalidate,
    clearObjects,
    current,
    findIndex,
    total,
    idAt,
    nextId,
    prevId,
    setShuffle,
    shuffledNext,
    shuffledPrev,
    get,
    getOrHydrate,
    getWindow,
    prefetchWindow,
  };
}

export default createMediaRepository;
