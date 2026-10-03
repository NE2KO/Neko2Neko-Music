import { Router } from 'express';
import { enforcePolicy } from '../core/policy.js';

const router = Router();
const DEFAULT_LIMIT = 5000;

router.get('/', async (req, res) => {
  try {
    const engine = req.app.locals.mediaEngine;
    if (!engine) return res.status(500).json({ error: 'MEDIA_ENGINE_NOT_READY' });

    const limit = Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 5000);
    const options = {
      folderId: req.query.folder_id ? parseInt(req.query.folder_id, 10) : undefined,
      type: req.query.type || undefined,
      sortBy: req.query.sortBy || 'created_at',
      sortOrder: req.query.sortOrder || 'desc',
      limit,
      cursor: req.query.cursor || undefined,
      prevCursor: req.query.prev_cursor || undefined,
    };

    const result = await engine.listFiles(options);
    if (!result || result.error) return res.status(500).json(result);

    res.json(result);
  } catch (err) {
    console.error('[gateway:files]', err);
    res.status(500).json({ error: 'INTERNAL', reason: err.message });
  }
});

export default router;
