let sseClients = [];

function getStatsSync() {
  try {
    const engine = globalThis.mediaEngine;
    if (engine?.repository?.countByType) {
      const stats = engine.repository.countByType();
      const total = stats.reduce((sum, s) => sum + s.count, 0);
      return { total, videos: stats.find((s) => s.type === 'video')?.count || 0, audio: stats.find((s) => s.type === 'audio')?.count || 0, images: stats.find((s) => s.type === 'image')?.count || 0 };
    }
  } catch {}
  try {
    const db = globalThis.db;
    if (db) {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM files').get();
      return { total: row?.cnt || 0, videos: 0, audio: 0, images: 0 };
    }
  } catch {}
  return { total: 0, videos: 0, audio: 0, images: 0 };
}

export function addSseClient(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  const stats = getStatsSync();
  res.write(`data: ${JSON.stringify({ type: 'stats_updated', data: stats })}\n\n`);
  const onClose = () => { sseClients = sseClients.filter((c) => c !== res); };
  res.on('close', onClose);
}

export function broadcastStats() {
  const stats = getStatsSync();
  const msg = `data: ${JSON.stringify({ type: 'stats_updated', data: stats })}\n\n`;
  sseClients = sseClients.filter((res) => { try { res.write(msg); return true; } catch { return false; } });
}

export function broadcastFolderUpdate(folderPath) {
  const msg = `data: ${JSON.stringify({ type: 'folder_updated', path: folderPath || '', timestamp: Date.now() })}\n\n`;
  sseClients = sseClients.filter((res) => { try { res.write(msg); return true; } catch { return false; } });
}
