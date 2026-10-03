export async function listFiles(engine, policy, options = {}) {
  const result = await engine.listFiles(options);
  return { status: 200, body: result };
}
