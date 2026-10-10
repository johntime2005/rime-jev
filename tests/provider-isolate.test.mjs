import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { IsolatedProvider, CANCEL_GRACE_MS } from '../provider-isolate.mjs';
import { providerConfig } from '../provider.mjs';

const snapshot = { pinyin: 'jingli', preedit: 'jing li', candidates: [
  { id: 'c1', text: 'first', originalRank: 1 }, { id: 'c2', text: 'second', originalRank: 2 }] };
const response = { model: 'test', usage: { input_tokens: 1, output_tokens: 0 },
  answers: { next_candidate: { type: 'choice', choice: 'c2', confidence: 0.9,
    probabilities: { c1: 0.05, c2: 0.9, none_of_the_above: 0.05 } } } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, timeout = 2500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await sleep(5);
  }
  assert.fail('Timed out waiting for isolated provider');
}

test('repeated cooperative aborts settle the request and reuse the worker without overlapping transports', async (t) => {
  let calls = 0, pending = 0, peak = 0, closed = 0;
  const server = createServer((req, res) => {
    req.resume();
    calls++; pending++; peak = Math.max(peak, pending);
    res.once('close', () => { pending--; closed++; });
    // Exercise cancellation both before headers and while reading the body.
    if (calls <= 6) {
      if (calls % 2 === 0) res.write('{');
      return;
    }
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = new IsolatedProvider({ apiKey: '', timeoutMs: 4000,
    provider: providerConfig({ endpoint: `http://127.0.0.1:${server.address().port}/v1/systemone`, auth: 'none' }) });
  t.after(() => client.close());
  client.warm();
  await sleep(100);
  assert.equal(calls, 0, 'initialization must not send speculative API calls');
  const worker = client.worker;
  for (let i = 1; i <= 6; i++) {
    const controller = new AbortController();
    const result = client.rank(snapshot, '', { signal: controller.signal });
    const cancelled = assert.rejects(result, { code: 'CANCELLED' });
    await until(() => calls === i);
    await assert.rejects(client.rank(snapshot, ''), { code: 'BUSY' });
    controller.abort();
    await cancelled;
    assert.equal(client.active, false);
    assert.equal(client.worker, worker);
  }
  assert.equal((await client.rank(snapshot, '')).ranked[0].originalRank, 2);
  await until(() => closed === 7);
  assert.equal(peak, 1, 'the next transport cannot start while the cancelled one is still active');
  assert.equal(calls, 7, 'exactly one attempt per explicit request, no retries');
  assert.deepEqual(client.metrics, { starts: 1, hardTimeouts: 0, cancellations: 6,
    cooperativeCancellations: 6, hardCancellations: 0, failures: 0 });
});

test('a result racing cancellation is discarded and cannot settle the next request', async (t) => {
  const client = new IsolatedProvider({ provider: providerConfig(), apiKey: '', timeoutMs: 4000,
    workerUrl: new URL('./fixtures/cancel-race-provider.mjs', import.meta.url) });
  t.after(() => client.close());
  const controller = new AbortController();
  const result = client.rank(snapshot, '', { signal: controller.signal });
  const cancelled = assert.rejects(result, { code: 'CANCELLED' });
  await new Promise((resolve) => client.worker.once('online', resolve));
  controller.abort();
  await cancelled;
  assert.equal(client.metrics.cooperativeCancellations, 1);
  assert.equal((await client.rank(snapshot, '')).ranked[0].originalRank, 2);
  assert.equal(client.metrics.starts, 1);
});

test('already-aborted input neither warms a worker nor consumes a request slot', async () => {
  const client = new IsolatedProvider({ provider: providerConfig(), apiKey: '', timeoutMs: 4000 });
  await assert.rejects(client.rank(snapshot, '', { signal: AbortSignal.abort() }), { code: 'CANCELLED' });
  assert.equal(client.worker, null);
  assert.equal(client.active, false);
  assert.equal(client.metrics.starts, 0);
  await client.close();
});

test('an ignored cancellation retains the single slot until the hard fallback retires the worker', async (t) => {
  let calls = 0;
  const sockets = new Set();
  const server = createServer((req, res) => {
    req.resume();
    if (++calls === 1) res.setHeader('x-test-fault', 'body');
    res.end(JSON.stringify(response));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = new IsolatedProvider({ apiKey: '', timeoutMs: 4000,
    provider: providerConfig({ endpoint: `http://127.0.0.1:${server.address().port}/v1/systemone`, auth: 'none' }),
    workerUrl: new URL('./fixtures/uncooperative-provider.mjs', import.meta.url) });
  t.after(() => client.close());
  const controller = new AbortController();
  const result = client.rank(snapshot, '', { signal: controller.signal });
  const cancelled = assert.rejects(result, { code: 'CANCELLED' });
  await until(() => calls === 1);
  const started = performance.now();
  controller.abort();
  await assert.rejects(client.rank(snapshot, ''), { code: 'BUSY' });
  await cancelled;
  assert.ok(performance.now() - started >= CANCEL_GRACE_MS - 10);
  assert.ok(performance.now() - started < 1500, 'must not wait for the full provider deadline');
  assert.equal(client.worker, null);
  assert.equal(client.active, false);
  await until(() => sockets.size === 0);
  assert.equal((await client.rank(snapshot, '')).ranked[0].originalRank, 2);
  assert.equal(client.metrics.starts, 2);
  assert.equal(client.metrics.hardCancellations, 1);
  assert.equal(client.metrics.cooperativeCancellations, 0);
  assert.equal(client.metrics.hardTimeouts, 0);
  assert.equal(calls, 2);
});
