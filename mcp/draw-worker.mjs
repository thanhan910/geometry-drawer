// One drawing worker thread (see pool.mjs): runs draw() for the main thread.
import { parentPort } from 'node:worker_threads';
import { draw } from './draw.mjs';

parentPort.on('message', ({ id, args }) => {
  try {
    parentPort.postMessage({ id, result: draw(args) });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
