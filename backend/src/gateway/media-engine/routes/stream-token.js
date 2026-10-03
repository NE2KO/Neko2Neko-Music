import { Router } from 'express';
import { createToken } from '../core/token.js';
import { enforcePolicy } from '../core/policy.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const engine = req.app.locals.mediaEngine;
    const policy = req.app.locals.policy;
    const secretKey = req.app.locals.secretKey;
    const webId = req.app.locals.webId;
    if (!engine || !secretKey) return res.status(500).json({ error: 'MEDIA_ENGINE_NOT_READY' });

    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'MISSING_ID', reason: 'id is required in request body' });

    const file = await engine.resolve(id);
    if (!file || file.blocked) return res.status(404).json({ error: 'NOT_FOUND' });

    const { resolveFileForEngine } = await import('@homelab/media-engine');
    const internal = await resolveFileForEngine(id, engine.repository, engine.mediaRoots);
    const check = enforcePolicy(policy, internal || file);
    if (!check.allowed) return res.status(403).json({ error: 'FORBIDDEN', reason: check.reason });

    const token = createToken(secretKey, { id, web: webId });
    res.json({ token, streamUrl: `/api/media/stream?token=${token}` });
  } catch (err) {
    console.error('[gateway:stream-token]', err);
    res.status(500).json({ error: 'INTERNAL', reason: err.message });
  }
});

export default router;
