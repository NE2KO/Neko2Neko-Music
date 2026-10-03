// WorkerPool manages N web workers for parallel computation
export class WorkerPool {
  constructor(workerPath, poolSize = 2) {
    this.workers = [];
    this.taskId = 0;
    this.pending = new Map();
    this.queue = [];
    this.workerPath = workerPath;

    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(new URL(workerPath, import.meta.url), { type: 'module' });
      worker.onmessage = (e) => this.handleMessage(i, e);
      worker.onerror = (err) => {
        console.error(`[WorkerPool] Worker ${i} error:`, err);
        this.restartWorker(i);
      };
      this.workers.push(worker);
    }
  }

  restartWorker(index) {
    const old = this.workers[index];
    if (old) old.terminate();

    const worker = new Worker(new URL(this.workerPath, import.meta.url), { type: 'module' });
    worker.onmessage = (e) => this.handleMessage(index, e);
    worker.onerror = (err) => {
      console.error(`[WorkerPool] Worker ${index} error after restart:`, err);
      this.restartWorker(index);
    };
    this.workers[index] = worker;

    // Retry pending tasks
    for (const [taskId, task] of this.pending) {
      if (task.workerIndex === index) {
        this.postToWorker(index, task);
      }
    }
  }

  handleMessage(workerIndex, e) {
    const { id, result, error } = e.data;
    const task = this.pending.get(id);
    if (!task) return;
    this.pending.delete(id);
    if (error) {
      task.reject(new Error(error));
    } else {
      task.resolve(result);
    }
    this.drainQueue();
  }

  postToWorker(workerIndex, task) {
    this.workers[workerIndex].postMessage({ id: task.id, type: task.type, payload: task.payload });
  }

  drainQueue() {
    if (this.queue.length === 0) return;
    const idleWorkers = [];
    for (let i = 0; i < this.workers.length; i++) {
      const busy = Array.from(this.pending.values()).some(t => t.workerIndex === i);
      if (!busy) idleWorkers.push(i);
    }
    while (idleWorkers.length > 0 && this.queue.length > 0) {
      const workerIndex = idleWorkers.shift();
      const task = this.queue.shift();
      task.workerIndex = workerIndex;
      this.pending.set(task.id, task);
      this.postToWorker(workerIndex, task);
    }
  }

  postMessage(type, payload) {
    return new Promise((resolve, reject) => {
      const id = ++this.taskId;
      const task = { id, type, payload, resolve, reject };
      let idleIndex = -1;
      for (let i = 0; i < this.workers.length; i++) {
        const busy = Array.from(this.pending.values()).some(t => t.workerIndex === i);
        if (!busy) { idleIndex = i; break; }
      }
      if (idleIndex >= 0) {
        task.workerIndex = idleIndex;
        this.pending.set(id, task);
        this.postToWorker(idleIndex, task);
      } else {
        this.queue.push(task);
      }
    });
  }

  terminate() {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.pending.clear();
    this.queue = [];
  }
}

let pool = null;

export function getWorkerPool() {
  if (!pool) {
    const size = Math.max(2, Math.min(4, navigator.hardwareConcurrency || 4));
    pool = new WorkerPool('./workers/mediaWorker.js', size);
  }
  return pool;
}

export function terminateWorkerPool() {
  if (pool) {
    pool.terminate();
    pool = null;
  }
}
