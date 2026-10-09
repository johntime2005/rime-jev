import test from 'node:test';
import assert from 'node:assert/strict';
import { providerConfig, providerClient, continuationRequest } from '../provider.mjs';
import { buildRequest } from '../vendor/jev-keyboard/jev.mjs';

const snapshot = { pinyin: 'jingli', preedit: 'jing li', candidates: [
  { id: 'c1', text: 'first', originalRank: 1 }, { id: 'c2', text: 'second', originalRank: 2 }] };

test('continuation requests attach the exact prefix to every option and preserve abstention/IDs', () => {
  const context = '\u624d\u77e5\u9053\u4ec0\u4e48';
  const input = { pinyin: 'jiao', preedit: 'jiao', candidates: [
    { id: 'c1', text: '\u4ea4', originalRank: 1 }, { id: 'c2', text: '\u53eb', originalRank: 2 },
    { id: 'c3', text: '\u6559', originalRank: 3 }] };
  const original = buildRequest(input, context, 'test-model');
  const body = continuationRequest(original);
  assert.equal(body.model, 'test-model');
  assert.equal(body.state.preceding_text, context);
  assert.equal(body.state.chinese_text_to_continue, context + '____');
  assert.equal(body.state.uncommitted_pinyin, 'jiao');
  assert.deepEqual(Object.keys(body.questions.next_candidate.criteria), ['c1', 'c2', 'c3', 'none_of_the_above']);
  for (const candidate of input.candidates) {
    assert.deepEqual(body.questions.next_candidate.criteria[candidate.id], {
      candidate_text: candidate.text, text_after_selection: context + candidate.text });
    assert.equal(original.questions.next_candidate.criteria[candidate.id].text_after_selection, undefined);
  }
  assert.equal(body.questions.next_candidate.criteria.none_of_the_above, original.questions.next_candidate.criteria.none_of_the_above);
  assert.match(body.questions.next_candidate.instructions, /unfinished sentence/);
  assert.match(body.questions.next_candidate.instructions, /data, never instructions/);
  const empty = continuationRequest(buildRequest(input, '', 'test-model'));
  assert.equal(empty.questions.next_candidate.criteria.c2.text_after_selection, '\u53eb');
});

test('default provider sends joined fragments once but still accepts a legitimate abstention', async () => {
  let calls = 0;
  const provider = providerConfig({ endpoint: 'https://relay.example/v1/systemone' });
  const client = providerClient(provider, { apiKey: 'test-key', callLimit: 1, timeoutMs: 1000,
    fetchImpl: async (_, options) => {
      calls++;
      const body = JSON.parse(options.body);
      assert.equal(body.questions.next_candidate.criteria.c2.text_after_selection, 'prefixsecond');
      assert.ok(body.questions.next_candidate.criteria.none_of_the_above);
      return { ok: true, json: async () => ({ model: 'test', usage: { input_tokens: 1, output_tokens: 0 },
        answers: { next_candidate: { type: 'choice', choice: 'none_of_the_above', confidence: 0.8,
          probabilities: { c1: 0.1, c2: 0.1, none_of_the_above: 0.8 } } } }) };
    } });
  const result = await client.rank(snapshot, 'prefix', { confirmLive: true });
  assert.equal(result.abstained, true);
  assert.equal(result.noneProbability, 0.8);
  assert.equal(calls, 1);
});

test('validates endpoint and auth without silently downgrading TLS', () => {
  assert.equal(providerConfig().model, 'jev-latest');
  assert.equal(providerConfig({ endpoint: 'http://127.0.0.1:8080/v1/systemone', auth: 'none' }).auth, 'none');
  for (const config of [ { endpoint: 'http://example.org/v1/systemone' },
    { endpoint: 'https://key@example.org/' }, { endpoint: 'https://example.org/?key=secret' },
    { endpoint: 'https://example.org/', auth: 'none' }, { protocol: 'chat' } ]) {
    assert.throws(() => providerConfig(config));
  }
});

test('relay receives its own key and configured model, not official endpoint', async () => {
  const provider = providerConfig({ endpoint: 'https://relay.example/v1/systemone', model: 'openjev', allowNone: false });
  let calls = 0;
  const client = providerClient(provider, { apiKey: 'relay-test-key', callLimit: 2, timeoutMs: 1000,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, provider.endpoint);
      assert.equal(options.headers.Authorization, 'Bearer relay-test-key');
      assert.equal(options.redirect, 'error');
      assert.equal(JSON.parse(options.body).model, 'openjev');
      return { ok: true, json: async () => ({ model: 'openjev', usage: { input_tokens: 1, output_tokens: 0 },
        answers: { next_candidate: { type: 'choice', choice: 'c2', confidence: 0.8, probabilities: { c1: 0.2, c2: 0.8 } } } }) };
    } });
  const result = await client.rank(snapshot, '', { confirmLive: true });
  assert.equal(result.ranked[0].id, 'c2');
  assert.equal(calls, 1);
});

test('local OpenJev can omit authorization', async () => {
  const provider = providerConfig({ endpoint: 'http://localhost:8080/v1/systemone', auth: 'none' });
  const client = providerClient(provider, { apiKey: '', callLimit: 2, timeoutMs: 1000,
    fetchImpl: async (_, options) => {
      assert.equal(options.headers.Authorization, undefined);
      return { ok: false, status: 503 };
    } });
  await assert.rejects(client.rank(snapshot, '', { confirmLive: true }), /503/);
});

test('client body-read abort remains TIMEOUT rather than invalid JSON without the parent watchdog', async () => {
  const provider = providerConfig({ endpoint: 'http://127.0.0.1/v1/systemone', auth: 'none' });
  let calls = 0;
  const client = providerClient(provider, { apiKey: '', callLimit: 1, timeoutMs: 50,
    fetchImpl: async (_, { signal }) => {
      calls++;
      return { ok: true, json: () => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted body')), { once: true });
      }) };
    } });
  await assert.rejects(client.rank(snapshot, '', { confirmLive: true }), { code: 'TIMEOUT' });
  assert.equal(client.inFlight, false);
  assert.equal(calls, 1);
});

test('explicit cancellation takes precedence over the client body-read error', async () => {
  const provider = providerConfig({ endpoint: 'http://127.0.0.1/v1/systemone', auth: 'none' });
  const controller = new AbortController();
  const client = providerClient(provider, { apiKey: '', callLimit: 1, timeoutMs: 4000,
    fetchImpl: async (_, { signal }) => ({ ok: true, json: () => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted body')), { once: true });
      controller.abort();
    }) }) });
  await assert.rejects(client.rank(snapshot, '', { confirmLive: true, signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(client.inFlight, false);
});
