import { verifyToken, createToken } from '../core/token.js';
import { enforcePolicy } from '../core/policy.js';

export async function getStreamToken(engine, policy, secretKey, webId, fileId) {
  const file = await engine.resolve(fileId);
  if (!file || file.blocked) {
    return { status: 404, body: { error: 'NOT_FOUND' } };
  }

  const { resolveFileForEngine } = await import('@homelab/media-engine');
  const internal = await resolveFileForEngine(fileId, engine.repository, engine.mediaRoots);

  const check = enforcePolicy(policy, internal || file);
  if (!check.allowed) {
    return { status: 403, body: { error: 'FORBIDDEN', reason: check.reason } };
  }

  if (!secretKey) {
    return {
      status: 200,
      body: {
        token: null,
        streamUrl: `/api/media/stream?id=${encodeURIComponent(fileId)}`,
      },
    };
  }

  const token = createToken(secretKey, { id: fileId, web: webId });
  return {
    status: 200,
    body: {
      token,
      streamUrl: `/api/media/stream?token=${token}`,
    },
  };
}

export async function streamFile(engine, policy, secretKey, token, req, res, fallbackFileId) {
  let fileId = null;

  if (token) {
    const verification = verifyToken(secretKey, token);
    if (!verification.valid) {
      res.status(401).json({ error: 'UNAUTHORIZED', reason: verification.reason });
      return { status: 401, res };
    }
    fileId = verification.payload.id;
  }

  if (!fileId && fallbackFileId) {
    fileId = fallbackFileId;
  }

  if (!fileId && req.query && req.query.id) {
    fileId = req.query.id;
  }

  if (!fileId) {
    res.status(400).json({ error: 'MISSING_ID', reason: 'token or id required' });
    return { status: 400, res };
  }

  const file = await engine.resolve(fileId);
  if (!file || file.blocked) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return { status: 404, res };
  }

  const { resolveFileForEngine } = await import('@homelab/media-engine');
  const internal = await resolveFileForEngine(fileId, engine.repository, engine.mediaRoots);
  if (!internal || !internal.exists) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return { status: 404, res };
  }

  if (policy) {
    const check = enforcePolicy(policy, internal || file);
    if (!check.allowed) {
      res.status(403).json({ error: 'FORBIDDEN', reason: check.reason });
      return { status: 403, res };
    }
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
    return { status: 206, res };
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });

    const { createReadStream } = await import('node:fs');
    createReadStream(internal.fullPath).pipe(res);
    return { status: 200, res };
  }
}
