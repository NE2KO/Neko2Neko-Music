// mediaWorker.js — single worker for heavy computation
// Handles: merge, filter/sort, carousel setup, shuffle, search scoring, playlist window

function stableMerge(oldList = [], newList = []) {
  if (!oldList.length) return newList;
  if (!newList.length) return oldList;
  const oldMap = new Map(oldList.map(i => [i.id, i]));
  const result = [...oldList];
  const indexMap = new Map(result.map((item, idx) => [item.id, idx]));
  for (const newItem of newList) {
    const oldItem = oldMap.get(newItem.id);
    if (!oldItem) {
      result.push(newItem);
      indexMap.set(newItem.id, result.length - 1);
    } else if (oldItem.type !== newItem.type || oldItem.name !== newItem.name) {
      const idx = indexMap.get(newItem.id);
      if (idx !== undefined) {
        result[idx] = { ...oldItem, ...newItem };
      }
    }
  }
  return result;
}

function filterSort(items, filter, sortBy, sortOrder, favoriteOnly) {
  let result = items;
  if (filter && filter !== 'all' && filter !== 'folder' && filter !== 'love') {
    result = result.filter(f => f.type === filter);
  }
  if (favoriteOnly) {
    result = result.filter(f => f.is_favorite === 1);
  }
  if (filter === 'love') {
    result = result.filter(f => f.is_favorite === 1);
  }
  if (sortBy) {
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') {
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortBy === 'mtime') {
        cmp = (a.mtime || 0) - (b.mtime || 0);
      } else if (sortBy === 'created_at') {
        cmp = (a.created_at || 0) - (b.created_at || 0);
      } else if (sortBy === 'size') {
        cmp = (a.size || 0) - (b.size || 0);
      }
      return sortOrder === 'desc' ? -cmp : cmp;
    });
  }
  return result;
}

function buildCarouselNodes(files, pitch, dividerWidths) {
  const nodes = [];
  for (let i = 0; i < files.length; i++) {
    nodes.push({ type: 'item', file: files[i], index: i });
  }
  const prefix = new Array(nodes.length + 1);
  prefix[0] = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const w = n.type === 'item' ? pitch : (dividerWidths[n.folderName || n.label] || 200);
    prefix[i + 1] = prefix[i] + w;
  }
  const nodeIndexById = new Map();
  for (let i = 0; i < nodes.length; i++) {
    nodeIndexById.set(nodes[i].file.id, i);
  }
  return { nodes, prefix, nodeIndexById };
}

function buildShuffleOrder(items, seed) {
  const order = items.map((_, i) => i);
  let s = seed | 0;
  for (let i = order.length - 1; i > 0; i--) {
    s |= 0;
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const j = ((t ^ (t >>> 14)) >>> 0) / 4294967296 * (i + 1);
    [order[i], order[Math.floor(j)]] = [order[Math.floor(j)], order[i]];
  }
  return order;
}

self.onmessage = (e) => {
  const { id, type, payload } = e.data;
  let result;
  try {
    switch (type) {
      case 'merge':
        result = stableMerge(payload.oldList, payload.newList);
        break;
      case 'filter':
        result = filterSort(payload.items, payload.filter, payload.sortBy, payload.sortOrder, payload.favoriteOnly);
        break;
      case 'carouselSetup':
        result = buildCarouselNodes(payload.files, payload.pitch, payload.dividerWidths);
        break;
      case 'shuffle':
        result = buildShuffleOrder(payload.items, payload.seed);
        break;
      default:
        throw new Error(`Unknown worker message type: ${type}`);
    }
    self.postMessage({ id, result, error: null });
  } catch (err) {
    self.postMessage({ id, result: null, error: err.message });
  }
};
