import '../../provider-worker.mjs';

const fetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  // Local HTTP only: exercise the production worker with a transport that
  // ignores AbortSignal, rather than another cooperative fetch timeout.
  if (new URL(url).hostname !== '127.0.0.1') throw new Error('Local fixture only');
  const response = await fetch(url, { ...options, signal: undefined });
  const fault = response.headers.get('x-test-fault');
  if (fault === 'fetch') return new Promise(() => {});
  if (fault === 'body') return { ok: true, json: () => new Promise(() => {}) };
  if (fault === 'spin') { while (true) {} }
  if (fault === 'crash') {
    setImmediate(() => { throw new Error('fixture-only-sensitive-detail'); });
    return new Promise(() => {});
  }
  if (fault === 'exit') process.exit(0);
  return response;
};
