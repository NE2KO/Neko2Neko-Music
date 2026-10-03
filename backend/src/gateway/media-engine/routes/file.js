import { Router } from 'express';
import { getFile } from '../handlers/file.js';

const router = Router();

router.get('/:id', async (req, res) => {
  const engine = req.app.locals.mediaEngine;
  const policy = req.app.locals.policy;
  if (!engine) return res.status(500).json({ error: 'MEDIA_ENGINE_NOT_READY' });

  const result = await getFile(engine, policy, req.params.id);
  res.status(result.status).json(result.body);
});

export default router;
