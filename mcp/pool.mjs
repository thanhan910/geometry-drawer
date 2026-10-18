// A small pool of worker threads for drawing. Each job gets a hard time
// limit: a worker that overruns is terminated and replaced, so one heavy or
// hostile script cannot hold the server. The main thread stays free for
// health checks, short links and protocol traffic.
//
//   const pool = createPool(new URL('./draw-worker.mjs', import.meta.url), { size: 2, timeoutMs: 10000, maxQueue: 8 });
//   const result = await pool.run(args);   // rejects on timeout, crash or a full queue

import { Worker } from 'node:worker_threads';

export function createPool(file, { size = 2, timeoutMs = 10000, maxQueue = 8 } = {}) {
  const idle = [], queue = [];
  let seq = 0;

  const spawn = () => {
    const w = new Worker(file), born = Date.now();
    w.unref();
    w.on('error', e => console.error('draw worker error', e.message));
    w.on('exit', () => {
      // Stopped (timeout) or crashed: fail its job and start a fresh worker,
      // slowly if it died at once (a broken install should not spin).
      if (w.job) {
        clearTimeout(w.job.timer);
        w.job.reject(new Error(w.job.timedOut ? `Drawing took longer than ${timeoutMs / 1000} seconds and was stopped. Simplify the script (fewer loci, sequences or checks).` : 'The drawing worker stopped unexpectedly.'));
        w.job = null;
      }
      const i = idle.indexOf(w); if (i > -1) idle.splice(i, 1);
      setTimeout(() => { idle.push(spawn()); next(); }, Date.now() - born < 1000 ? 2000 : 0);
    });
    w.on('message', m => {
      const job = w.job;
      if (!job || m.id !== job.id) return;
      clearTimeout(job.timer);
      w.job = null;
      m.error ? job.reject(new Error(m.error)) : job.resolve(m.result);
      idle.push(w);
      next();
    });
    return w;
  };
  for (let i = 0; i < size; i++) idle.push(spawn());

  function next() {
    while (idle.length && queue.length) {
      const w = idle.shift(), job = queue.shift();
      w.job = job;
      job.timer = setTimeout(() => { job.timedOut = true; w.terminate(); }, timeoutMs);
      w.postMessage({ id: job.id, args: job.args });
    }
  }

  return {
    run(args) {
      if (queue.length >= maxQueue) return Promise.reject(new Error('The drawing server is busy. Try again in a moment.'));
      return new Promise((resolve, reject) => { queue.push({ id: ++seq, args, resolve, reject }); next(); });
    },
    get stats() { return { idle: idle.length, queued: queue.length }; },
  };
}
