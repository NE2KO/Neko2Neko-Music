import os from 'node:os';
import { getSnapshot, setPaused } from './resourceManager.js';

const STATE = {
  memoryPaused: false,
  ioPaused: false,
  cpuThrottled: false,
};

const HYSTERESIS = {
  memoryPauseThreshold: 0.10,
  memoryResumeThreshold: 0.25,
  ioPauseThreshold: 0.95,
  ioResumeThreshold: 0.70,
  cpuPauseThreshold: 0.90,
  cpuResumeThreshold: 0.70,
};

export function startAdaptiveController(intervalMs = 2000) {
  setInterval(() => {
    const snapshot = getSnapshot();
    const mem = snapshot.memory;
    const cpu = snapshot.cpu;
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memRatio = freeMem / totalMem;

    const loadAvg = cpu.loadAvg[0] || 0;
    const cpuCores = os.cpus().length;
    const cpuRatio = loadAvg / cpuCores;

    // Memory hysteresis
    if (!STATE.memoryPaused && memRatio < HYSTERESIS.memoryPauseThreshold) {
      STATE.memoryPaused = true;
      setPaused('scanner', true);
      setPaused('thumbnail', true);
      if (globalThis.mediaScanner) globalThis.mediaScanner.pause();
    } else if (STATE.memoryPaused && memRatio > HYSTERESIS.memoryResumeThreshold) {
      STATE.memoryPaused = false;
      setPaused('scanner', false);
      setPaused('thumbnail', false);
      if (globalThis.mediaScanner) globalThis.mediaScanner.resume();
    }

    // CPU hysteresis
    if (!STATE.cpuThrottled && cpuRatio > HYSTERESIS.cpuPauseThreshold) {
      STATE.cpuThrottled = true;
      setPaused('scanner', true);
      if (globalThis.mediaScanner) globalThis.mediaScanner.pause();
    } else if (STATE.cpuThrottled && cpuRatio < HYSTERESIS.cpuResumeThreshold) {
      STATE.cpuThrottled = false;
      setPaused('scanner', false);
      if (globalThis.mediaScanner) globalThis.mediaScanner.resume();
    }
  }, intervalMs);
}
