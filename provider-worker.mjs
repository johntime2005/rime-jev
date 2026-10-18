import { parentPort, workerData } from 'node:worker_threads';
import { providerClient } from './provider.mjs';
import { ProviderTransport } from './provider-transport.mjs';

// Construction is local only. A connection is opened only for a budgeted request.
const transport = new ProviderTransport(workerData.provider.endpoint);
parentPort.once('close', () => transport.close());

let active = null;
parentPort.on('message', async ({ id, type, snapshot, context }) => {
  if (type === 'cancel') {
    if (active?.id === id) active.controller.abort();
    return;
  }
  if (active) { parentPort.postMessage({ id, error: 'BUSY' }); return; }
  const controller = new AbortController();
  active = { id, controller };
  let reply;
  const timings = {};
  const started = performance.now();
  try {
    // The parent persists the daily budget before dispatch. Each message gets
    // exactly one attempt; the worker never retries or switches providers.
    const client = providerClient(workerData.provider, { apiKey: workerData.apiKey,
      timeoutMs: workerData.timeoutMs, callLimit: 1,
      fetchImpl: async (...args) => {
        const sent = performance.now();
        const response = await transport.fetch(...args);
        timings.headersMs = Math.round(performance.now() - sent);
        if (response.connection) Object.assign(timings, response.connection);
        return { ok: response.ok, status: response.status, json: async () => {
          const reading = performance.now();
          try { return await response.json(); }
          finally { timings.bodyMs = Math.round(performance.now() - reading); }
        } };
      } });
    const result = await client.rank(snapshot, context, { confirmLive: true, signal: controller.signal });
    reply = { id, result: { abstained: result.abstained,
      noneProbability: result.noneProbability, timings: { ...timings, totalMs: Math.round(performance.now() - started) },
      ranked: result.ranked.map(({ originalRank, probability }) => ({ originalRank, probability })) } };
  } catch (error) {
    reply = { id, error: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'PROVIDER_WORKER_FAILED' };
  } finally { active = null; }
  // This acknowledgement follows completion/abort of the entire body read,
  // not just receipt of the cancel command.
  parentPort.postMessage(reply);
});
