import { API_URL, JevClient } from './vendor/jev-keyboard/jev.mjs';

export function providerConfig(input = {}) {
  const endpoint = new URL(input.endpoint ?? API_URL);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || (endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:'))) {
    throw new Error('Use HTTPS, or HTTP on localhost, without URL credentials/query/fragment.');
  }
  const protocol = input.protocol ?? 'systemone';
  if (protocol !== 'systemone') throw new Error('Only System One is supported; chat/completions requires a separate adapter.');
  const model = input.model ?? 'jev-latest';
  if (typeof model !== 'string' || !model.trim() || model.length > 200) throw new Error('Invalid model');
  const auth = input.auth ?? 'bearer';
  if (!['bearer', 'none'].includes(auth) || (auth === 'none' && !local)) {
    throw new Error('Unauthenticated endpoints are limited to localhost.');
  }
  return { endpoint: endpoint.href, protocol, model, auth, allowNone: input.allowNone !== false };
}

export function providerClient(provider, { apiKey, callLimit, timeoutMs, fetchImpl = globalThis.fetch }) {
  // Keep upstream protocol validation unchanged; only replace the transport target.
  const transport = (_, options) => {
    const headers = { ...options.headers };
    if (provider.auth === 'none') delete headers.Authorization;
    return fetchImpl(provider.endpoint, { ...options, headers, redirect: 'error' });
  };
  return new JevClient({ enableLive: true, apiKey: apiKey || (provider.auth === 'none' ? 'local-no-auth' : ''),
    model: provider.model, allowNone: provider.allowNone, callLimit, timeoutMs, maxConcurrent: 1, demoToken: '' },
  { fetchImpl: transport });
}
