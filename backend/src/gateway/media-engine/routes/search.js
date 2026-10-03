import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const engine = req.app.locals.mediaEngine;
    if (!engine) return res.status(500).json({ error: 'MEDIA_ENGINE_NOT_READY' });

    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'MISSING_QUERY', reason: 'q parameter required' });

    const result = await engine.searchFiles(query, {
      type: req.query.type,
      limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
    });

    res.json(result);
  } catch (err) {
    console.error('[gateway:search]', err);
    res.status(500).json({ error: 'INTERNAL', reason: err.message });
  }
});

export default router;
