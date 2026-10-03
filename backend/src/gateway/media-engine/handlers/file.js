import { enforcePolicy } from '../core/policy.js';

export async function getFile(engine, policy, fileId) {
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

  return {
    status: 200,
    body: {
      id: file.id,
      name: file.name,
      type: file.type,
      mimeType: engine._guessMimeType(file.ext),
      size: file.size,
      exists: file.exists,
      dirPath: file.dirPath,
      ext: file.ext,
    },
  };
}
