import { parentPort } from 'node:worker_threads';

let active = null, requests = 0;
const complete = (id) => parentPort.postMessage({ id, result: { abstained: false, noneProbability: 0,
  ranked: [{ originalRank: 2, probability: 1 }, { originalRank: 1, probability: 0 }] } });
parentPort.on('message', ({ id, type }) => {
  if (type === 'cancel') {
    if (active !== id) return;
    active = null;
    // Deterministically complete after the parent has already sent its abort.
    complete(id);
    return;
  }
  if (active !== null) { parentPort.postMessage({ id, error: 'BUSY' }); return; }
  if (++requests === 1) { active = id; return; }
  complete(id);
});
