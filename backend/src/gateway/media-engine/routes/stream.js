import { Router } from 'express';
import { verifyToken } from '../core/token.js';
import { enforcePolicy } from '../core/policy.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const engine = req.app.locals.mediaEngine;
    const policy = req.app.locals.policy;
    const secretKey = req.app.locals.secretKey;
    if (!engine) return res.status(500).json({ error: 'MEDIA_ENGINE_NOT_READY' });

    const token = req.query.token;
    let fileId = null;

    if (secretKey && token) {
      const verification = verifyToken(secretKey, token);
      if (!verification.valid) {
        return res.status(401).json({ error: 'UNAUTHORIZED', reason: verification.reason });
      }
      fileId = verification.payload.id;
    } else if (!secretKey && token) {
      return res.status(401).json({ error: 'UNAUTHORIZED', reason: 'Token not supported without secretKey' });
    }

    if (!fileId && req.query.id) {
      fileId = req.query.id;
    }

    if (!fileId) {
      return res.status(400).json({ error: 'MISSING_ID', reason: 'token or id required' });
    }

    const file = await engine.resolve(fileId);
    if (!file || file.blocked) return res.status(404).json({ error: 'NOT_FOUND' });

    const { resolveFileForEngine } = await import('@homelab/media-engine');
    const internal = await resolveFileForEngine(fileId, engine.repository, engine.mediaRoots);
    if (!internal || !internal.exists) return res.status(404).json({ error: 'NOT_FOUND' });

    if (policy) {
      const check = enforcePolicy(policy, internal || file);
      if (!check.allowed) return res.status(403).json({ error: 'FORBIDDEN', reason: check.reason });
    }

    const mimeType = engine._guessMimeType(file.ext);
    const fileSize = file.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
        'Cache-Control': 'no-store',
      });

      const { createReadStream } = await import('node:fs');
      const stream = createReadStream(internal.fullPath, { start, end });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      });

      const { createReadStream } = await import('node:fs');
      createReadStream(internal.fullPath).pipe(res);
    }
  } catch (err) {
    if (!res.headersSent) {
      console.error('[gateway:stream]', err);
      res.status(500).json({ error: 'INTERNAL', reason: err.message });
    }
  }
});

export default router;
