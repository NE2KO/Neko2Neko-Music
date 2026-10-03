import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  const engine = req.app.locals.mediaEngine;
  res.json({
    status: 'ok',
    webId: req.app.locals.webId,
    policies: engine && engine._policies ? Array.from(engine._policies.keys()) : [],
  });
});

export default router;
