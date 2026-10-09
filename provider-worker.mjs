import { parentPort, workerData } from 'node:worker_threads';
import { providerClient } from './provider.mjs';

// Trigger Node's lazy fetch implementation load without opening a connection.
new Request('http://127.0.0.1/');

let busy = false;
parentPort.on('message', async ({ id, snapshot, context }) => {
  if (busy) { parentPort.postMessage({ id, error: 'BUSY' }); return; }
  busy = true;
  const timings = {};
  const started = performance.now();
  try {
    // The parent persists the daily budget before dispatch. Each message gets
    // exactly one attempt; the worker never retries or switches providers.
    const client = providerClient(workerData.provider, { apiKey: workerData.apiKey,
      timeoutMs: workerData.timeoutMs, callLimit: 1,
      fetchImpl: async (...args) => {
        const sent = performance.now();
        const response = await globalThis.fetch(...args);
        timings.headersMs = Math.round(performance.now() - sent);
        return { ok: response.ok, status: response.status, json: async () => {
          const reading = performance.now();
          try { return await response.json(); }
          finally { timings.bodyMs = Math.round(performance.now() - reading); }
        } };
      } });
    const result = await client.rank(snapshot, context, { confirmLive: true });
    parentPort.postMessage({ id, result: { abstained: result.abstained,
      noneProbability: result.noneProbability, timings: { ...timings, totalMs: Math.round(performance.now() - started) },
      ranked: result.ranked.map(({ originalRank, probability }) => ({ originalRank, probability })) } });
  } catch (error) {
    parentPort.postMessage({ id, error: /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'PROVIDER_WORKER_FAILED' });
  } finally { busy = false; }
});
