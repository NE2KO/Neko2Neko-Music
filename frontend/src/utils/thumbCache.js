const cache = new Map();
const pending = new Map();
const queue = [];
const promiseMap = new Map(); 
const MAX_CONCURRENT = 4;
let activeCount = 0;

async function processQueue() {
  while (queue.length > 0 && activeCount < MAX_CONCURRENT) {
    const item = queue.shift();
    if (cache.has(item.url)) {
      item.resolve(cache.get(item.url));
      promiseMap.delete(item.url);
      continue;
    }

    activeCount++;
    pending.set(item.url, { url: item.url, retriesLeft: item.retries, delay: item.delay });
    fetchWithRetry(item.url, item.retries, item.delay)
      .then((blobUrl) => {
        pending.delete(item.url);
        item.resolve(blobUrl);
        promiseMap.delete(item.url);
      })
      .catch(() => {
        pending.delete(item.url);
        item.resolve(null);
        promiseMap.delete(item.url);
      })
      .finally(() => {
        activeCount--;
        processQueue();
      });
  }
}

async function fetchWithRetry(url, retries, delay) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      cache.set(url, blobUrl);
      return blobUrl;
    } catch {
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  return null;
}

function fetchBlob(url, options = {}) {
  const { priority = 'high', retries = 3, delay = 300 } = options;

  if (cache.has(url)) return Promise.resolve(cache.get(url));

  if (promiseMap.has(url)) {
    return promiseMap.get(url);
  }

  if (pending.has(url)) return Promise.resolve(null);

  const promise = new Promise((resolve) => {
    const item = { url, priority, retries, delay, resolve };
    if (priority === 'high') {
      queue.unshift(item);
    } else {
      queue.push(item);
    }
    processQueue();
  });

  promiseMap.set(url, promise);
  return promise;
}

function getCached(url) {
  return cache.get(url);
}

function clearCache() {
  for (const url of cache.values()) {
    URL.revokeObjectURL(url);
  }
  cache.clear();
  queue.length = 0;
  pending.clear();
  activeCount = 0;
}

export { fetchBlob, getCached, clearCache };
