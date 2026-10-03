const MAX_PAGES = 10;
const PAGE_SIZE = 500;
const ITEM_BYTES = 300;
const MAX_CACHE_BYTES = 256 * 1024 * 1024; // 256MB

const pages = new Map();
let accessOrder = [];
let totalBytes = 0;
let fetchFn = null;

export function pageCacheInit(fetch) {
  fetchFn = fetch;
}

export async function pageCacheGet(key) {
  const page = pages.get(key);
  if (page) {
    page.lastAccess = Date.now();
    return { items: page.items, hit: true };
  }

  // Cache miss: auto re-fetch if fetchFn is provided
  if (fetchFn) {
    try {
      const items = await fetchFn(key);
      if (items && items.length > 0) {
        pageCacheSet(key, items);
        return { items, hit: false, reloaded: true };
      }
    } catch {}
  }

  return { items: [], hit: false };
}

export function pageCacheSet(key, items) {
  const bytes = items.length * ITEM_BYTES;

  while (totalBytes + bytes > MAX_CACHE_BYTES && accessOrder.length > 0) {
    const oldest = accessOrder.shift();
    if (oldest && pages.has(oldest)) {
      const evicted = pages.get(oldest);
      totalBytes -= evicted.items.length * ITEM_BYTES;
      pages.delete(oldest);
    }
  }

  pages.set(key, { items, lastAccess: Date.now() });
  accessOrder.push(key);
  totalBytes += bytes;

  while (totalBytes > MAX_CACHE_BYTES && accessOrder.length > 1) {
    const oldest = accessOrder.shift();
    if (oldest && pages.has(oldest)) {
      const evicted = pages.get(oldest);
      totalBytes -= evicted.items.length * ITEM_BYTES;
      pages.delete(oldest);
    }
  }
}

export function pageCacheEvict(key) {
  const page = pages.get(key);
  if (page) {
    totalBytes -= page.items.length * ITEM_BYTES;
    pages.delete(key);
    accessOrder = accessOrder.filter(k => k !== key);
  }
}

export function pageCacheClear() {
  pages.clear();
  accessOrder = [];
  totalBytes = 0;
}

export function pageCacheStats() {
  return {
    pages: pages.size,
    maxPages: MAX_PAGES,
    totalBytes,
    maxBytes: MAX_CACHE_BYTES,
    utilization: totalBytes / MAX_CACHE_BYTES,
  };
}
