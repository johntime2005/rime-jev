import test from 'node:test';
import assert from 'node:assert/strict';
import { providerConfig, providerClient } from '../provider.mjs';

const snapshot = { pinyin: 'jingli', preedit: 'jing li', candidates: [
  { id: 'c1', text: 'first', originalRank: 1 }, { id: 'c2', text: 'second', originalRank: 2 }] };

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
