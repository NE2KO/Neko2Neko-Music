export function getMemoryInfo() {
  if (!performance.memory) {
    return {
      available: false,
      usedJSHeapSize: 0,
      jsHeapSizeLimit: 0,
      totalJSHeapSize: 0,
    };
  }

  return {
    available: true,
    usedJSHeapSize: performance.memory.usedJSHeapSize,
    jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
    totalJSHeapSize: performance.memory.totalJSHeapSize,
  };
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function getMemoryUsageMB() {
  const info = getMemoryInfo();
  return info.available
    ? Math.round(info.usedJSHeapSize / (1024 * 1024))
    : 0;
}
