import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { validateRequest, resultOrder, rankDecision, startBridge, atomicWrite } from '../bridge.mjs';
import { buildRequest, parseResponse, JevClient } from '../vendor/jev-keyboard/jev.mjs';

const request = () => ({ protocol: 1, id: 'test_1', session: 'test', sequence: 1,
  instance: 'instance', token: 'token', createdAt: Math.floor(Date.now() / 1000),
  pinyin: 'jingli', caret: 6, preedit: 'jing li', context: '\u4ed6\u62c5\u4efb\u90e8\u95e8',
  document: { source: 'tsf', quality: 'exact', stamp: '10-20-30' },
  candidates: ['\u7ecf\u5386', '\u7ecf\u7406', '\u7cbe\u529b'].map((text) => ({ text, start: 0, end: 6 })) });

function assertResponse(raw, r, status, value) {
  assert.equal(raw, [r.document ? 'JEVWIN2' : 'JEVWIN1', r.id, r.instance, status,
    String(r.createdAt + 12), String(r.candidates.length), value,
    ...(r.document ? [r.document.stamp] : []), ''].join('\n'));
}

const uncooperativeWorker = new URL('./fixtures/uncooperative-provider.mjs', import.meta.url);

async function faultProvider(t, fault) {
  let calls = 0;
  const sockets = new Set();
  const server = createServer((req, res) => {
    req.resume();
    if (++calls === 1) res.setHeader('x-test-fault', fault);
    res.end(JSON.stringify({ model: 'test', usage: { input_tokens: 1, output_tokens: 0 },
      answers: { next_candidate: { type: 'choice', choice: 'c2', confidence: 0.8,
        probabilities: { c1: 0.1, c2: 0.8, c3: 0.05, none_of_the_above: 0.05 } } } }));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { calls: () => calls, sockets,
    provider: { endpoint: `http://127.0.0.1:${server.address().port}/v1/systemone`, auth: 'none' } };
}

async function waitFor(read, check = (value) => value, timeout = 2000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const value = await read(); if (check(value)) return value; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for bridge');
}

test('atomic publication survives transient Windows sharing violations without deleting the current file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-sharing-'));
  const filename = path.join(root, 'bridge.info');
  await fs.writeFile(filename, 'old');
  let attempts = 0;
  await atomicWrite(filename, 'new', { rename: async (temp, target) => {
    assert.equal(await fs.readFile(target, 'utf8'), 'old');
    if (++attempts < 3) throw Object.assign(new Error('sharing violation'), { code: 'EPERM' });
    return fs.rename(temp, target);
  } });
  assert.equal(attempts, 3);
  assert.equal(await fs.readFile(filename, 'utf8'), 'new');
  assert.deepEqual(await fs.readdir(root), ['bridge.info']);
  attempts = 0;
  await assert.rejects(atomicWrite(filename, 'broken', { rename: async () => {
    attempts++;
    throw Object.assign(new Error('sharing violation'), { code: 'EPERM' });
  } }), { code: 'EPERM' });
  assert.equal(attempts, 6, 'persistent failures must not retry forever');
  assert.equal(await fs.readFile(filename, 'utf8'), 'new');
  assert.deepEqual(await fs.readdir(root), ['bridge.info']);
});

test('validates complete snapshots and rejects malformed, stale, untrusted input', () => {
  const r = request();
  assert.equal(validateRequest(r, 'instance', 'token').candidates.length, 3);
  for (const patch of [{ token: 'wrong' }, { id: '../file' }, { createdAt: 1 }, { caret: 1 },
    { context: 'a'.repeat(81) }, { candidates: [] }, { sequence: 0 }]) {
    assert.throws(() => validateRequest({ ...r, ...patch }, 'instance', 'token'));
  }
});

test('context diagnostics accept only enums consistent with the request', () => {
  const r = request();
  validateRequest({ ...r, contextState: { enabled: true, reason: 'available' } }, 'instance', 'token');
  validateRequest({ ...r, context: '', contextState: { enabled: true, reason: 'focus_changed' } }, 'instance', 'token');
  for (const contextState of [{ enabled: false, reason: 'disabled' }, { enabled: true, reason: r.context },
    { enabled: true, reason: 'focus_changed' }, { enabled: 'yes', reason: 'available' }]) {
    assert.throws(() => validateRequest({ ...r, contextState }, 'instance', 'token'));
  }
  assert.throws(() => validateRequest({ ...r, cacheEpoch: -1 }, 'instance', 'token'));
});

const documentRequest = () => ({ ...request(), context: '', contextTarget: 'pebrel',
  document: { source: 'tsf', quality: 'unavailable', stamp: '10-20-30' },
  contextState: { enabled: true, reason: 'context_pending', source: 'pebrel_codex' } });

test('document context requires explicit consent and a recognized empty-text request', () => {
  validateRequest(documentRequest(), 'instance', 'token');
  for (const patch of [{ context: 'stale history' }, { contextTarget: 'another-app' },
    { contextState: { enabled: false, reason: 'disabled' } }, { contextState: undefined },
    { contextState: { enabled: true, reason: 'context_pending', source: 'history' } }, { contextTarget: null }]) {
    assert.throws(() => validateRequest({ ...documentRequest(), ...patch }, 'instance', 'token'));
  }
});

test('document context reaches the provider but never status; cache also validates the current draft', async (t) => {
  let calls = 0, captures = 0, verifications = 0, draft = 'real draft before the caret', stamp = 'pane-one-caret-one';
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (data) => { body += data; });
    req.on('end', () => {
      calls++;
      assert.equal(JSON.parse(body).state.preceding_text, draft);
      res.end(JSON.stringify({ model: 'test', usage: { input_tokens: 1, output_tokens: 0 },
        answers: { next_candidate: { type: 'choice', choice: 'c2', confidence: 0.8,
          probabilities: { c1: 0.1, c2: 0.8, c3: 0.05, none_of_the_above: 0.05 } } } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-doc-context-'));
  const bridge = await startBridge({ root, debounceMs: 0, contextReader: {
    capture: async () => { captures++; return { text: draft, stamp }; },
    verify: async (capture) => { verifications++; assert.equal(capture.stamp, stamp); },
  }, provider: { endpoint: `http://127.0.0.1:${server.address().port}/v1/systemone`, auth: 'none' } });
  t.after(() => bridge.stop());
  const submit = async (sequence) => {
    const r = { ...documentRequest(), id: `document_${sequence}`, sequence, instance: bridge.instance, token: bridge.token };
    await atomicWrite(path.join(bridge.runtime, 'inbox', `${r.id}.json`), JSON.stringify(r));
    return waitFor(() => fs.readFile(path.join(root, 'status.json'), 'utf8').then(JSON.parse), (s) => s.lastResult?.requestId === r.id);
  };
  const initial = await submit(1);
  assert.equal(initial.lastResult.contextChars, [...draft].length);
  assert.deepEqual(initial.lastResult.contextState, { enabled: true, reason: 'available', source: 'pebrel_codex' });
  assert.equal(calls, 1);
  const cached = await submit(2);
  assert.equal(cached.lastResult.source, 'cache');
  assert.equal(calls, 1);
  assert.equal(captures, 2); assert.equal(verifications, 2);
  stamp = 'pane-two-same-text';
  const moved = await submit(3);
  assert.equal(moved.lastResult.source, 'provider');
  assert.equal(calls, 2, 'same text in another pane is not the same snapshot');
  for (const value of [draft, stamp, bridge.token]) assert.ok(!JSON.stringify(moved).includes(value));
});

test('unavailable document context abstains before any API call instead of falling back to history', async (t) => {
  const local = await faultProvider(t, 'none');
  for (const reader of [undefined, { capture: async () => { throw Object.assign(new Error('private data'), { code: 'CONTEXT_NOT_FOCUSED' }); } }]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-no-context-'));
    const bridge = await startBridge({ root, provider: local.provider, contextReader: reader, debounceMs: 0 });
    try {
      const r = { ...documentRequest(), instance: bridge.instance, token: bridge.token };
      await atomicWrite(path.join(bridge.runtime, 'inbox', `${r.id}.json`), JSON.stringify(r));
      const status = await waitFor(() => fs.readFile(path.join(root, 'status.json'), 'utf8').then(JSON.parse), (s) => s.lastResult);
      assert.equal(status.lastResult.decision, 'abstain');
      assert.equal(status.lastResult.contextChars, 0);
      assert.equal(status.lastResult.contextState.reason, 'context_unavailable');
      assert.match(status.lastResult.contextError, /^CONTEXT_/);
      assert.equal(status.callsToday, 0);
      assert.equal(local.calls(), 0);
      assert.ok(!JSON.stringify(status).includes('private data'));
    } finally { await bridge.stop(); }
  }
});

test('document changed during inference cannot publish a ranking or populate the cache', async (t) => {
  const local = await faultProvider(t, 'none');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-context-race-'));
  const bridge = await startBridge({ root, provider: local.provider, debounceMs: 0, contextReader: {
    capture: async () => ({ text: 'before', stamp: 'old' }),
    verify: async () => { throw Object.assign(new Error('changed'), { code: 'CONTEXT_CHANGED' }); },
  } });
  t.after(() => bridge.stop());
  const r = { ...documentRequest(), instance: bridge.instance, token: bridge.token };
  await atomicWrite(path.join(bridge.runtime, 'inbox', `${r.id}.json`), JSON.stringify(r));
  const status = await waitFor(() => fs.readFile(path.join(root, 'status.json'), 'utf8').then(JSON.parse), (s) => s.lastResult);
  assert.equal(status.lastResult.decision, 'abstain');
  assert.equal(status.lastResult.contextError, 'CONTEXT_CHANGED');
  assert.equal(status.cache.entries, 0);
  assert.equal(local.calls(), 1);
  assert.ok((await fs.readFile(path.join(bridge.runtime, 'outbox', `${r.id}.res`), 'utf8')).includes('\nabstain\n'));
});

test('context reader cancellation and deadline do not block the bridge', async (t) => {
  const local = await faultProvider(t, 'none');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-context-deadline-'));
  const bridge = await startBridge({ root, provider: local.provider, debounceMs: 0,
    contextReader: { capture: () => new Promise(() => {}) } });
  t.after(() => bridge.stop());
  const status = () => fs.readFile(path.join(root, 'status.json'), 'utf8').then(JSON.parse);
  const r = { ...documentRequest(), instance: bridge.instance, token: bridge.token };
  const input = path.join(bridge.runtime, 'inbox', `${r.id}.json`);
  await atomicWrite(input, JSON.stringify(r));
  await waitFor(status, (s) => s.requestState?.phase === 'context');
  await fs.rm(input);
  await waitFor(status, (s) => s.lastCancellation?.phase === 'context');
  await atomicWrite(input, JSON.stringify({ ...r, sequence: 2 }));
  const timedOut = await waitFor(status, (s) => s.lastResult, 5000);
  assert.equal(timedOut.lastResult.contextError, 'CONTEXT_READER_TIMEOUT');
  assert.equal(local.calls(), 0);
  const normal = { ...request(), id: 'normal_after_context_timeout', session: 'normal', instance: bridge.instance, token: bridge.token };
  await atomicWrite(path.join(bridge.runtime, 'inbox', `${normal.id}.json`), JSON.stringify(normal));
  await waitFor(status, (s) => s.lastResult?.requestId === normal.id);
  assert.equal(local.calls(), 1);
});

test('disabled context never consults the document reader', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-context-off-'));
  const bridge = await startBridge({ root, mock: true, debounceMs: 0, contextReader: {
    capture: () => assert.fail('Reader must not run without context consent'),
  } });
  t.after(() => bridge.stop());
  const r = { ...request(), context: '', contextState: { enabled: false, reason: 'disabled', source: 'none' },
    instance: bridge.instance, token: bridge.token };
  await atomicWrite(path.join(bridge.runtime, 'inbox', `${r.id}.json`), JSON.stringify(r));
  const status = await waitFor(() => fs.readFile(path.join(root, 'status.json'), 'utf8').then(JSON.parse), (s) => s.lastResult);
  assert.equal(status.lastResult.contextChars, 0);
  assert.equal(status.lastResult.decision, 'promoted');
});

test('adapter cancellation receipts survive request deletion and never retain arbitrary text or tokens', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-receipts-'));
  const bridge = await startBridge({ root, mock: true, debounceMs: 1000 });
  const status = () => fs.readFile(path.join(root, 'status.json'), 'utf8').then(JSON.parse);
  try {
    const r = { ...request(), instance: bridge.instance, token: bridge.token,
      contextState: { enabled: true, reason: 'available', unexpected: 'sensitive-marker' } };
    const input = path.join(bridge.runtime, 'inbox', `${r.id}.json`);
    await atomicWrite(input, JSON.stringify(r));
    await waitFor(status, (s) => s.requestState?.phase === 'debounce');
    await fs.rm(input);
    const receipt = { protocol: 1, id: r.id, instance: bridge.instance, token: bridge.token,
      reason: 'focus_changed', createdAt: Math.floor(Date.now() / 1000), unexpected: 'sensitive-marker' };
    await atomicWrite(path.join(bridge.runtime, 'outbox', `${r.id}.cancel`), JSON.stringify(receipt));
    const observed = await waitFor(status, (s) => s.lastAdapterCancellation && s.lastCancellation);
    assert.equal(observed.lastAdapterCancellation.requestId, r.id);
    assert.equal(observed.adapterCancellations.focus_changed, 1);
    assert.equal(observed.lastCancellation.phase, 'debounce');
    assert.deepEqual(observed.lastCancellation.contextState, { enabled: true, reason: 'available' });
    assert.equal(observed.cancellationsByPhase.debounce, 1);
    assert.equal(observed.callsToday, 0);
    for (const value of [r.context, r.pinyin, r.token, 'sensitive-marker']) {
      assert.ok(!JSON.stringify(observed).includes(value));
    }
    for (const [id, patch] of [['invalid_reason', { reason: 'sensitive-marker' }], ['wrong_token', { token: 'wrong' }],
      ['stale', { createdAt: 1 }]]) {
      const filename = path.join(bridge.runtime, 'outbox', `${id}.cancel`);
      await atomicWrite(filename, JSON.stringify({ ...receipt, id, ...patch }));
      await waitFor(() => fs.access(filename).then(() => false, () => true));
    }
    assert.deepEqual((await status()).adapterCancellations, { focus_changed: 1 });
  } finally { await bridge.stop(); }
});

test('exact snapshot cache skips debounce and API budget but never crosses context, session, focus, or candidate changes', async (t) => {
  const local = await faultProvider(t, 'none');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-cache-'));
  let bridge = await startBridge({ root, debounceMs: 300, provider: local.provider, callLimit: 1 });
  const status = () => fs.readFile(path.join(root, 'status.json'), 'utf8').then(JSON.parse);
  let sequence = 0;
  const submit = async (patch = {}) => {
    const r = { ...request(), id: `cached_${++sequence}`, sequence, cacheEpoch: 1,
      instance: bridge.instance, token: bridge.token, ...patch };
    await atomicWrite(path.join(bridge.runtime, 'inbox', `${r.id}.json`), JSON.stringify(r));
    await waitFor(() => fs.readFile(path.join(bridge.runtime, 'outbox', `${r.id}.res`), 'utf8'));
    return waitFor(status, (s) => s.lastResult?.requestId === r.id && s.requestState === null);
  };
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(local.calls(), 0, 'warming a worker must never send to the provider');
    assert.equal((await submit()).lastResult.source, 'provider');
    const hit = await submit();
    assert.equal(hit.lastResult.source, 'cache');
    assert.equal(hit.lastResult.providerMs, 0);
    assert.ok(hit.lastResult.readyMs < 250, 'cache hit must skip the 300ms network debounce');
    assert.equal(hit.cache.hits, 1);
    assert.equal(hit.callsToday, 1);
    assert.equal(local.calls(), 1);
    for (const patch of [{ context: '' }, { session: 'another' }, { cacheEpoch: 2 },
      { pinyin: 'jing li', caret: 7 }, { preedit: 'different' },
      { candidates: request().candidates.toReversed() }]) {
      const miss = await submit(patch);
      assert.equal(miss.lastResult.decision, 'error');
      assert.equal(miss.lastError, 'DAILY_BUDGET_EXCEEDED');
    }
    assert.equal(local.calls(), 1, 'cache misses must still honor the daily budget');
    await bridge.stop();
    bridge = await startBridge({ root, debounceMs: 0, provider: local.provider, callLimit: 1 });
    assert.equal((await submit()).lastError, 'DAILY_BUDGET_EXCEEDED', 'cache must not survive restart');
  } finally { await bridge.stop(); }
});

test('cache entries expire and disabled caching always dispatches new attempts', async (t) => {
  const local = await faultProvider(t, 'none');
  for (const cacheTtlMs of [100, 0]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-cache-ttl-'));
    const bridge = await startBridge({ root, debounceMs: 0, provider: local.provider, cacheTtlMs });
    try {
      for (const sequence of [1, 2]) {
        const r = { ...request(), id: `ttl_${sequence}`, sequence, instance: bridge.instance, token: bridge.token };
        await atomicWrite(path.join(bridge.runtime, 'inbox', `${r.id}.json`), JSON.stringify(r));
        const status = await waitFor(() => fs.readFile(path.join(root, 'status.json'), 'utf8').then(JSON.parse),
          (s) => s.lastResult?.requestId === r.id);
        assert.equal(status.lastResult.source, 'provider');
        assert.equal(status.callsToday, sequence);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    } finally { await bridge.stop(); }
  }
});

test('uses upstream Choice request and strict response parsing', () => {
  const snapshot = validateRequest(request(), 'instance', 'token');
  const body = buildRequest(snapshot, request().context, 'jev-latest');
  assert.equal(body.model, 'jev-latest');
  assert.ok(body.questions.next_candidate.criteria.none_of_the_above);
  const raw = { model: 'jev-latest', answers: { next_candidate: { type: 'choice', choice: 'c2', confidence: 0.8,
    probabilities: { c1: 0.1, c2: 0.8, c3: 0.05, none_of_the_above: 0.05 } } }, usage: { input_tokens: 100, output_tokens: 10 } };
  assert.deepEqual(resultOrder(parseResponse(raw, snapshot), 3), [2, 1, 3]);
  delete raw.answers.next_candidate.probabilities.c3;
  assert.throws(() => parseResponse(raw, snapshot));
});

test('low confidence, narrow margins and abstention preserve native order', () => {
  const result = { abstained: false, noneProbability: 0.1, ranked: [{ originalRank: 2, probability: 0.5 }, { originalRank: 1, probability: 0.4 }] };
  assert.equal(resultOrder(result, 2), null);
  assert.equal(resultOrder({ ...result, abstained: true }, 2), null);
  assert.equal(resultOrder({ ...result, ranked: [{ originalRank: 2, probability: 0.6 }, { originalRank: 1, probability: 0.5 }] }, 2), null);
  assert.equal(rankDecision(result, 2).reason, 'low_probability');
  assert.equal(rankDecision({ ...result, abstained: true }, 2).reason, 'provider_abstained');
  assert.equal(rankDecision({ ...result, ranked: [{ originalRank: 2, probability: 0.6 }, { originalRank: 1, probability: 0.5 }] }, 2).reason, 'narrow_margin');
});

test('offline client never sends a network request', async () => {
  const client = new JevClient({ enableLive: false }, { fetchImpl: () => { assert.fail('must not call fetch'); } });
  await assert.rejects(client.rank({}, ''), /API/);
});

test('HTTP failures never trigger retries, and requests forbid redirects', async () => {
  let calls = 0;
  const snapshot = validateRequest(request(), 'instance', 'token');
  const client = new JevClient({ enableLive: true, apiKey: 'test-not-a-real-key', callLimit: 2, timeoutMs: 100,
    model: 'jev-latest', allowNone: true }, { fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(options.redirect, 'error');
    return { ok: false, status: 401 };
  } });
  await assert.rejects(client.rank(snapshot, '', { confirmLive: true }), /401/);
  assert.equal(calls, 1);
});

test('persisted daily cap prevents sending after a restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-budget-'));
  await fs.writeFile(path.join(root, 'usage.json'), JSON.stringify({ day: new Date().toISOString().slice(0, 10), calls: 200 }));
  const bridge = await startBridge({ root, mock: true });
  try {
    const r = { ...request(), instance: bridge.instance, token: bridge.token };
    await atomicWrite(path.join(bridge.runtime, 'inbox', `${r.id}.json`), JSON.stringify(r));
    let output;
    for (let i = 0; i < 50; i++) {
      try { output = await fs.readFile(path.join(bridge.runtime, 'outbox', `${r.id}.res`), 'utf8'); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    assert.match(output, /DAILY_BUDGET_EXCEEDED/);
    await assert.rejects(startBridge({ root, mock: true }), /already running/);
  } finally { await bridge.stop(); }
});

test('file IPC works with a deliberately simulated provider, stale auth never produces output', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-test-'));
  const bridge = await startBridge({ root, mock: true });
  try {
    const r = { ...request(), instance: bridge.instance, token: bridge.token };
    const filename = path.join(bridge.runtime, 'inbox', `${r.id}.json`);
    await atomicWrite(filename, JSON.stringify(r));
    let output;
    for (let i = 0; i < 50; i++) {
      try { output = await fs.readFile(path.join(bridge.runtime, 'outbox', `${r.id}.res`), 'utf8'); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    assertResponse(output, r, 'ok', '2,1,3');
    await atomicWrite(path.join(bridge.runtime, 'inbox', 'bad.json'), JSON.stringify({ ...r, id: 'bad', token: 'bad' }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await assert.rejects(fs.access(path.join(bridge.runtime, 'outbox', 'bad.res')));
    const status = JSON.parse(await fs.readFile(path.join(root, 'status.json')));
    assert.equal(status.callsToday, 0);
    assert.equal(status.debounceMs, 100);
    assert.equal(status.localMinIntervalMs, 0);
  } finally { await bridge.stop(); }
});

test('successive requests within one second are not locally rate limited', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-no-throttle-'));
  const bridge = await startBridge({ root, mock: true, debounceMs: 0 });
  try {
    const started = Date.now();
    for (const sequence of [1, 2]) {
      const r = { ...request(), id: `fast_${sequence}`, sequence,
        instance: bridge.instance, token: bridge.token };
      await atomicWrite(path.join(bridge.runtime, 'inbox', `${r.id}.json`), JSON.stringify(r));
      let output;
      for (let i = 0; i < 100; i++) {
        try { output = await fs.readFile(path.join(bridge.runtime, 'outbox', `${r.id}.res`), 'utf8'); break; }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      assert.match(output, /\nok\n/);
    }
    assert.ok(Date.now() - started < 1000, 'test must exercise requests less than one second apart');
  } finally { await bridge.stop(); }
});

test('debounce cancels a replaced snapshot before attempting a provider call', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-debounce-'));
  const bridge = await startBridge({ root, mock: true, debounceMs: 350 });
  try {
    const r = { ...request(), instance: bridge.instance, token: bridge.token };
    const filename = path.join(bridge.runtime, 'inbox', `${r.id}.json`);
    await atomicWrite(filename, JSON.stringify(r));
    await new Promise((resolve) => setTimeout(resolve, 150));
    await fs.rm(filename, { force: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await assert.rejects(fs.access(path.join(bridge.runtime, 'outbox', `${r.id}.res`)));
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'status.json'))).callsToday, 0);
  } finally { await bridge.stop(); }
});

test('debounce uses file publication time instead of adding another full delay on discovery', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-publication-'));
  const bridge = await startBridge({ root, mock: true, debounceMs: 900 });
  try {
    const r = { ...request(), instance: bridge.instance, token: bridge.token };
    const filename = path.join(bridge.runtime, 'inbox', `${r.id}.json`);
    // Publish an already-debounced file atomically, like a snapshot waiting behind an old request.
    const temporary = `${filename}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(r));
    const stamp = new Date(Date.now() - 950);
    await fs.utimes(temporary, stamp, stamp);
    const started = Date.now();
    await fs.rename(temporary, filename);
    await waitFor(() => fs.readFile(path.join(bridge.runtime, 'outbox', `${r.id}.res`), 'utf8'));
    assert.ok(Date.now() - started < 600, 'must not repeat the 900ms debounce');
  } finally { await bridge.stop(); }
});

test('live transport metrics distinguish same-first, promotion and a native adapter acknowledgement without text', async () => {
  let winner = 1;
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => setTimeout(() => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ model: 'test', usage: { input_tokens: 1, output_tokens: 0 },
        answers: { next_candidate: { type: 'choice', choice: `c${winner}`, confidence: 0.8,
          probabilities: { c1: winner === 1 ? 0.8 : 0.1, c2: winner === 2 ? 0.8 : 0.1, c3: 0.05, none_of_the_above: 0.05 } } } }));
    }, 60));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-metrics-'));
  let bridge;
  try {
    bridge = await startBridge({ root, debounceMs: 30, cacheTtlMs: 0,
      provider: { endpoint: `http://127.0.0.1:${server.address().port}/v1/systemone`, auth: 'none' } });
    const status = () => fs.readFile(path.join(root, 'status.json'), 'utf8').then(JSON.parse);
    for (const sequence of [1, 2]) {
      winner = sequence;
      const r = { ...request(), id: `metrics_${sequence}`, sequence, instance: bridge.instance, token: bridge.token };
      await atomicWrite(path.join(bridge.runtime, 'inbox', `${r.id}.json`), JSON.stringify(r));
      await waitFor(() => fs.readFile(path.join(bridge.runtime, 'outbox', `${r.id}.res`), 'utf8'));
      const result = await waitFor(status, (s) => s.callsToday === sequence && s.lastResult?.winnerOriginalRank === winner);
      assert.equal(result.lastResult.decision, sequence === 1 ? 'same_first' : 'promoted');
      assert.equal(result.lastResult.applyChannel, 'not_observed');
      assert.equal(result.lastResult.contextChars, [...r.context].length);
      assert.equal(result.lastResult.candidateCount, r.candidates.length);
      assert.equal(result.lastResult.ranking.reason, 'accepted');
      assert.equal(result.lastResult.ranking.topOriginalRank, winner);
      assert.equal(result.lastResult.ranking.topProbability, 0.8);
      assert.ok(result.lastResult.providerMs >= 50);
      assert.ok(result.lastResult.transport.headersMs >= 50);
      assert.ok(result.lastResult.transport.bodyMs >= 0);
      assert.equal(result.providerTransport, 'alpn-h2-v1');
      assert.equal(result.connectionIdleMs, 60000);
      assert.equal(result.lastResult.transport.protocol, 'http/1.1');
      assert.equal(result.lastResult.transport.reusedConnection, sequence > 1);
      assert.ok(result.lastResult.transport.connectMs >= 0);
      assert.equal(result.lastResult.source, 'provider');
      assert.ok(result.lastResult.readyMs >= result.lastResult.providerMs + 20);
      assert.equal(result.pollMs, 20);
      for (const secret of ['jingli', r.context, r.token, ...r.candidates.map((c) => c.text)]) {
        assert.ok(!JSON.stringify(result).includes(secret), 'status must not retain input or authentication');
      }
    }
    await atomicWrite(path.join(bridge.runtime, 'outbox', 'metrics_2.ack'), JSON.stringify({
      protocol: 1, id: 'metrics_2', instance: bridge.instance, channel: 'native' }));
    const applied = await waitFor(status, (s) => s.lastResult?.applyChannel === 'native');
    assert.equal(applied.outcomes.sameFirst, 1);
    assert.equal(applied.outcomes.promoted, 1);
    assert.equal(applied.outcomes.nativeApplied, 1);
    assert.ok(applied.lastResult.applyMs >= 0);
    assert.equal(applied.providerIsolation, 'worker');
    assert.equal(applied.providerWorker.starts, 1, 'healthy requests reuse the same worker');
    assert.equal(applied.providerWorker.hardTimeouts, 0);
  } finally {
    if (bridge) await bridge.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a hung provider times out, leaves no active request, and does not block the next request', async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    req.resume();
    calls++;
    if (calls === 1) return; // Deliberately leave this local HTTP response hanging.
    res.end(JSON.stringify({ model: 'test', usage: { input_tokens: 1, output_tokens: 0 },
      answers: { next_candidate: { type: 'choice', choice: 'c2', confidence: 0.8,
        probabilities: { c1: 0.1, c2: 0.8, c3: 0.05, none_of_the_above: 0.05 } } } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-timeout-'));
  let bridge;
  try {
    bridge = await startBridge({ root, debounceMs: 0, timeoutMs: 400,
      provider: { endpoint: `http://127.0.0.1:${server.address().port}/v1/systemone`, auth: 'none' } });
    const status = () => fs.readFile(path.join(root, 'status.json'), 'utf8').then(JSON.parse);
    for (const sequence of [1, 2]) {
      const r = { ...request(), id: `timeout_${sequence}`, sequence, instance: bridge.instance, token: bridge.token };
      await atomicWrite(path.join(bridge.runtime, 'inbox', `${r.id}.json`), JSON.stringify(r));
      if (sequence === 1) {
        const waiting = await waitFor(status, (s) => s.requestState?.phase === 'provider');
        assert.ok(waiting.requestState.ageMs >= 0);
      }
      const result = await waitFor(() => fs.readFile(path.join(bridge.runtime, 'outbox', `${r.id}.res`), 'utf8'));
      assertResponse(result, r, sequence === 1 ? 'error' : 'ok', sequence === 1 ? 'TIMEOUT' : '2,1,3');
      await waitFor(status, (s) => s.callsToday === sequence && s.requestState === null);
    }
    assert.equal(calls, 2, 'timeout must not retry the first provider request');
  } finally {
    if (bridge) await bridge.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('rejected rankings expose the exact gate and missing context without retaining text', async () => {
  const cases = [
    { c1: 0.1, c2: 0.2, c3: 0, none_of_the_above: 0.7 },
    { c1: 0.3, c2: 0.5, c3: 0.1, none_of_the_above: 0.1 },
    { c1: 0.61, c2: 0.15, c3: 0.12, none_of_the_above: 0.12 },
  ];
  let calls = 0;
  const server = createServer((req, res) => {
    req.resume();
    const probabilities = cases[calls++];
    const [choice, confidence] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
    res.end(JSON.stringify({ model: 'test', usage: { input_tokens: 1, output_tokens: 0 },
      answers: { next_candidate: { type: 'choice', choice, confidence, probabilities } } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-decision-'));
  let bridge;
  try {
    bridge = await startBridge({ root, debounceMs: 0, cacheTtlMs: 0,
      provider: { endpoint: `http://127.0.0.1:${server.address().port}/v1/systemone`, auth: 'none' } });
    for (const sequence of [1, 2, 3]) {
      const r = { ...request(), id: `decision_${sequence}`, sequence, context: sequence === 1 ? '' : request().context,
        instance: bridge.instance, token: bridge.token };
      await atomicWrite(path.join(bridge.runtime, 'inbox', `${r.id}.json`), JSON.stringify(r));
      const status = await waitFor(() => fs.readFile(path.join(root, 'status.json'), 'utf8').then(JSON.parse),
        (s) => s.lastResult?.requestId === r.id);
      assert.equal(status.lastResult.decision, sequence < 3 ? 'abstain' : 'same_first');
      assert.equal(status.lastResult.ranking.reason, ['provider_abstained', 'low_probability', 'accepted'][sequence - 1]);
      assert.equal(status.lastResult.contextChars, [...r.context].length);
      assert.equal(status.lastResult.ranking.topOriginalRank, sequence < 3 ? 2 : 1);
      assert.equal(status.lastResult.ranking.topProbability, [0.2, 0.5, 0.61][sequence - 1]);
      for (const text of [request().context, r.pinyin, r.token, ...r.candidates.map((c) => c.text)]) {
        assert.ok(!JSON.stringify(status).includes(text));
      }
    }
  } finally {
    if (bridge) await bridge.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a stalled response body reports timeout, recovers, and still rejects malformed completed JSON', async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    req.resume();
    calls++;
    res.setHeader('Content-Type', 'application/json');
    if (calls === 1) {
      res.write('{"model":'); // Headers arrive, but JSON never finishes.
      return;
    }
    if (calls === 3) { res.end('{'); return; }
    res.end(JSON.stringify({ model: 'test', usage: { input_tokens: 1, output_tokens: 0 },
      answers: { next_candidate: { type: 'choice', choice: 'c2', confidence: 0.8,
        probabilities: { c1: 0.1, c2: 0.8, c3: 0.05, none_of_the_above: 0.05 } } } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-body-timeout-'));
  let bridge;
  try {
    bridge = await startBridge({ root, debounceMs: 0, timeoutMs: 400, cacheTtlMs: 0,
      provider: { endpoint: `http://127.0.0.1:${server.address().port}/v1/systemone`, auth: 'none' } });
    const status = () => fs.readFile(path.join(root, 'status.json'), 'utf8').then(JSON.parse);
    const expected = [['error', 'TIMEOUT'], ['ok', '2,1,3'], ['error', 'INVALID_PROVIDER_RESPONSE']];
    for (const sequence of [1, 2, 3]) {
      const r = { ...request(), id: `body_${sequence}`, sequence, instance: bridge.instance, token: bridge.token };
      await atomicWrite(path.join(bridge.runtime, 'inbox', `${r.id}.json`), JSON.stringify(r));
      const result = await waitFor(() => fs.readFile(path.join(bridge.runtime, 'outbox', `${r.id}.res`), 'utf8'));
      assertResponse(result, r, ...expected[sequence - 1]);
      await waitFor(status, (s) => s.callsToday === sequence && s.requestState === null);
    }
    assert.equal(calls, 3, 'body timeout and malformed JSON must not cause retries');
  } finally {
    if (bridge) await bridge.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('cancelling an active response retires it promptly without publishing a stale result or retrying', async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    req.resume();
    calls++;
    if (calls === 1) { res.write('{'); return; }
    res.end(JSON.stringify({ model: 'test', usage: { input_tokens: 1, output_tokens: 0 },
      answers: { next_candidate: { type: 'choice', choice: 'c2', confidence: 0.8,
        probabilities: { c1: 0.1, c2: 0.8, c3: 0.05, none_of_the_above: 0.05 } } } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-active-cancel-'));
  let bridge;
  try {
    bridge = await startBridge({ root, debounceMs: 0, timeoutMs: 4000,
      provider: { endpoint: `http://127.0.0.1:${server.address().port}/v1/systemone`, auth: 'none' } });
    const status = () => fs.readFile(path.join(root, 'status.json'), 'utf8').then(JSON.parse);
    const r = { ...request(), id: 'cancel_1', instance: bridge.instance, token: bridge.token };
    const filename = path.join(bridge.runtime, 'inbox', `${r.id}.json`);
    await atomicWrite(filename, JSON.stringify(r));
    await waitFor(() => calls === 1);
    await fs.rm(filename);
    const cancelled = await waitFor(status, (s) => s.requestState === null && s.outcomes.cancelled === 1);
    assert.equal(cancelled.lastError, null);
    assert.equal(cancelled.lastResult, null);
    assert.equal(cancelled.providerWorker.starts, 1);
    assert.equal(cancelled.providerWorker.cooperativeCancellations, 1);
    assert.equal(cancelled.providerWorker.hardCancellations, 0);
    await assert.rejects(fs.access(path.join(bridge.runtime, 'outbox', `${r.id}.res`)), { code: 'ENOENT' });
    const next = { ...r, id: 'cancel_2', sequence: 2 };
    await atomicWrite(path.join(bridge.runtime, 'inbox', `${next.id}.json`), JSON.stringify(next));
    const result = await waitFor(() => fs.readFile(path.join(bridge.runtime, 'outbox', `${next.id}.res`), 'utf8'));
    assertResponse(result, next, 'ok', '2,1,3');
    const recovered = await waitFor(status, (s) => s.lastResult?.requestId === next.id);
    assert.equal(recovered.providerWorker.starts, 1, 'normal cancellation must not cold-start the next worker');
    assert.equal(calls, 2);
  } finally {
    if (bridge) await bridge.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('parent hard deadline releases abort-ignoring fetch, body and blocked worker execution', async (t) => {
  for (const fault of ['fetch', 'body', 'spin']) await t.test(fault, async (t) => {
    const local = await faultProvider(t, fault);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-hard-timeout-'));
    const bridge = await startBridge({ root, debounceMs: 0, timeoutMs: 700,
      provider: local.provider, workerUrl: uncooperativeWorker });
    try {
      const status = () => fs.readFile(path.join(root, 'status.json'), 'utf8').then(JSON.parse);
      for (const sequence of [1, 2]) {
        const r = { ...request(), id: `hard_${sequence}`, sequence, instance: bridge.instance, token: bridge.token };
        await atomicWrite(path.join(bridge.runtime, 'inbox', `${r.id}.json`), JSON.stringify(r));
        const output = await waitFor(() => fs.readFile(path.join(bridge.runtime, 'outbox', `${r.id}.res`), 'utf8'));
        assertResponse(output, r, sequence === 1 ? 'error' : 'ok', sequence === 1 ? 'TIMEOUT' : '2,1,3');
        const idle = await waitFor(status, (s) => s.callsToday === sequence && s.requestState === null);
        assert.equal(idle.providerWorker.hardTimeouts, 1);
        assert.equal(idle.providerWorker.starts, sequence);
        assert.equal(idle.lastError, sequence === 1 ? 'TIMEOUT' : null);
        if (sequence === 1) {
          assert.ok(idle.lastResult.providerMs >= 650);
          assert.ok(idle.lastResult.providerMs < 1800, 'must not wait for the uncooperative transport');
          await waitFor(() => local.sockets.size === 0);
        }
      }
      assert.equal(local.calls(), 2, 'a timed-out attempt must never be retried');
    } finally { await bridge.stop(); }
  });
});

test('cancelling an abort-ignoring worker closes its transport before the next request', async (t) => {
  const local = await faultProvider(t, 'body');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-hard-cancel-'));
  const bridge = await startBridge({ root, debounceMs: 0, timeoutMs: 4000,
    provider: local.provider, workerUrl: uncooperativeWorker });
  try {
    const status = () => fs.readFile(path.join(root, 'status.json'), 'utf8').then(JSON.parse);
    const r = { ...request(), instance: bridge.instance, token: bridge.token };
    const filename = path.join(bridge.runtime, 'inbox', `${r.id}.json`);
    await atomicWrite(filename, JSON.stringify(r));
    await waitFor(() => local.calls() === 1);
    const started = Date.now();
    await fs.rm(filename);
    const idle = await waitFor(status, (s) => s.requestState === null && s.outcomes.cancelled === 1);
    assert.ok(Date.now() - started < 1500, 'cancellation must not wait for the 4s deadline');
    assert.equal(idle.lastError, null);
    assert.equal(idle.lastResult, null);
    assert.equal(idle.providerWorker.cancellations, 1);
    assert.equal(idle.providerWorker.cooperativeCancellations, 0);
    assert.equal(idle.providerWorker.hardCancellations, 1);
    assert.equal(idle.providerWorker.hardTimeouts, 0);
    await waitFor(() => local.sockets.size === 0);
    await assert.rejects(fs.access(path.join(bridge.runtime, 'outbox', `${r.id}.res`)), { code: 'ENOENT' });
    const next = { ...r, id: 'next', sequence: 2 };
    await atomicWrite(path.join(bridge.runtime, 'inbox', `${next.id}.json`), JSON.stringify(next));
    assert.match(await waitFor(() => fs.readFile(path.join(bridge.runtime, 'outbox', 'next.res'), 'utf8')), /\nok\n/);
    const recovered = await waitFor(status, (s) => s.callsToday === 2 && s.requestState === null);
    assert.equal(recovered.providerWorker.starts, 2);
    assert.equal(local.calls(), 2);
  } finally { await bridge.stop(); }
});

test('worker crashes and unexpected clean exits are contained and the next request recovers', async (t) => {
  for (const fault of ['crash', 'exit']) await t.test(fault, async (t) => {
    const local = await faultProvider(t, fault);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-worker-exit-'));
    const bridge = await startBridge({ root, debounceMs: 0, provider: local.provider, workerUrl: uncooperativeWorker });
    try {
      const status = () => fs.readFile(path.join(root, 'status.json'), 'utf8').then(JSON.parse);
      for (const sequence of [1, 2]) {
        const r = { ...request(), id: `exit_${sequence}`, sequence, instance: bridge.instance, token: bridge.token };
        await atomicWrite(path.join(bridge.runtime, 'inbox', `${r.id}.json`), JSON.stringify(r));
        const output = await waitFor(() => fs.readFile(path.join(bridge.runtime, 'outbox', `${r.id}.res`), 'utf8'));
        assertResponse(output, r, sequence === 1 ? 'error' : 'ok', sequence === 1 ? 'PROVIDER_WORKER_FAILED' : '2,1,3');
        const idle = await waitFor(status, (s) => s.callsToday === sequence && s.requestState === null);
        assert.equal(idle.providerWorker.failures, 1);
        assert.equal(idle.providerWorker.starts, sequence);
        assert.ok(!JSON.stringify(idle).includes('fixture-only-sensitive-detail'));
      }
      assert.equal(local.calls(), 2);
    } finally { await bridge.stop(); }
  });
});

test('stopping a hung worker is prompt and restarting preserves its spent daily budget', async (t) => {
  const local = await faultProvider(t, 'fetch');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-jev-worker-stop-'));
  let bridge = await startBridge({ root, debounceMs: 0, timeoutMs: 4000, callLimit: 1,
    provider: local.provider, workerUrl: uncooperativeWorker });
  try {
    const r = { ...request(), instance: bridge.instance, token: bridge.token };
    await atomicWrite(path.join(bridge.runtime, 'inbox', `${r.id}.json`), JSON.stringify(r));
    await waitFor(() => local.calls() === 1);
    const started = Date.now();
    await bridge.stop();
    assert.ok(Date.now() - started < 1500, 'shutdown must not wait for the provider deadline');
    await waitFor(() => local.sockets.size === 0);
    for (const relative of ['bridge.info', 'bridge.lock', `outbox/${r.id}.res`]) {
      await assert.rejects(fs.access(path.join(bridge.runtime, relative)), { code: 'ENOENT' });
    }
    bridge = await startBridge({ root, debounceMs: 0, callLimit: 1, provider: local.provider,
      workerUrl: uncooperativeWorker });
    const next = { ...request(), id: 'budget', instance: bridge.instance, token: bridge.token };
    await atomicWrite(path.join(bridge.runtime, 'inbox', `${next.id}.json`), JSON.stringify(next));
    assertResponse(await waitFor(() => fs.readFile(path.join(bridge.runtime, 'outbox', 'budget.res'), 'utf8')),
      next, 'error', 'DAILY_BUDGET_EXCEEDED');
    assert.equal(local.calls(), 1, 'worker restart must not reset or bypass the parent budget');
  } finally { await bridge.stop(); }
});
