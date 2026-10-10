import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import { gzipSync } from 'node:zlib';
import { ProviderTransport, MAX_RESPONSE_BYTES } from '../provider-transport.mjs';
import { providerClient, providerConfig } from '../provider.mjs';
import { IsolatedProvider } from '../provider-isolate.mjs';

// Public, self-signed localhost fixtures; never loaded by production transports.
const key = readFileSync(new URL('./fixtures/localhost-key.pem', import.meta.url));
const cert = readFileSync(new URL('./fixtures/localhost-cert.pem', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = { pinyin: 'jingli', preedit: 'jing li', candidates: [
  { id: 'c1', text: 'first', originalRank: 1 }, { id: 'c2', text: 'second', originalRank: 2 }] };
const ranking = { model: 'test', usage: { input_tokens: 1, output_tokens: 0 },
  answers: { next_candidate: { type: 'choice', choice: 'c2', confidence: 0.9,
    probabilities: { c1: 0.05, c2: 0.9, none_of_the_above: 0.05 } } } };
const options = (signal) => ({ method: 'POST', headers: { 'Content-Type': 'application/json',
  Authorization: 'Bearer fixture-only' }, body: JSON.stringify({ synthetic: true }), signal });

async function until(check) {
  for (let i = 0; i < 400; i++) { if (check()) return; await sleep(5); }
  assert.fail('Transport condition did not settle');
}

async function local(t, handler, { protocol = 'h2', idleTimeoutMs = 60000, trusted = true } = {}) {
  const server = protocol === 'h2' ? http2.createSecureServer({ key, cert })
    : protocol === 'http/1.1' ? https.createServer({ key, cert }) : http.createServer();
  const sockets = new Set(), sessions = new Set();
  const state = { calls: 0, connections: 0, closed: 0 };
  server.on('connection', (socket) => {
    state.connections++;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('session', (session) => {
    sessions.add(session);
    session.on('error', () => {});
    session.on('close', () => sessions.delete(session));
  });
  server.on('request', (req, res) => {
    state.calls++;
    req.on('error', () => {}); res.on('error', () => {});
    res.on('close', () => { state.closed++; });
    req.resume();
    handler(req, res, state);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `${protocol === 'http' ? 'http' : 'https'}://127.0.0.1:${server.address().port}/v1/systemone`;
  const transport = new ProviderTransport(url, { ca: trusted ? cert : undefined, idleTimeoutMs });
  t.after(async () => {
    transport.close();
    for (const session of sessions) session.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  const fetch = (signal) => transport.fetch(url, options(signal));
  return { transport, state, fetch, url, sessions };
}

test('ALPN H2 reuses one TLS connection, sends no warm-up request, and preserves credentials/path/body', async (t) => {
  const localServer = await local(t, (req, res) => {
    assert.equal(req.httpVersion, '2.0');
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/systemone');
    assert.equal(req.headers.authorization, 'Bearer fixture-only');
    assert.equal(req.headers['accept-encoding'], 'identity');
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { assert.deepEqual(JSON.parse(body), { synthetic: true }); res.end('{"ok":true}'); });
  });
  await sleep(50);
  assert.equal(localServer.state.connections, 0);
  for (let i = 0; i < 3; i++) {
    const response = await localServer.fetch();
    assert.equal(response.connection.protocol, 'h2');
    assert.equal(response.connection.reusedConnection, i > 0);
    assert.ok(response.connection.connectMs >= 0);
    assert.deepEqual(await response.json(), { ok: true });
  }
  assert.equal(localServer.state.connections, 1);
  assert.equal(localServer.state.calls, 3);
});

test('H2 abort before headers or during the body closes only the stream and holds the single slot', async (t) => {
  const localServer = await local(t, (req, res, state) => {
    if (state.calls <= 4) { if (state.calls % 2 === 0) res.write('{'); return; }
    res.end('{"ok":true}');
  });
  for (let i = 1; i <= 4; i++) {
    const controller = new AbortController();
    const pending = localServer.fetch(controller.signal).then((response) => response.json());
    const cancelled = assert.rejects(pending, { code: 'ABORT_ERR' });
    await until(() => localServer.state.calls === i);
    await assert.rejects(localServer.fetch(), { code: 'BUSY' });
    controller.abort();
    await cancelled;
    assert.equal(localServer.transport.busy, false);
    assert.equal(localServer.transport.session.destroyed, false);
    await until(() => localServer.state.closed === i);
  }
  const response = await localServer.fetch();
  assert.equal(response.connection.reusedConnection, true);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(localServer.state.calls, 5);
  assert.equal(localServer.state.connections, 1, 'cancel must not cost another TLS handshake');
});

test('HTTP/1-only TLS and plain localhost use one POST per attempt and keep healthy connections', async (t) => {
  for (const protocol of ['http/1.1', 'http']) {
    const localServer = await local(t, (req, res) => {
      assert.equal(req.httpVersion, '1.1');
      res.end('{"ok":true}');
    }, { protocol });
    for (let i = 0; i < 3; i++) {
      const response = await localServer.fetch();
      assert.equal(response.connection.protocol, 'http/1.1');
      assert.equal(response.connection.reusedConnection, i > 0);
      assert.deepEqual(await response.json(), { ok: true });
    }
    assert.equal(localServer.state.calls, 3);
    assert.equal(localServer.state.connections, 1, 'ALPN fallback must reuse the negotiated TLS socket');
  }
});

test('HTTP/1 cancellation and broken connections never retry a POST or hold the next request', async (t) => {
  for (const protocol of ['http/1.1', 'http']) {
    const localServer = await local(t, (req, res, state) => {
      if (state.calls === 1) { res.write('{'); return; }
      if (state.calls === 2) { req.socket.destroy(); return; }
      res.end('{}');
    }, { protocol });
    const controller = new AbortController();
    const pending = localServer.fetch(controller.signal).then((response) => response.json());
    const cancelled = assert.rejects(pending, { code: 'ABORT_ERR' });
    await until(() => localServer.state.calls === 1);
    controller.abort();
    await cancelled;
    await assert.rejects(localServer.fetch());
    assert.equal(localServer.transport.busy, false);
    assert.equal(localServer.state.calls, 2);
    assert.deepEqual(await (await localServer.fetch()).json(), {});
    assert.equal(localServer.state.calls, 3);
  }
});

test('H2 reopens only on the next request after idle expiry or server GOAWAY', async (t) => {
  const localServer = await local(t, (req, res) => res.end('{}'), { idleTimeoutMs: 80 });
  await (await localServer.fetch()).json();
  await until(() => localServer.transport.session === null);
  assert.equal(localServer.state.calls, 1);
  assert.equal(localServer.state.connections, 1, 'idle expiry cannot create background traffic');
  const next = await localServer.fetch();
  assert.equal(next.connection.reusedConnection, false);
  await next.json();
  for (const session of localServer.sessions) session.goaway();
  await until(() => localServer.transport.session === null);
  const last = await localServer.fetch();
  assert.equal(last.connection.reusedConnection, false);
  await last.json();
  assert.equal(localServer.state.calls, 3);
  assert.equal(localServer.state.connections, 3);
});

test('untrusted TLS, an already-aborted request and a mismatched endpoint never send credentials', async (t) => {
  const localServer = await local(t, (req, res) => res.end('{}'), { trusted: false });
  await assert.rejects(localServer.fetch(AbortSignal.abort()), { code: 'ABORT_ERR' });
  assert.equal(localServer.state.connections, 0);
  await assert.rejects(localServer.transport.fetch(localServer.url + '/other', options()), { code: 'INVALID_REQUEST' });
  await assert.rejects(localServer.fetch());
  assert.equal(localServer.state.calls, 0);
  assert.equal(localServer.transport.busy, false);
});

test('cancellation or shutdown during TLS negotiation releases the slot without a POST', async (t) => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('data', () => {}); // Accept ClientHello, but never complete TLS.
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `https://127.0.0.1:${server.address().port}/v1/systemone`;
  const transport = new ProviderTransport(url);
  t.after(async () => {
    transport.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  const controller = new AbortController();
  const cancelled = assert.rejects(transport.fetch(url, options(controller.signal)), { code: 'ABORT_ERR' });
  await until(() => sockets.size === 1);
  controller.abort();
  await cancelled;
  assert.equal(transport.busy, false);
  await until(() => sockets.size === 0);
  const closed = assert.rejects(transport.fetch(url, options()));
  await until(() => sockets.size === 1);
  transport.close();
  await closed;
  assert.equal(transport.busy, false);
  await assert.rejects(transport.fetch(url, options()), { code: 'PROVIDER_STOPPED' });
});

test('redirects and provider errors are not followed or retried and retire their response stream', async (t) => {
  for (const protocol of ['h2', 'http/1.1']) {
    const localServer = await local(t, (req, res) => {
      res.writeHead(307, { location: 'https://must-not-follow.invalid/' });
      res.write('unfinished body');
    }, { protocol });
    const response = await localServer.fetch();
    assert.equal(response.status, 307);
    assert.equal(response.ok, false);
    assert.equal(localServer.transport.busy, false);
    await until(() => localServer.state.closed === 1);
    await sleep(30);
    assert.equal(localServer.state.calls, 1);
  }
});

test('truncated, oversized and invalid JSON responses reject without retaining a pending slot', async (t) => {
  const localServer = await local(t, (req, res, state) => {
    if (state.calls === 1) { res.write('{'); setTimeout(() => res.destroy(), 10); }
    else if (state.calls === 2) res.end('x'.repeat(MAX_RESPONSE_BYTES + 1));
    else if (state.calls === 3) res.end('not json');
    else res.end('{}');
  });
  for (let i = 0; i < 3; i++) {
    await assert.rejects(localServer.fetch().then((response) => response.json()));
    assert.equal(localServer.transport.busy, false);
  }
  assert.deepEqual(await (await localServer.fetch()).json(), {});
  assert.equal(localServer.state.calls, 4);
});

test('compressed responses are decoded with a bounded uncompressed size', async (t) => {
  const localServer = await local(t, (req, res, state) => {
    res.setHeader('content-encoding', 'gzip');
    res.end(gzipSync(state.calls === 1 ? '{"ok":true}' : 'x'.repeat(MAX_RESPONSE_BYTES + 1)));
  });
  assert.deepEqual(await (await localServer.fetch()).json(), { ok: true });
  await assert.rejects((await localServer.fetch()).json());
});

test('JevClient validates the full H2 response and body timeout still settles before reuse', async (t) => {
  const localServer = await local(t, (req, res, state) => {
    if (state.calls === 2) { res.write('{'); return; }
    res.end(JSON.stringify(ranking));
  });
  const client = providerClient(providerConfig({ endpoint: localServer.url }), {
    apiKey: 'fixture-only', timeoutMs: 300, callLimit: 3,
    fetchImpl: localServer.transport.fetch.bind(localServer.transport) });
  const first = await client.rank(snapshot, 'prefix', { confirmLive: true });
  assert.equal(first.ranked[0].originalRank, 2);
  await assert.rejects(client.rank(snapshot, 'prefix', { confirmLive: true }), { code: 'TIMEOUT' });
  assert.equal(localServer.transport.busy, false);
  assert.equal((await client.rank(snapshot, 'prefix', { confirmLive: true })).ranked[0].originalRank, 2);
  assert.equal(localServer.state.connections, 1);
  assert.equal(localServer.state.calls, 3);
});

test('production worker reuses H2 after acknowledged cancellation and retains hard deadline recovery', async (t) => {
  const localServer = await local(t, (req, res, state) => {
    if (state.calls === 1) { res.write('{'); return; }
    if (state.calls === 3) return;
    res.end(JSON.stringify(ranking));
  });
  const client = new IsolatedProvider({ provider: providerConfig({ endpoint: localServer.url }),
    apiKey: 'fixture-only', timeoutMs: 700, workerUrl: new URL('./fixtures/h2-provider.mjs', import.meta.url) });
  t.after(() => client.close());
  const controller = new AbortController();
  const cancelled = assert.rejects(client.rank(snapshot, '', { signal: controller.signal }), { code: 'CANCELLED' });
  await until(() => localServer.state.calls === 1);
  controller.abort();
  await cancelled;
  assert.equal(client.metrics.cooperativeCancellations, 1);
  const recovered = await client.rank(snapshot, '');
  assert.equal(recovered.ranked[0].originalRank, 2);
  assert.equal(recovered.timings.protocol, 'h2');
  assert.equal(recovered.timings.reusedConnection, true);
  assert.equal(recovered.timings.connectMs, 0);
  assert.equal(client.metrics.starts, 1);
  assert.equal(localServer.state.connections, 1);
  await assert.rejects(client.rank(snapshot, ''), { code: 'TIMEOUT' });
  assert.equal(client.active, false);
  assert.equal(client.worker, null);
  assert.equal((await client.rank(snapshot, '')).ranked[0].originalRank, 2);
  assert.equal(client.metrics.starts, 2);
  assert.equal(localServer.state.calls, 4);
  assert.equal(localServer.state.connections, 2);
});

test('H2 GOAWAY during a request discards that request without automatic replay', async (t) => {
  const localServer = await local(t, (req, res, state) => {
    if (state.calls === 1) {
      req.stream.session.goaway(http2.constants.NGHTTP2_INTERNAL_ERROR);
      return;
    }
    res.end('{}');
  });
  await assert.rejects(localServer.fetch());
  assert.equal(localServer.state.calls, 1);
  assert.equal(localServer.transport.busy, false);
  assert.deepEqual(await (await localServer.fetch()).json(), {});
  assert.equal(localServer.state.calls, 2);
});
