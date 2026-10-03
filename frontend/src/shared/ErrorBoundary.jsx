import React from 'react';

// Lazy-loaded only when a crash actually happens, so it stays out of the
// normal app bundle.
let smcModulePromise = null;
const consumerCache = new Map(); // chunk url -> Promise<SourceMapConsumer|null>

async function getConsumer(chunkUrl) {
  if (!smcModulePromise) smcModulePromise = import('source-map-js');
  const mod = await smcModulePromise;
  if (consumerCache.has(chunkUrl)) return consumerCache.get(chunkUrl);
  const mapUrl = chunkUrl.endsWith('.map') ? chunkUrl : chunkUrl + '.map';
  const p = fetch(mapUrl)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (!j) return null;
      let c = new mod.SourceMapConsumer(j);
      if (c && typeof c.then === 'function') return c; // async in some versions
      return c;
    })
    .catch(() => null);
  consumerCache.set(chunkUrl, p);
  return p;
}

// Map a minified/bundled prod stack (e.g. `index-XXX.js:123:45`) back to
// the original `src/.../File.jsx:LINE:COLUMN`, so the crash screen
// tells you the real line instead of making you guess.
async function rewriteStackTrace(raw) {
  const lines = (raw || '').split('\n');
  const out = [];
  for (const line of lines) {
    const m = line.match(/((?:https?:\/\/[^)\s]+|\/[^\s)]*\.js)):(\d+):(\d+)/);
    if (!m) { out.push(line); continue; }
    const file = m[1];
    const lineNo = parseInt(m[2], 10);
    const colNo = parseInt(m[3], 10);
    const abs = file.startsWith('http') ? file : window.location.origin + file;
    const consumer = await getConsumer(abs);
    let mapped = null;
    if (consumer) {
      for (const col of [colNo, colNo - 1]) {
        const pos = consumer.originalPositionFor({ line: lineNo, column: col });
        if (pos && pos.source) { mapped = pos; break; }
      }
    }
    if (mapped) {
      const src = mapped.source
        .replace(/^webpack:\/\/\//, '')
        .replace(/^\//, '');
      out.push(line.replace(m[0], `${src}:${mapped.line}:${mapped.column ?? 0}`));
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

export function ErrorScreen({
  title = 'Something went wrong',
  error,
  componentStack,
  mappedStack,
  resolving,
  retryLabel,
  reloadLabel,
  chunkNote,
}) {
  const isChunk = error?.message?.includes('dynamically imported module') ||
    error?.message?.includes('Failed to fetch dynamically imported module');
  const stack = mappedStack != null ? mappedStack : (error?.stack || '');
  return (
    <div className="h-screen flex items-center justify-center bg-neutral-950 text-red-400 overflow-auto p-4">
      <div className="text-center max-w-2xl w-full">
        <h2 className="text-lg font-bold mb-2">{title}</h2>
        <p className="text-sm mb-3 break-words">{error?.message || 'Unknown error'}</p>
        {resolving && <p className="text-xs text-neutral-500 mb-2">Resolving source locations…</p>}
        <div className="text-left mb-3">
          <p className="text-[10px] text-neutral-500 mb-1">Source stack (File.jsx:LINE)</p>
          <pre className="text-[10px] text-neutral-400 bg-neutral-900 p-3 rounded-lg max-h-72 overflow-auto whitespace-pre-wrap break-all">{stack || 'No stack trace'}</pre>
        </div>
        {componentStack ? (
          <div className="text-left mb-3">
            <p className="text-[10px] text-neutral-500 mb-1">Component tree</p>
            <pre className="text-[10px] text-neutral-600 bg-neutral-900 p-3 rounded-lg max-h-48 overflow-auto whitespace-pre-wrap break-all">{componentStack}</pre>
          </div>
        ) : null}
        {(chunkNote || isChunk) && (
          <p className="text-xs text-neutral-500 mb-3">{chunkNote || 'This is usually a stale cached module. Reloading the page fixes it.'}</p>
        )}
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-neutral-700 text-white rounded hover:bg-neutral-600 transition-colors"
          >
            {reloadLabel || (isChunk ? 'Reload Page' : (title === 'Monitoring Error' ? 'Reload Monitoring' : 'Reload'))}
          </button>
        </div>
      </div>
    </div>
  );
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: '', mappedStack: null, resolving: false };
    this.handleRetry = () => {
      this.setState({ hasError: false, error: null, componentStack: '', mappedStack: null, resolving: false });
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.setState({ componentStack: errorInfo?.componentStack || '' });
    this.resolveStack(error);
  }

  async resolveStack(error) {
    this.setState({ resolving: true });
    try {
      const mapped = await rewriteStackTrace(error?.stack || '');
      this.setState({ mappedStack: mapped });
    } catch {
      // Keep the raw stack if source-map rewriting fails.
    } finally {
      this.setState({ resolving: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorScreen
          title={this.props.title}
          error={this.state.error}
          componentStack={this.state.componentStack}
          mappedStack={this.state.mappedStack}
          resolving={this.state.resolving}
          retryLabel={this.props.retryLabel}
          reloadLabel={this.props.reloadLabel}
          chunkNote={this.props.chunkNote}
        />
      );
    }
    return this.props.children;
  }
}
