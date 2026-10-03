// Shared grouping utility - single source of truth
// Used by MediaGrid and Carousel to avoid duplicate O(n) logic

export function getGroupLabel(item, sortBy) {
  if (!sortBy) return null;

  if (sortBy === 'name') {
    const ch = (item.name || '')[0].toUpperCase();
    return /[A-Z]/.test(ch) ? ch : '#';
  }

  if (sortBy === 'mtime' || sortBy === 'created_at') {
    const ts = item[sortBy];
    if (!ts) return 'Unknown';
    const date = new Date(ts);
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  return null;
}

export default { getGroupLabel };