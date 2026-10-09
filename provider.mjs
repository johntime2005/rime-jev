import { API_URL, JevClient } from './vendor/jev-keyboard/jev.mjs';
import { COMPLETION_PROMPT } from './vendor/jev-keyboard/ime-completion.mjs';

export const CONTINUATION_PROMPT_VERSION = 'ime-continuation-with-none-v1';

export function continuationRequest(request) {
  const context = request.state.preceding_text;
  const question = request.questions.next_candidate;
  // Keep IDs and the abstention option unchanged; score completed fragments,
  // not isolated candidate meanings. All supplied text stays data, not instructions.
  const criteria = Object.fromEntries(Object.entries(question.criteria).map(([id, value]) => [id,
    typeof value === 'object' && typeof value?.candidate_text === 'string'
      ? { ...value, text_after_selection: context + value.candidate_text } : value]));
  return { ...request, state: { ...request.state, chinese_text_to_continue: context + '____' },
    questions: { ...request.questions, next_candidate: { ...question, criteria,
      instructions: COMPLETION_PROMPT +
        ' Select none_of_the_above only if none is a reasonable continuation; an unfinished sentence is allowed.' } } };
}

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
  // Preserve strict upstream response validation and the configured endpoint.
  const transport = (_, options) => {
    const headers = { ...options.headers };
    if (provider.auth === 'none') delete headers.Authorization;
    const body = provider.allowNone !== false ? JSON.stringify(continuationRequest(JSON.parse(options.body))) : options.body;
    return fetchImpl(provider.endpoint, { ...options, body, headers, redirect: 'error' });
  };
  return new JevClient({ enableLive: true, apiKey: apiKey || (provider.auth === 'none' ? 'local-no-auth' : ''),
    model: provider.model, allowNone: provider.allowNone, callLimit, timeoutMs, maxConcurrent: 1, demoToken: '' },
  { fetchImpl: transport });
}
