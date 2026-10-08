import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRequest, resultOrder, startBridge, atomicWrite } from '../bridge.mjs';
import { buildRequest, parseResponse, JevClient } from '../vendor/jev-keyboard/jev.mjs';

const request = () => ({ protocol: 1, id: 'test_1', session: 'test', sequence: 1,
  instance: 'instance', token: 'token', createdAt: Math.floor(Date.now() / 1000),
  pinyin: 'jingli', caret: 6, preedit: 'jing li', context: '\u4ed6\u62c5\u4efb\u90e8\u95e8',
  document: { source: 'tsf', quality: 'exact', stamp: '10-20-30' },
  candidates: ['\u7ecf\u5386', '\u7ecf\u7406', '\u7cbe\u529b'].map((text) => ({ text, start: 0, end: 6 })) });

test('validates complete snapshots and rejects malformed, stale, untrusted input', () => {
  const r = request();
  assert.equal(validateRequest(r, 'instance', 'token').candidates.length, 3);
  for (const patch of [{ token: 'wrong' }, { id: '../file' }, { createdAt: 1 }, { caret: 1 },
    { context: 'a'.repeat(81) }, { candidates: [] }, { sequence: 0 }]) {
    assert.throws(() => validateRequest({ ...r, ...patch }, 'instance', 'token'));
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
    assert.match(output, /^JEVWIN2\n/);
    assert.match(output, /\nok\n\d+\n3\n2,1,3\n10-20-30\n$/);
    await atomicWrite(path.join(bridge.runtime, 'inbox', 'bad.json'), JSON.stringify({ ...r, id: 'bad', token: 'bad' }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await assert.rejects(fs.access(path.join(bridge.runtime, 'outbox', 'bad.res')));
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'status.json'))).callsToday, 0);
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
