import { Router } from 'express';
import { existsSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { enforcePolicy } from '../core/policy.js';

const router = Router();

router.get('/:id', async (req, res) => {
  try {
    const engine = req.app.locals.mediaEngine;
    const policy = req.app.locals.policy;
    if (!engine) return res.status(500).json({ error: 'MEDIA_ENGINE_NOT_READY' });

    const fileId = req.params.id;
    const file = await engine.resolve(fileId);
    if (!file || file.blocked) return res.status(404).json({ error: 'NOT_FOUND' });

    const { resolveFileForEngine } = await import('@homelab/media-engine');
    const internal = await resolveFileForEngine(fileId, engine.repository, engine.mediaRoots);
    if (!internal) return res.status(404).json({ error: 'NOT_FOUND' });

    const check = enforcePolicy(policy, internal || file);
    if (!check.allowed) return res.status(403).json({ error: 'FORBIDDEN', reason: check.reason });

    let thumbPath = internal.thumbCachePath;
    if (!thumbPath || !existsSync(thumbPath)) {
      return res.status(404).json({ error: 'THUMBNAIL_NOT_FOUND' });
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    createReadStream(thumbPath).pipe(res);
  } catch (err) {
    console.error('[gateway:thumbnails]', err);
    res.status(500).json({ error: 'INTERNAL', reason: err.message });
  }
});

export default router;
