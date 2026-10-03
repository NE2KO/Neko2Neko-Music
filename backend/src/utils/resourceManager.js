import os from 'node:os';

const subsystems = new Map();
let snapshotInterval = null;
let ioReadBytes = 0;
let ioWriteBytes = 0;
let lastCpuUsage = null;
let lastCpuTime = null;

export function registerSubsystem(name, config = {}) {
  subsystems.set(name, {
    name,
    memoryBudget: config.memoryBudget || 0,
    ioPriority: config.ioPriority || 'low',
    cpuPriority: config.cpuPriority || 'low',
    memoryUsed: 0,
    ioRead: 0,
    ioWrite: 0,
    cpuTime: 0,
    paused: false,
    lastSnapshot: null,
  });
}

export function getSnapshot() {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage(lastCpuUsage);
  const now = Date.now();

  const snapshot = {
    timestamp: now,
    memory: {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      subsystems: {},
    },
    io: {
      readBytes: ioReadBytes,
      writeBytes: ioWriteBytes,
    },
    cpu: {
      user: cpu.user,
      system: cpu.system,
      loadAvg: os.loadavg(),
    },
    subsystems: {},
  };

  for (const [name, sub] of subsystems) {
    snapshot.memory.subsystems[name] = {
      memoryUsed: sub.memoryUsed,
      memoryBudget: sub.memoryBudget,
      paused: sub.paused,
    };
    snapshot.subsystems[name] = {
      ioPriority: sub.ioPriority,
      cpuPriority: sub.cpuPriority,
      paused: sub.paused,
    };
  }

  // Update last usage
  lastCpuUsage = process.cpuUsage(lastCpuUsage);
  lastCpuTime = now;

  return snapshot;
}

export function recordMemoryUsage(subsystemName, bytes) {
  const sub = subsystems.get(subsystemName);
  if (sub) {
    sub.memoryUsed = bytes;
  }
}

export function recordIO(subsystemName, readBytes = 0, writeBytes = 0) {
  const sub = subsystems.get(subsystemName);
  if (sub) {
    sub.ioRead += readBytes;
    sub.ioWrite += writeBytes;
  }
  ioReadBytes += readBytes;
  ioWriteBytes += writeBytes;
}

export function setPaused(subsystemName, paused) {
  const sub = subsystems.get(subsystemName);
  if (sub) {
    sub.paused = paused;
  }
}

export function isPaused(subsystemName) {
  const sub = subsystems.get(subsystemName);
  return sub ? sub.paused : false;
}

export function startSnapshotTicker(intervalMs = 1000) {
  if (snapshotInterval) return;
  lastCpuUsage = process.cpuUsage();
  snapshotInterval = setInterval(() => {
    const snapshot = getSnapshot();
    for (const [name, sub] of subsystems) {
      sub.lastSnapshot = snapshot;
    }
  }, intervalMs);
}

export function stopSnapshotTicker() {
  if (snapshotInterval) {
    clearInterval(snapshotInterval);
    snapshotInterval = null;
  }
}

export function getSubsystemState(name) {
  return subsystems.get(name) || null;
}

export function enforceBudget() {
  const snapshot = getSnapshot();
  const mem = snapshot.memory;
  const totalBudget = subsystems.size > 0
    ? Array.from(subsystems.values()).reduce((sum, s) => sum + s.memoryBudget, 0)
    : 0;

  if (totalBudget === 0) return snapshot;

  for (const [name, sub] of subsystems) {
    if (sub.memoryBudget > 0 && sub.memoryUsed > sub.memoryBudget) {
      sub.paused = true;
    }
  }

  return snapshot;
}
