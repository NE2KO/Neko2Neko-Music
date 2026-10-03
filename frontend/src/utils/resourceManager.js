import { pageCacheStats } from './pageCache.js';

let thumbnailCount = 0;
let workerHeapBytes = 0;

export function trackThumbnails(count) {
  thumbnailCount = count;
}

export function trackWorkerHeap(bytes) {
  workerHeapBytes = bytes;
}

export function getFrontendSnapshot() {
  const cacheStats = pageCacheStats();
  return {
    pageCache: cacheStats,
    thumbnails: {
      count: thumbnailCount,
    },
    worker: {
      heapBytes: workerHeapBytes,
    },
    budgets: {
      maxCacheBytes: 256 * 1024 * 1024,
      maxThumbnails: 500,
      maxWorkerHeap: 128 * 1024 * 1024,
    },
  };
}
