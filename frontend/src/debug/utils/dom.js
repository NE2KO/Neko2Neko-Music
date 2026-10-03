export function findDebugElement(el) {
  let current = el;
  while (current) {
    if (current.dataset && current.dataset.debugId) return current;
    current = current.parentElement;
  }
  return null;
}

export function getDebugAttributes(el) {
  if (!el || !el.dataset) return null;
  return {
    id: el.dataset.debugId || null,
    name: el.dataset.debugName || null,
    type: el.dataset.debugType || 'other',
  };
}

export function injectBadge(el, debugId, debugName) {
  const existing = el.querySelector('.mv-debug-badge');
  if (existing) existing.remove();

  const badge = document.createElement('div');
  badge.className = 'mv-debug-badge';
  badge.textContent = `[${debugId}] ${debugName}`;

  Object.assign(badge.style, {
    position: 'absolute',
    bottom: '2px',
    left: '2px',
    zIndex: '99999',
    pointerEvents: 'none',
    fontSize: '10px',
    fontFamily: 'monospace',
    background: 'rgba(0, 200, 150, 0.85)',
    color: '#000',
    padding: '1px 5px',
    borderRadius: '2px',
    lineHeight: '1.3',
    whiteSpace: 'nowrap',
    maxWidth: '90%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });

  el.style.position = el.style.position || 'relative';
  el.appendChild(badge);
}

export function clearAllBadges() {
  document.querySelectorAll('.mv-debug-badge').forEach(b => b.remove());
}

export function scanAndInjectBadges() {
  const elements = document.querySelectorAll('[data-debug-id]');
  elements.forEach(el => {
    if (!el.querySelector('.mv-debug-badge')) {
      injectBadge(el, el.dataset.debugId, el.dataset.debugName || '');
    }
  });
}

export function getParentInfo(el) {
  if (!el) return '\u2014';
  const parent = el.parentElement;
  if (!parent) return '\u2014';
  const attrs = getDebugAttributes(parent);
  if (attrs) return `${attrs.name} (${attrs.id})`;
  return parent.tagName.toLowerCase();
}

export function getElementSize(el) {
  if (!el) return { width: 0, height: 0 };
  const rect = el.getBoundingClientRect();
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

export function countDebugChildren(el) {
  if (!el) return 0;
  return el.querySelectorAll('[data-debug-id]').length;
}
