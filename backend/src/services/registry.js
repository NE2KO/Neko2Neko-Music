const services = {};
const handlers = {};

export function registerService(name, { start, stop, getStatus }) {
  handlers[name] = { start, stop, getStatus };
  if (!services[name]) {
    services[name] = {
      status: 'stopped',
      startedAt: null,
      info: {},
      lastError: null,
    };
  }
}

export function setStatus(name, status, info = {}, error = null) {
  if (!services[name]) {
    services[name] = { status: 'stopped', startedAt: null, info: {}, lastError: null };
  }
  services[name].status = status;
  if (info) services[name].info = { ...services[name].info, ...info };
  if (error) services[name].lastError = error;
  if (status === 'running') {
    services[name].startedAt = Date.now();
    services[name].lastError = null;
  }
}

export function getStatus(name) {
  const svc = services[name];
  if (!svc) return null;
  return svc;
}

export function getAllStatus() {
  return { ...services };
}

export async function startService(name) {
  const handler = handlers[name];
  const svc = services[name];
  if (!handler || !svc) throw new Error(`Service "${name}" not registered`);

  if (svc.status === 'running') {
    return { already: true, status: svc.status };
  }

  svc.status = 'restarting';
  svc.lastError = null;

  try {
    if (handler.start) await handler.start();
    svc.status = 'running';
    svc.startedAt = Date.now();
    console.log(`[registry] Service "${name}" started`);
    return { success: true, status: 'running' };
  } catch (err) {
    svc.status = 'error';
    svc.lastError = err.message;
    console.error(`[registry] Service "${name}" failed to start:`, err.message);
    throw err;
  }
}

export async function stopService(name) {
  const handler = handlers[name];
  const svc = services[name];
  if (!handler || !svc) throw new Error(`Service "${name}" not registered`);

  if (svc.status === 'stopped') {
    return { already: true, status: svc.status };
  }

  try {
    if (handler.stop) await handler.stop();
    svc.status = 'stopped';
    svc.startedAt = null;
    console.log(`[registry] Service "${name}" stopped`);
    return { success: true, status: 'stopped' };
  } catch (err) {
    svc.status = 'error';
    svc.lastError = err.message;
    console.error(`[registry] Service "${name}" failed to stop:`, err.message);
    throw err;
  }
}

export async function restartService(name) {
  const svc = services[name];
  if (!svc) throw new Error(`Service "${name}" not registered`);

  svc.status = 'restarting';
  try {
    await stopService(name);
    await new Promise(r => setTimeout(r, 500));
    await startService(name);
    return { success: true, status: 'running' };
  } catch (err) {
    svc.status = 'error';
    svc.lastError = err.message;
    throw err;
  }
}

export async function restartAll() {
  const names = Object.keys(handlers);
  const results = {};
  for (const name of names) {
    try {
      const svc = services[name];
      if (svc && svc.status === 'running') {
        await restartService(name);
        results[name] = 'restarted';
      } else {
        await startService(name);
        results[name] = 'started';
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      results[name] = `error: ${err.message}`;
    }
  }
  return results;
}

export async function refreshAllStatus() {
  for (const [name, handler] of Object.entries(handlers)) {
    if (handler.getStatus) {
      try {
        const info = await handler.getStatus();
        if (services[name]) {
          services[name].info = { ...services[name].info, ...info };
        }
      } catch {}
    }
  }
}
