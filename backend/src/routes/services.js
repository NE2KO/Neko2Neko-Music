import { Router } from 'express';
import { registerService, setStatus, getAllStatus, getStatus, startService, stopService, restartService, restartAll } from '../services/registry.js';
import { startMaintenanceScheduler, stopMaintenanceScheduler, isMaintenanceRunning } from '../utils/maintenance.js';
import { stopQueue, startQueue, isQueueStopped, getQueueStatus } from '../utils/thumbnailQueue.js';
import { scanPlaylists, stopScan, getPlaylistScannerStatus } from '../utils/playlistScanner.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    refreshStatuses();
    const all = getAllStatus();
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:name', (req, res) => {
  const status = getStatus(req.params.name);
  if (!status) return res.status(404).json({ error: 'Service not found' });
  res.json(status);
});

router.post('/:name/start', async (req, res) => {
  try {
    await startService(req.params.name);
    res.json({ success: true, status: getStatus(req.params.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:name/stop', async (req, res) => {
  try {
    await stopService(req.params.name);
    res.json({ success: true, status: getStatus(req.params.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:name/restart', async (req, res) => {
  try {
    await restartService(req.params.name);
    res.json({ success: true, status: getStatus(req.params.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/restart-all', async (req, res) => {
  try {
    const results = await restartAll();
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function refreshStatuses() {
  const musicStatus = getStatus('music');
  if (musicStatus) {
    const watcherRunning = globalThis.mediaScanner?.getStatus?.()?.isWatcherRunning || false;
    const maintenanceRunning = isMaintenanceRunning();
    const thumbStopped = isQueueStopped();
    const actuallyRunning = watcherRunning || maintenanceRunning || !thumbStopped;
    if (musicStatus.status !== 'stopped') {
      musicStatus.status = actuallyRunning ? 'running' : 'stopped';
    }
    musicStatus.info = {
      watcher: watcherRunning,
      maintenance: maintenanceRunning,
      thumbnails: !thumbStopped,
      thumbPending: getQueueStatus().pending,
    };
  }

  const plStatus = getStatus('playlists');
  if (plStatus) {
    plStatus.info = getPlaylistScannerStatus();
  }
}

export function registerAllServices() {
  registerServiceWithHandlers('music', {
    start: async () => {
      if (globalThis.mediaScanner) globalThis.mediaScanner.startWatcher();
      startMaintenanceScheduler();
      startQueue();
    },
    stop: async () => {
      if (globalThis.mediaScanner) globalThis.mediaScanner.stopWatcher();
      stopMaintenanceScheduler();
      stopQueue();
    },
    getStatus: async () => ({
      watcher: globalThis.mediaScanner?.getStatus?.()?.isWatcherRunning || false,
      maintenance: isMaintenanceRunning(),
      thumbnails: !isQueueStopped(),
      thumbPending: getQueueStatus().pending,
    }),
  });

  registerServiceWithHandlers('playlists', {
    start: async () => { await scanPlaylists(); },
    stop: async () => { stopScan(); },
    getStatus: async () => getPlaylistScannerStatus(),
  });

  setStatus('music', 'running', { watcher: true, maintenance: true, thumbnails: true });
  setStatus('playlists', 'running', {});
}

function registerServiceWithHandlers(name, handlers) {
  registerService(name, handlers);
}

export default router;
