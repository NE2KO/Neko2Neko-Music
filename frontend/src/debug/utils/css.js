const TYPE_COLORS = {
  container:  'rgba(255, 60, 60, 0.7)',
  grid:       'rgba(60, 120, 255, 0.7)',
  card:       'rgba(60, 220, 60, 0.7)',
  widget:     'rgba(0, 220, 220, 0.7)',
  modal:      'rgba(180, 60, 220, 0.7)',
  overlay:    'rgba(220, 200, 0, 0.7)',
  drawer:     'rgba(220, 130, 0, 0.7)',
  floating:   'rgba(220, 60, 100, 0.7)',
  table:      'rgba(160, 160, 160, 0.5)',
  chart:      'rgba(100, 200, 100, 0.5)',
  player:     'rgba(80, 160, 255, 0.5)',
  panel:      'rgba(140, 180, 255, 0.5)',
  other:      'rgba(255, 255, 255, 0.3)',
};

let styleEl = null;

export function injectLayoutStyles() {
  if (styleEl) return;

  styleEl = document.createElement('style');
  styleEl.id = 'mv-debug-layout-styles';

  const rules = Object.entries(TYPE_COLORS).map(([type, color]) => {
    return `[data-debug-type="${type}"] { outline: 2px ${color} solid !important; outline-offset: -1px !important; box-shadow: inset 0 0 0 1px ${color} !important; }`;
  }).join('\n');

  const badgeStyle = `
    .mv-debug-badge {
      position: absolute;
      bottom: 2px;
      left: 2px;
      z-index: 99999 !important;
      pointer-events: none;
      font-size: 10px;
      font-family: monospace;
      background: rgba(0, 200, 150, 0.85);
      color: #000;
      padding: 1px 5px;
      border-radius: 2px;
      line-height: 1.3;
      white-space: nowrap;
      max-width: 90%;
      overflow: hidden;
      textOverflow: 'ellipsis';
    }
  `;

  styleEl.textContent = rules + '\n' + badgeStyle;
  document.head.appendChild(styleEl);
}

export function removeLayoutStyles() {
  if (styleEl && styleEl.parentNode) {
    styleEl.parentNode.removeChild(styleEl);
    styleEl = null;
  }
}

export function getTypeColor(type) {
  return TYPE_COLORS[type] || TYPE_COLORS.other;
}
