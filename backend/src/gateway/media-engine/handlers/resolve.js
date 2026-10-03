import { enforcePolicy } from '../core/policy.js';

export async function resolve(engine, policy, fileId) {
  const file = await engine.resolve(fileId);
  if (!file || file.blocked) {
    return { ok: false, error: 'NOT_FOUND' };
  }

  const { resolveFileForEngine } = await import('@homelab/media-engine');
  const internal = await resolveFileForEngine(fileId, engine.repository, engine.mediaRoots);

  const check = enforcePolicy(policy, internal || file);
  if (!check.allowed) {
    return { ok: false, error: 'FORBIDDEN', reason: check.reason };
  }

  return {
    ok: true,
    file,
    internal,
  };
}
