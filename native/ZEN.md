# Zen URL-bar context validation

Checked on 2026-10-09 with Zen 1.23.1b / Gecko 157.0.1, x64 Windows.

## Installed change

After the user approved browser-context capture, appended only this entry to
the existing personal `rime_ice_jev.custom.yaml` and deployed at 18:26 local:

```yaml
patch:
  jev_windows/context_apps:
    - zen.exe
```

This is a fragment to merge, not a replacement for an existing `patch` map.
The generic schema still defaults to an empty allowlist. The gate is the
executable, NOT the URL bar: other supported editable controls inside Zen may
also supply context. Automatic requests can send up to 80 preceding Unicode
scalars to the already-configured provider. The separate Pebrel opt-in is
unchanged. Known sensitive scopes remain excluded; this is not universal DLP.

No provider, threshold, native binary, Lua, dictionary file or skin setting was
replaced. The original personal profile survives byte-for-byte before the new
lines, retaining all six nasal rules. Ten protected-file hashes were verified
unchanged: provider config, encrypted key, preferences, installation manifest,
default schema list, skin, installed Lua/schema, stock prism and registered DLL.
Normal candidate commits can still update Rime's learned user frequency.

Backup and numeric receipt:
`%LOCALAPPDATA%/RimeJev/backups/zen-context-20261009-182641/receipt.json`.
The same directory contains the original custom file, old compiled schema and
`Rollback-ZenContext.ps1`. The rollback checks both hashes and refuses to
overwrite later personal edits. It is prepared, not executed. F8 disables
automatic requests immediately; Ctrl+F8 suppresses context for one composition.

## Actual control checks

Used a disposable profile of the installed Zen executable, with a loopback-only
Marionette session. The existing browser profile and tabs were not automated.
Search suggestions, speculative connections and prefetch were disabled in the
test profile. No Enter/search submission was used. Only fixed, non-sensitive
samples were seeded; native Windows key events exercised the installed IME.
This test controller is not part of the production input method and does not
provide a context fallback. Production text came from the TSF composition-start
reader, not Marionette, screenshots, the clipboard or Rime commit history.

The company-manager sample produced seven characters of `source=tsf` context.
At 18:58 the actual candidate window showed the original fifth candidate at
rank 1. Two subsequent complete runs at 19:10 and 19:11 both visibly selected
the manager word and Space committed the expected full sentence. Their
ready/apply timings were 1383/84 ms and 1299/32 ms respectively. The second
run's original rank was 2 after normal learning; the first successful commit
was rank 5. These are a few observed timings, not a latency benchmark.

Additional checks correlated request IDs and matched captured prefixes in
memory, saving only counts, numeric rankings and prefix hashes:

| Check | Result |
| --- | --- |
| Change the initial pronoun with the same seven-character length | New exact prefix; expected manager committed |
| Place the caret before a literal English suffix | Only the seven preceding characters sent; suffix excluded |
| Delete the character before composition | Six characters sent, not stale seven-character history |
| Change the sentence to require effort/energy | Ten-character context; original rank 6 promoted to energy and committed |
| Ctrl+F8 during composition | Empty context, source none; service abstained |
| Next composition after suppression | Seven-character TSF context recovered; expected manager committed |
| Standard password input on a local data URL | Six synthetic keystrokes; no Jev request and no provider-call increase |

Numeric evidence and synthetic-only screenshots are under
`runtime/zen-context-check-20261009/`, including `manager-roundtrip.json`,
`boundary-results.json`, `password-result.json`, `manager-roundtrip.png` and
`different-meaning.png`. Later runs overwrite the manager screenshot/receipt;
the earlier rank-5 timings above were also observed directly. The live call
counter moved from 38 to 48, including one interrupted diagnostic attempt.
Already-issued calls were not retried automatically or rolled back.

The initial fragmented automation was not acceptance: after disconnecting and
reconnecting between composition and commit, it once read an empty URL bar;
a later attempt remained pending with no new backend result and the disposable
browser disconnected/exited. Its cause was not established and no crash was
attributed to a particular component. A fresh browser and a single automation
session completed the full round trips and boundary checks. General browser
exit/focus stress stability therefore remains unverified. The disposable test
browser was closed; its remote-control port is no longer running.

## Regression and limits

- 56 Node tests and 11 Python unit tests pass.
- Isolated `native_rime.py --context` and `--nasal-profile` pass, including
  stale-result rejection, manual selection, suppression and original prism.
- Those regressions use local/mock providers, not additional real API calls.
- This validates specific Zen controls and samples, not every site/editor,
  all password/private fields, general model accuracy, or long-running GUI
  stability. The user's existing-profile window was not retested by automation.
- No API latency improvement is claimed. Fast typing may commit before the
  asynchronous ranking is ready; the displayed candidate must remain decisive.
