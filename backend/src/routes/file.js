import { Router } from 'express';

const router = Router();

router.get('/:id', async (req, res) => {
  try {
    const gateway = req.app.locals.gateway;
    if (!gateway) return res.status(500).json({ error: 'MEDIA_ENGINE_NOT_READY' });

    const tokenResult = await gateway.stream.getToken(req.params.id);
    if (tokenResult.error) {
      return res.status(tokenResult.status || 403).json(tokenResult.body);
    }

    const token = tokenResult.body.token;
    await gateway.stream.stream(token, req, res, req.params.id);
  } catch (err) {
    console.error('[file] Error:', err);
    res.status(500).json({ error: 'File serving failed' });
  }
});

export default router;