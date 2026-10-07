# Upstream

Source: https://github.com/Ideny42/jev-keyboard
Revision: eca41ecce072c3cd77dda38240664c40fd69640b
License: MIT (see LICENSE)

jev.mjs and ime-completion.mjs are copied unchanged from lib/.
The Windows adapter uses JevClient, including its strict Choice response
validation, timeout, cancellation, fixed official endpoint, and no retries.
The price estimate in the upstream result is not used by this adapter.
