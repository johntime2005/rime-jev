import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import tls from 'node:tls';
import { isIP } from 'node:net';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

export const TRANSPORT_VERSION = 'alpn-h2-v1';
export const CONNECTION_IDLE_MS = 60000;
export const MAX_RESPONSE_BYTES = 256 * 1024;
const error = (code) => Object.assign(new Error(code), { code });
const aborted = () => error('ABORT_ERR');

function jsonBody(bytes, encoding) {
  const options = { maxOutputLength: MAX_RESPONSE_BYTES };
  if (encoding === 'gzip') bytes = gunzipSync(bytes, options);
  else if (encoding === 'deflate') bytes = inflateSync(bytes, options);
  else if (encoding === 'br') bytes = brotliDecompressSync(bytes, options);
  else if (encoding && encoding !== 'identity') throw error('INVALID_PROVIDER_RESPONSE');
  return JSON.parse(bytes.toString('utf8'));
}

// One configured origin, one request at a time. ALPN selects the protocol before
// any POST; neither protocol negotiation nor a broken connection retries a POST.
export class ProviderTransport {
  constructor(endpoint, { ca, idleTimeoutMs = CONNECTION_IDLE_MS } = {}) {
    this.url = new URL(endpoint);
    this.ca = ca;
    this.idleTimeoutMs = idleTimeoutMs;
    this.protocol = this.url.protocol === 'http:' ? 'http/1.1' : null;
    this.agent = this.protocol ? new http.Agent(this.agentOptions()) : null;
    this.session = null;
    this.sessions = new Set();
    this.initialSocket = null;
    this.connectingSocket = null;
    this.tlsSession = undefined;
    this.busy = false;
    this.closed = false;
    this.idleTimer = null;
  }

  agentOptions() {
    return { keepAlive: true, maxSockets: 1, maxFreeSockets: 1,
      timeout: this.idleTimeoutMs, ca: this.ca, rejectUnauthorized: true, ALPNProtocols: ['http/1.1'] };
  }

  idle() {
    clearTimeout(this.idleTimer);
    if (this.busy || this.closed || !this.session) return;
    const session = this.session;
    this.idleTimer = setTimeout(() => {
      if (this.session === session) this.session = null;
      session.close();
    }, this.idleTimeoutMs);
    this.idleTimer.unref();
  }

  async connection(signal) {
    if (this.session && !this.session.closed && !this.session.destroyed) {
      return { session: this.session, metrics: { protocol: 'h2', reusedConnection: true, connectMs: 0 } };
    }
    if (this.protocol === 'http/1.1') {
      return { agent: this.agent, metrics: { protocol: 'http/1.1', reusedConnection: false, connectMs: 0 } };
    }
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const host = this.url.hostname.replace(/^\[|\]$/g, '');
      const socket = tls.connect({ host, port: this.url.port || 443,
        servername: isIP(host) ? undefined : host, ca: this.ca, rejectUnauthorized: true,
        ALPNProtocols: ['h2', 'http/1.1'], session: this.tlsSession });
      this.connectingSocket = socket;
      socket.setNoDelay(true);
      let settled = false, failure;
      const abort = () => { failure = aborted(); socket.destroy(); };
      const cleanup = () => {
        signal?.removeEventListener('abort', abort);
        if (this.connectingSocket === socket) this.connectingSocket = null;
      };
      // Keep an error listener through the handoff to the HTTP owner.
      socket.on('error', (reason) => { failure ??= reason; });
      socket.on('session', (ticket) => { if (!this.closed) this.tlsSession = ticket; });
      socket.once('close', () => {
        if (!settled) { settled = true; cleanup(); reject(failure ?? error('NETWORK_ERROR')); }
      });
      socket.once('secureConnect', () => {
        if (signal?.aborted) { abort(); return; }
        settled = true;
        cleanup();
        const protocol = socket.alpnProtocol || 'http/1.1';
        const metrics = { protocol, reusedConnection: false, connectMs: Math.round(performance.now() - started) };
        try {
          if (protocol === 'h2') {
            const session = http2.connect(this.url.origin, { createConnection: () => socket,
              settings: { enablePush: false } });
            this.session = session;
            this.sessions.add(session);
            session.on('error', () => {});
            session.on('goaway', () => {
              if (this.session === session) this.session = null;
              session.close();
            });
            session.once('close', () => {
              this.sessions.delete(session);
              if (this.session === session) this.session = null;
            });
            resolve({ session, metrics });
          } else if (protocol === 'http/1.1') {
            this.protocol = protocol;
            this.agent = new https.Agent(this.agentOptions());
            this.initialSocket = socket;
            const connect = this.agent.createConnection.bind(this.agent);
            // HTTP/1-only servers use the already-negotiated TLS socket too.
            this.agent.createConnection = (options, callback) => {
              const initial = this.initialSocket;
              this.initialSocket = null;
              return initial && !initial.destroyed ? initial : connect(options, callback);
            };
            resolve({ agent: this.agent, metrics });
          } else { socket.destroy(); reject(error('NETWORK_ERROR')); }
        } catch (reason) { socket.destroy(); reject(reason); }
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  async fetch(url, options) {
    if (new URL(url).href !== this.url.href || options.method !== 'POST'
      || typeof options.body !== 'string' || !options.headers || typeof options.headers !== 'object'
      || !['http:', 'https:'].includes(this.url.protocol)) throw error('INVALID_REQUEST');
    if (this.closed) throw error('PROVIDER_STOPPED');
    if (this.busy) throw error('BUSY');
    if (options.signal?.aborted) throw aborted();
    this.busy = true;
    clearTimeout(this.idleTimer);
    try {
      const connection = await this.connection(options.signal);
      if (options.signal?.aborted || this.closed) throw aborted();
      return await this.exchange(connection, options);
    } catch (reason) {
      this.initialSocket?.destroy();
      this.initialSocket = null;
      this.busy = false;
      this.idle();
      throw reason;
    }
  }

  exchange(connection, { headers, body, signal }) {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      let resolveBody, rejectBody;
      const received = new Promise((yes, no) => { resolveBody = yes; rejectBody = no; });
      // A non-2xx response is rejected by JevClient without calling json().
      received.catch(() => {});
      let request, response, failure, ended = false, finished = false, discard = false, size = 0;
      const chunks = [];
      const stop = () => {
        if (connection.session) request.close(http2.constants.NGHTTP2_CANCEL);
        else request.destroy();
      };
      const abort = () => { failure = aborted(); stop(); };
      const finish = () => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', abort);
        this.busy = false;
        this.idle();
        if (!ended && !discard) failure ??= error('NETWORK_ERROR');
        if (failure) { reject(failure); rejectBody(failure); }
        else {
          if (discard) resolve(response);
          resolveBody(Buffer.concat(chunks));
        }
      };
      const onResponse = (status, values, readable) => {
        const encoding = values['content-encoding'];
        response = { ok: status >= 200 && status < 300, status,
          headers: { get: (name) => values[name.toLowerCase()] ?? null },
          connection: connection.metrics,
          json: async () => jsonBody(await received, encoding) };
        readable.on('error', (reason) => { failure ??= reason; });
        if (!response.ok) {
          discard = true;
          stop();
          return;
        }
        readable.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) { failure ??= error('INVALID_PROVIDER_RESPONSE'); stop(); }
          else chunks.push(chunk);
        });
        readable.once('end', () => { ended = true; });
        resolve(response);
      };
      const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
      normalized['accept-encoding'] = 'identity';
      if (connection.session) {
        request = connection.session.request({ ...normalized, ':method': 'POST',
          ':path': this.url.pathname + this.url.search, ':authority': this.url.host,
          [http2.sensitiveHeaders]: ['authorization'] });
        request.once('response', (values) => onResponse(values[':status'], values, request));
      } else {
        request = (this.url.protocol === 'https:' ? https : http).request(this.url,
          { method: 'POST', headers: normalized, agent: connection.agent },
          (message) => onResponse(message.statusCode, message.headers, message));
        request.once('socket', (socket) => {
          connection.metrics.reusedConnection = request.reusedSocket;
          if (socket.connecting) socket.once(this.url.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
            connection.metrics.connectMs = Math.round(performance.now() - started);
          });
        });
      }
      request.on('error', (reason) => { failure ??= reason; });
      // Cancellation acknowledges actual stream/request close, not just abort
      // dispatch. H2 sends RST_STREAM and leaves the TLS session reusable.
      request.once('close', finish);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      else request.end(body);
    });
  }

  close() {
    this.closed = true;
    clearTimeout(this.idleTimer);
    this.connectingSocket?.destroy();
    this.initialSocket?.destroy();
    this.agent?.destroy();
    for (const session of this.sessions) session.destroy();
    this.session = null;
    this.tlsSession = undefined;
  }
}
