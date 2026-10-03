export function getMediaGridInfo() {
  const grid = document.querySelector('[data-debug-id="1.1.6"]');
  if (!grid) return null;

  const listEl = grid.querySelector('[class*="react-window"]');
  const items = listEl ? listEl.querySelectorAll('[data-debug-id]') : [];
  const totalItems = grid.dataset.totalItems
    ? parseInt(grid.dataset.totalItems)
    : null;

  const scrollTop = listEl ? listEl.scrollTop : 0;
  const scrollHeight = listEl ? listEl.scrollHeight : 0;
  const clientHeight = listEl ? listEl.clientHeight : 0;

  return {
    visible: items.length,
    rendered: items.length,
    total: totalItems || '?',
    scrollTop,
    scrollHeight,
    clientHeight,
    scrollPercent: scrollHeight > 0
      ? Math.round((scrollTop / (scrollHeight - clientHeight)) * 100)
      : 0,
  };
}

export function getMetricsTableInfo() {
  const table = document.querySelector('[data-debug-id="2.3.4"]');
  if (!table) return null;

  const rows = table.querySelectorAll('tr, [role="row"]');
  const totalEl = table.querySelector('[data-total-rows]');

  return {
    visible: rows.length,
    rendered: rows.length,
    total: totalEl ? parseInt(totalEl.dataset.totalRows) : rows.length,
    estimatedTotal: totalEl ? parseInt(totalEl.dataset.totalRows) : '?',
  };
}

export function getPlaylistInfo() {
  const playlist = document.querySelector('[data-debug-id="5.2"]');
  if (!playlist) return null;

  const items = playlist.querySelectorAll('[data-debug-id]');
  return {
    rendered: items.length,
  };
}

export function getVirtualizationInfo() {
  const mediaGrid = getMediaGridInfo();
  const metricsTable = getMetricsTableInfo();
  const playlist = getPlaylistInfo();
  return { mediaGrid, metricsTable, playlist };
}
