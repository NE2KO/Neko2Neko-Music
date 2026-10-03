import { Router } from 'express';
import fileRouter from '../routes/file.js';
import filesRouter from '../routes/files.js';
import foldersRouter from '../routes/folders.js';
import searchRouter from '../routes/search.js';
import streamRouter from '../routes/stream.js';
import streamTokenRouter from '../routes/stream-token.js';
import batchRouter from '../routes/batch.js';
import thumbnailsRouter from '../routes/thumbnails.js';
import healthRouter from '../routes/health.js';

export function createExpressRouter(options = {}) {
  const router = Router();

  router.use(expressMiddleware(options));

  router.use('/file', fileRouter);
  router.use('/files', filesRouter);
  router.use('/folders', foldersRouter);
  router.use('/search', searchRouter);
  router.use('/stream', streamRouter);
  router.use('/stream-token', streamTokenRouter);
  router.use('/files/batch', batchRouter);
  router.use('/thumbnails', thumbnailsRouter);
  router.use('/health', healthRouter);

  return router;
}

function expressMiddleware(options) {
  return (req, res, next) => {
    req.app.locals.mediaEngine = options.engine;
    req.app.locals.policy = options.policy;
    req.app.locals.webId = options.webId;
    req.app.locals.secretKey = options.engine?.secretKey || null;
    req.app.locals.gateway = options.gateway || null;
    next();
  };
}
