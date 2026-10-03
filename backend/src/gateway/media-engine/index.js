import { createExpressRouter } from './adapters/express.js';
import { loadConfig } from '@homelab/media-engine';
import { getFile } from './handlers/file.js';
import { listFiles } from './handlers/files.js';
import { getStreamToken, streamFile } from './handlers/stream.js';

export function createGateway(options) {
  const engine = options.engine;
  const webId = options.webId;
  const prefix = options.prefix || '/api/media';

  if (!engine) throw new Error('MediaEngine instance is required');
  if (!webId) throw new Error('webId is required');

  let policy = null;
  if (engine._policies && engine._policies.size > 0) {
    policy = engine._getPolicy(webId);
  }

  const secretKey = engine.secretKey || null;

  const gateway = {
    webId,
    prefix,
    policy,
    engine,
    file: {
      get: (fileId) => getFile(engine, policy, fileId),
    },
    files: {
      list: (opts) => listFiles(engine, policy, opts),
    },
    stream: {
      getToken: (fileId) => getStreamToken(engine, policy, secretKey, webId, fileId),
      stream: (token, req, res, fallbackFileId) => streamFile(engine, policy, secretKey, token, req, res, fallbackFileId),
    },
  };

  gateway.router = createExpressRouter({ engine, policy, webId, prefix, gateway });

  return gateway;
}

export { loadConfig } from '@homelab/media-engine';