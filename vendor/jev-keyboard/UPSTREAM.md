# Upstream

Source: https://github.com/Ideny42/jev-keyboard
Revision: eca41ecce072c3cd77dda38240664c40fd69640b
License: MIT (see LICENSE)

jev.mjs and ime-completion.mjs were copied from lib/ at this revision.
ime-completion.mjs remains unchanged. Local changes to jev.mjs:

- Check the timeout signal before preserving AppError in rank's catch block.
  A timeout during response.json() must report TIMEOUT, not the JSON parser's
  INVALID_PROVIDER_RESPONSE wrapper. Explicit input cancellation still wins;
  malformed completed JSON remains INVALID_PROVIDER_RESPONSE. No retries added.

The Windows adapter uses JevClient, including its strict Choice response
validation, timeout, cancellation, fixed official endpoint, and no retries.
The price estimate in the upstream result is not used by this adapter.

The independent provider.mjs adapter now transforms the default allow-none
request to score context+candidate continuations, reusing COMPLETION_PROMPT.
Candidate IDs, none_of_the_above, response validation, thresholds and endpoint
selection are unchanged. The upstream no-none completion request is unmodified.
The transport adapter's prompt version is reported in bridge status; the vendor
result's request metadata is not used as an audit of the transformed wire body.
