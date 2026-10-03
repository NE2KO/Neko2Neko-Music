import { Router } from 'express';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const engine = req.app.locals.mediaEngine;
    if (!engine) return res.status(500).json({ error: 'MEDIA_ENGINE_NOT_READY' });

    const { ids } = req.body || {};
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'INVALID_BODY', reason: 'ids array required' });

    const result = await engine.getBatchFiles(ids);
    res.json(result);
  } catch (err) {
    console.error('[gateway:batch]', err);
    res.status(500).json({ error: 'INTERNAL', reason: err.message });
  }
});

export default router;
