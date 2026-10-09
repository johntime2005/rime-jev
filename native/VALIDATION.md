# Native refresh validation status

Last checked: 2026-10-09.

## Integrated context and cancellation continuation

Integrated `feat/tsf-surrounding-context` at `aaf1cae` with the main branch's
worker isolation, continuation prompt, Pebrel context adapter, cancellation
receipts and personal typing-profile support. The merge does not revert the
100ms debounce, provider settings or local nasal profile. Commit history is
no longer forwarded as document text. TSF capture remains opt-in, with an empty
default app allowlist. See `CONTEXT.md` for the native privacy/freshness contract.

Local verification on 2026-10-09, without live provider calls or GUI typing:

- All 56 Node tests pass, including local hung transports, worker exits,
  cancellation recovery, mixed-version protocol, TSF text validation and the
  Pebrel adapter's controlled Runtime fixtures. Response assertions now check
  the entire v2 envelope, including document stamp, for errors as well as ranks.
- All nine Python unit tests pass. Packaging rejects mismatched/missing native
  headers as well as the patch, and includes the bridge/provider dependencies.
  Synthetic PE fixtures test packaging only, not executable compatibility.
- Four native C++ executables compile with VS 2022 and pass: scalar/protocol,
  controlled text store, async-session ownership and real Windows TSF manager.
  The manager test does not activate the installed TIP or certify its UI.
- Isolated librime tests pass in ordinary, `--context`, `--typing-profile` and
  `--nasal-profile` modes. Manual choice, Space commit, focus invalidation,
  timeout labels, context suppression and original-prism preservation pass.
- `Configure.ps1` parses successfully in Windows PowerShell; its UTF-8 BOM is
  retained for the Chinese console prompts. This is not interactive acceptance.

Native binaries were downloaded from the successful full DLL/server build
https://github.com/johntime2005/rime-jev/actions/runs/37888288576 at `aaf1cae`.
The patch and all three native headers match the merged working tree after
line-ending normalization. The combined adapter is tested locally; the
feature-branch CI run is not represented as a build of the later merge commit.
The new DLL passes unregistered COM load/create/release in a disposable Python
process, but still retains one service reference (`DllCanUnloadNow=S_FALSE`).
This is not hot-unload acceptance. No complete native rebuild was run locally.

Inspection found that the installed Lua still enabled Jev only for
`jev-context-trial.exe`, and the schema directed IPC to the stopped local trial
bridge. The installation manifest matched those files; a live ordinary bridge
running elsewhere therefore received no input requests. The earlier cancelled
UAC receipt did not describe the later successful 2026-10-08 trial replacement.
Deployment and backup state are recorded separately in `REPLACEMENT.md`.

Visible candidate-window behavior, real target applications, key-path latency
and daily-use stability still require acceptance; these tests do not certify
terminal/game support or universal sensitive-field detection.

## Continuation-choice failure and request-design correction

A user-visible jiao composition kept original rank 1 where the intended
continuation was original rank 2. The most recent diagnostic had zero context
and provider abstention, but lacked correlation to the screenshot; it does not
prove that screenshot's cause. Fixed-text probes with the supplied full prefix
and seven visible candidates exposed an additional failure: the old request
favored rank 6 at 0.56, and at 0.61 on a second explicit comparison. Merely
lowering the 0.60 threshold would promote the wrong word.

With the same configured endpoint/model/credentials, comparing full
context+candidate continuations while retaining none_of_the_above selected
rank 2 at 0.96. The upstream forced-completion format selected it at 0.99, but
forced selection is not adopted. This is evidence of request-format sensitivity
and a concrete design flaw, not an independent identification of the relay's
underlying model or an accuracy benchmark. The production transport now uses
the joined-continuation format with the abstention option preserved. IDs,
strict probability validation, thresholds, deadline, endpoint and authentication
remain unchanged. The new status promptVersion is
`ime-continuation-with-none-v1`; the upstream files are not changed for this.

Deployed bridge-only at 11:05 local with a restart that also invalidates the old
in-memory cache. Debounce reverted from 40 to 100ms: the earlier status recorded
970 provider cancellations / 1038 budgeted attempts since that restart and only
one promotion. These counts are not necessarily billed HTTP calls, but they
make the short-debounce trial unsuitable as a demonstrated typing improvement.
No claim is made that returning to 100ms fixes all scheduling inefficiencies.
Provider/key/preferences, nasal profile, Lua/schema, ordinary prism/table and
native binaries were verified unchanged (11 protected hashes). Config backup:
`%LOCALAPPDATA%/RimeJev/backups/continuation-20261008-110505`.

Three generic continuation probes against the deployed provider selected the
expected ranks 2, 6 and 1 with probabilities 0.99, 1.0 and 0.99, respectively.
Result-ready times 1329/518/539ms show accuracy-format progress, not a latency
solution. The first included a slow network phase. These probes are file IPC,
not TSF window observations. Six earlier comparative probes and three final
probes counted in the real persisted usage ledger; ordinary input also occurred.
The isolated comparison acquired the real bridge lock and stopped the ordinary
bridge first, so it did not bypass single concurrency or the daily cap.

36 Node tests, seven Python unit tests and nasal-profile installed-librime
integration pass. Tests verify joined text/IDs and legitimate abstention, not
model accuracy. GUI acceptance and reliable document-context integration remain
open. GitHub packaging was interrupted by this investigation; it has not been
published by this continuation.

## User-selected nasal-only profile

At 10:47 local the user specified front/back nasals only, with other initials
not a problem. Added `Typing-Profile.py --nasal`, selecting only an/ang, en/eng
and in/ing. The suffix an/ang pair already covers ian/iang and uan/uang, so six
rules suffice. Unit tests verify both directions and unchanged unrelated
initials. The schema/prism isolation from the earlier update is unchanged.

`python tests/native_rime.py --nasal-profile` passed with 14 local synthetic
cases, including beijin, banzhu, bangfa, shenming, rengmin, xingwen, xianfa,
dianghua, guanbo, guangbi, normal spelling, abbreviations and a custom phrase.
Each expected word appeared on the first page; no promise is made that every
fuzzy input is first-ranked. These C-API candidate-generation cases took
7.09-17.91ms with Jev disabled, not a measurement of the live TSF window.
The same run also passes the mock bridge/native-property safety regressions.
All seven Python unit tests passed. No live API probe was sent for this change.

Generated and deployed `%APPDATA%/Rime/rime_ice_jev.custom.yaml` (previously
absent), SHA-256 `626E40D693DA63F352C1F23CBE5222A652FB1F70C5C74623CED1237163037D0B`.
Verified all six nasal rules in the compiled schema and absence of the other
fuzzy-initial rules. Thirteen protected hashes stayed unchanged, including
ordinary rime_ice prism/table, schema/Lua, provider/key/preferences, default,
skin, installation manifest and native binaries. Backup and receipt:
`%LOCALAPPDATA%/RimeJev/backups/nasal-profile-20261008-104753`.
The custom file is user-managed, not appended to the uninstall manifest;
future updates/uninstall preserve it. GUI acceptance remains outstanding.

## Daytime continuation: latency and local typing

The initial live state had only cancellations and no completed result since
startup. It could not explain their cause. Added bounded authenticated adapter
cancellation receipts (enum reason and request ID, no text), separate bridge
cancellation phases, and an allowlisted context-state/clear-reason diagnostic.
Counts are intentionally separate: Lua can cancel before bridge discovery.
The native integration now verifies an actual focus notification clears prior
commits, emits a focus cancellation receipt, and advances the cache epoch.
These changes diagnose but do not establish the cause of the earlier screenshot.

The provider worker now initializes locally before first input and during
debounce after cancellation. It does not open a connection or send a warm-up
request. Successful identical live snapshots may reuse a 15-second, 32-entry
memory cache, keyed by a hash including session, clear epoch, context-enabled
flag, complete context, input/caret/preedit and ordered candidate spans/text.
It retains numeric decisions, not raw text, and never persists the cache.
Cache hits skip the network debounce and daily API charge; they still produce
a newly identified/expiring response and pass the same Lua application gates.
They do not retry, learn a new personal vocabulary, or infer a new ranking.
Error/cancelled results are not cached; restart discards entries. Local tests
cover TTL, disable, context/candidate/session/epoch misses, replay validation,
daily cap and no network request from warming. Cooperative worker cancellation
was NOT introduced: the hard termination/await-exit safety remains unchanged.

Three live synthetic baseline results were ready at 1619/531/533ms; provider
times were 1497/415/417ms. After the update, six repeated synthetic results were
ready at 506/1413/471/17/734/15ms. The first three were real provider calls
(451/382/420ms including worker messaging), the last three were cache hits.
Transport headers took 418/380/418ms and body reads 3/2/1ms. Ordinary live input
also occurred in the bridge during this batch, so queueing was not controlled.
The 1413ms network result and 734ms cache hit are not hidden or excluded:
localMs includes queue/discovery time, not merely the configured debounce.
Added discoveryMs for subsequent measurements to help separate that delay.
Neither these samples nor warm-up establish a general speedup or <100ms UI.
The current native candidate timer is still 100ms and GUI acceptance is pending.

At 10:39 local, deployed Lua/schema with the existing Update script. Backup:
`%LOCALAPPDATA%/RimeJev/backups/update-20261008-103925`. Configuration-only backup:
`%LOCALAPPDATA%/RimeJev/backups/latency-20261008-103923`. Only debounceMs changed
from 100 to 40; provider, key, daily limit, preferences, default/skin and three
native binaries were preserved. Counts stayed 253 across the deployment; later
probes and ordinary input increased them. A smaller debounce may send more
intermediate inputs and spend more attempts; the same cap/cancellation checks
remain. Text-free receipt: `runtime/latency-update-20261008.json`.

The Jev schema previously used an explicit __patch, suppressing automatic
schema.custom loading. It now explicitly includes `rime_ice_jev.custom:/patch?`
and uses its own spelling prism while retaining rime_ice dictionary/user_dict.
No fuzzy rule is enabled in the installed default. Typing-Profile.py generates
an opt-in patch for selected pairs only, preserves inherited spelling rules,
and refuses to overwrite existing output. No dictionary download/large import
or local language model was performed.

Isolated installed-librime testing with z/zh and in/ing enabled verifies zg,
zhongg, zongguo, beijin and a custom short phrase. Whole synthetic input-to-menu
times were 4.55/12.35/11.85/9.9/7.15ms; these are local C-API timings, not TSF
pixels or ordinary desktop key latency. The original prism hash is unchanged.
Both default and custom-profile integration pass, alongside 34 Node tests and
6 Python unit tests. This does not complete the original native GUI gates.

## Ranking-effect investigation

The user supplied a visible `keep original` result for the synthetic prefix
followed by `jingli`, with the intended candidate still fourth. Before restarting
for diagnostics, the live bridge reported 0 promotions, 12 same-first results,
10 abstentions and 20 native receipts since its earlier restart. This supports
the reported lack of useful reordering; fixing a stuck request was not a fix
for ranking effectiveness. The older status did not retain probabilities or
context length, so it cannot establish the cause of that particular result.

Added text-free result diagnostics: request ID for exact probe correlation,
context character count, candidate count, top rank/probability, competing
probability, margin and gate reason (provider abstention versus local probability
or margin threshold). Thresholds and provider configuration remain unchanged.
The diagnostic bridge was restarted and verified live as PID 33844. No Lua or
native file replacement was required. Tests also verify actual isolated librime
commits are included in a subsequent context-enabled request; this does not
test the browser's TSF focus behavior or prove context in the user's screenshot.

Three explicit synthetic live probes used the screenshot's seven candidate
strings, through the configured bridge (`--live --context-check`). With the
appointment prefix, the service chose original rank 4 with reported probability
1.0; with no prefix it kept original rank 1 (0.61); with the effort prefix it
chose original rank 5 (0.95). Result-ready times were 1395/530/544ms, and usage
rose from 342 to 345. These were file-IPC probes, not visible candidate-window
tests. Raw input, keys and response bodies are not retained in diagnostics.

The contrast makes missing/cleared context worth checking, but is not proof:
the earlier request might have had context, and service results can vary. A new
user reproduction can now distinguish that case from a low-probability response.
Do not lower thresholds, preserve context across focus boundaries, or claim
the reported ranking failure is fixed on the strength of these samples.

## Provider isolation follow-up

A subsequent text-free diagnostic recorded provider phase age 210855ms with
empty inbox/outbox queues and no reported error. This is evidence of a stuck
bridge request slot, not just an outdated candidate annotation. At continuation
the old status was stale and the bridge process was no longer running. The
underlying live transport failure has not been reproduced or attributed to a
specific Node/Undici defect.

Provider fetch and response parsing now run in a reusable worker. A parent-side
deadline (4000ms in production) terminates a stuck worker independently of its
AbortSignal handling. Cancellation also terminates it, and the bridge awaits
actual worker exit before releasing the single request slot. Healthy requests
reuse the worker; a failed attempt is never retried. The parent persists the
daily attempt count before dispatch, so worker replacement cannot reset it.
Termination is asynchronous, not a real-time guarantee against OS/native stalls.

Fault-injection tests run the production worker against local HTTP only. They
cover ignored fetch aborts, never-ending body reads, synchronous worker loops,
uncaught exceptions, unexpected clean exit, explicit cancellation and shutdown.
They check transport closure, recovery on a later request, no stale cancellation
result, no retries, and budget enforcement across restart. Separate direct-client
tests retain coverage of timeout/cancellation error precedence without relying
on the new parent watchdog. No configured live endpoint is used by these tests.

Status includes the deadline and worker starts/hard timeouts/cancellations/failures
since bridge startup. `providerMs` now includes any worker startup/teardown time;
it is not a pure network measurement. The native binaries and Lua adapter do
not require replacement for this bridge-only change. TSF GUI acceptance remains
outstanding.

Applied at 2026-10-08 00:34:40 local time by restarting the bridge from this
working tree. PID 25028 reported live mode, key configured, worker isolation,
4000ms deadline, fresh status, idle requestState and no lastError. CallsToday
remained 211; no live probe was sent. Eleven protected-file hashes were unchanged,
including provider/key/preferences, installation manifest, Lua/schema/default/skin,
server and both native DLL copies. Text-free receipt:
`runtime/worker-restart-20261008.json`. This is deployment verification, not a
visible-candidate or live-transport acceptance pass.

## Continuation checks

The installed Lua initially matched its installation manifest but not the
working tree: the pending-label fix had not yet been deployed. Existing native
binaries remain unchanged. No live provider probes are part of this follow-up.

A new local HTTP regression reproduced a response-body timeout being reported
as INVALID_PROVIDER_RESPONSE: the vendored client wrapped the aborted JSON
reader before checking its timeout signal. Timeout detection now precedes that
wrapper; malformed completed JSON is still rejected, and explicit input
cancellation still takes precedence. This local vendor change is documented
in `vendor/jev-keyboard/UPSTREAM.md`; the provider is never retried.

Additional regressions verify an active response is cancelled promptly without
a stale result, the next request succeeds, and a stopped bridge retires a
pending librime annotation without changing candidate text. These checks do
not exercise TSF scheduling or prove the visible candidate window updates.

All 18 Node tests, 3 Python unit tests, and three consecutive installed-librime
integration runs passed. PowerShell scripts parsed successfully. The installed
TSF DLL again passed COM creation, but still retained one service reference;
unload and GUI acceptance remain unproven.

The adapter was then deployed using `scripts/Update.ps1`, with backup at
`%LOCALAPPDATA%/RimeJev/backups/update-20261008-002155`. Installed Lua and
installation-manifest hashes were verified against the working tree. The bridge
restarted in live mode with the existing key, fresh heartbeat, idle requestState,
and no lastError. CallsToday stayed at 186 across the update. Hash checks confirmed
the key, provider configuration, preferences, default configuration, skin, server,
and both native DLL copies were unchanged. No live probe was sent.

## Stuck pending follow-up

At inspection the live bridge was healthy with empty IPC queues and no error.
The latest real result was `same_first`, provider time 1151ms, result ready in
1281ms, and a native adapter receipt 50ms later. This was not correlated to
the exact composition the user reported, so it does not disprove that report.

A new regression reproduced a cancelled focus request retaining `[Jev: pending]`
in the actual librime menu. Cancellation now updates the existing mutable
Simple/Phrase annotation, preserves candidate text/order/selection, and can
acknowledge a label-only native refresh without regenerating composition.
Manual navigation displays `paused`; focus cancellation displays `cancelled`.
Complex candidates that do not expose mutable comments retain the shadow
fallback; this is not a universal fix for every candidate type or TSF UI path.

Repeated integration also captured a real bridge exit caused by Windows EPERM
when replacing `bridge.info` while Lua had it open. Atomic file publication
now retries transient local sharing violations with a bounded backoff, keeps
the old destination intact, and does not retry provider calls. Heartbeat file
replacement is limited to once per second; status-only updates need not replace it.

`requestState` reports debounce/provider phase and age, or null when idle, at
the latest status sample. New local HTTP tests demonstrate a hanging provider
times out, retires its active state, and allows the next request without a retry.
The production provider timeout remains 4000ms. Lua tests demonstrate that a
TIMEOUT result retires pending without changing words. All 16 Node tests,
3 Python unit tests, and three consecutive installed-librime integration runs
pass. These are not visible TSF acceptance tests. No live probe was needed for
this follow-up and native binaries are unchanged.

## Latency recheck and adapter update

The user's half-second latency report was reproduced, not dismissed. Three
synthetic live requests through the configured running bridge took 570, 712,
and 854ms and all returned order `2,1,3`. After the bridge/Lua update, three
more took 1455, 617, and 573ms; measured provider times were 1327, 476, and
447ms respectively. The first followed a bridge restart. These small samples
do not establish a speedup, and none tests a visible candidate window.

Bridge poll/cancellation intervals are now 20ms instead of 80ms. The 100ms
debounce uses publication time, and a cancelled snapshot no longer occupies
its full debounce. The native binary's 100ms TSF timer is unchanged.

Identity orders now display `same first`, not `ranked`; promotions display
`ranked #N->1`. Text-free adapter receipts distinguish native, diagnostic-key,
and filter consumption. They prove candidate regeneration, not GUI rendering.
Status records provider/result-ready/adapter-application timings and counters.

The Lua update was deployed with backup at
`%LOCALAPPDATA%/RimeJev/backups/update-20261007-234536`. The bridge restarted
successfully in live mode after correcting its PowerShell-edition launcher.
No key, provider, confidence threshold, dictionary, or native binary changed.
Several older applications still map the stock DLL; Pebrel, Telegram, and Zen
mapped the experimental image at inspection. A disk hash alone is insufficient.

Updated checks: 14 Node tests, 3 Python unit tests, and the installed librime
integration pass, including native receipts and identity-order annotation.
One integration run reported `start service` unexpectedly; a standalone rerun
and four consecutive repetitions passed. This transient is not characterized
as fixed. Real TSF GUI acceptance remains outstanding.

User-authorized direct trial replacement has now been executed. See
`REPLACEMENT.md` for installed hashes and the rollback launcher. The earlier
isolation-first rollout plan was superseded by the user's explicit instruction;
the missing GUI acceptance evidence remains missing, not waived as a test pass.

## Passing locally

- `node --test tests/bridge.test.mjs tests/provider.test.mjs`: 30 tests pass (including nested fault cases).
- `python -m unittest discover -s tests -p "test_*.py"`: 3 tests pass.
- `python tests/native_rime.py`: isolated installed librime integration passes.
- Property-triggered refresh promotes the mock winner without a refresh key.
- Focus loss and manual-selection properties invalidate pending requests.
- Disabling through the preferences file acknowledges the next native refresh
  and changes the pending candidate annotation to `off`.
- Space commits the displayed candidate, not an unseen arriving winner.
- Pagination, persistent toggle, and stopped-service fallback pass.

These tests use a mock provider, not a live Jev endpoint. They do not exercise
the TSF timer, Windows edit-session scheduling, or an application's candidate UI.

## Binary load and replacement preflight

- `python tests/native_tsf_load.py runtime/native-bundle/weaselx64.dll`
  successfully loads the built x64 DLL against the installed runtime and creates
  its COM service without registration. It runs in a disposable Python process.
- Both the experimental DLL and installed stock DLL retain one service reference
  after the caller's Release and return S_FALSE from DllCanUnloadNow. This is
  not an unload/lifetime pass; `--require-unload` explicitly fails that check.
  CandidateList and WeaselTSF hold mutual strong COM pointers in upstream code.
  Activation/deactivation and queued-session lifetime still require testing.
- The actual registered x64 DLL is `C:\Windows\System32\weasel.dll`, not
  the install directory's `weaselx64.dll`. Its original hash matches the latter.
  Replacing only the installation-directory copy would not update TSF clients.
- `scripts/Prepare-NativeReplacement.ps1` backs up both copies, the server,
  adapter, schema, and installation manifest with verified SHA-256 hashes.
  It changes no installed files. The latest executed preflight found the actual
  DLL loaded by running applications and not writable at the current medium
  integrity level. Do not kill those applications or bypass system permissions.

## Matched build retrieved

GitHub Actions run `37628405246` succeeded for adapter revision
`b632d04b2ac60de19292d83ecd44d45bd82fa244`. Its artifact was downloaded to
`runtime/native-build-current`. Its patch matches the current native patch
after CRLF/LF normalization. Both binaries have x64 PE headers.
The current Lua adapter includes an additional external-disable fix; packaging
uses this working-tree adapter and records its exact hash, not the older copy.

`scripts/Package-Native.py` stages these matching inputs and their SHA-256
manifest without installing them. This establishes file identity, not binary
reproducibility or GUI correctness. The earlier `native-build-first` artifact
remains obsolete and must not be used for acceptance testing.

## Remaining release gates

The user-authorized trial is already installed; these are requirements for
release confidence, not a claim that installation has not happened. Do not
make another daily-use native replacement merely to run these tests.

1. Preserve a matched bundle manifest for the exact tested adapter and binaries.
2. Test in an isolated Windows environment with the matching TSF DLL, server,
   Lua adapter, and a mock bridge. The installed-librime test does not substitute
   for an isolated TSF application/session.
3. In an x64 TSF application, type and stop: verify the real candidate window
   updates without injected keys and Space commits the newly displayed winner.
4. Repeat with navigation, mouse selection, focus/document changes, caret moves,
   external disable, service shutdown, and delayed results. No stale winner may
   replace a manual choice or another composition.
5. Check composition cancellation and application exit while an asynchronous
   edit session is queued; verify no crash or retained polling loop.
6. Only after these gates pass, consider a backed-up, reversible production rollout.

## Manual check of the existing trial

Use a newly opened x64 TSF application and non-sensitive synthetic text only.
If automatic requests are enabled, typing uses the configured live endpoint
and counts toward the daily limit; this is not an offline mock test.

1. Select the Jev schema, type `jingli`, then stop without a refresh shortcut.
   Record the initial and final candidate text/annotation, and the elapsed wait.
   `same first` is a valid no-change result, not proof of a promotion failure.
2. Run `scripts/Status.ps1` after the observation. Check heartbeat freshness,
   requestState, decision, and applyChannel; do not equate an idle bridge or a
   native receipt with successful GUI rendering. lastResult may be an older request.
3. Repeat while pressing Down during pending: the highlight and displayed order
   must stay put, and the label should become `paused`. Space must commit the
   displayed selection, not an unseen late winner.
4. Repeat with focus change, Escape, and external disable during pending.
   No stale winner may apply to another composition. If pending remains, record
   application name/architecture, action, elapsed time, and text-free status.

Do not share actual input, provider credentials, or IPC files. The full queued
edit-session and application-exit checks above remain necessary even if this
manual smoke check succeeds.

Stock x86 and IMM clients remain unsupported for automatic refresh. The live
synthetic probes above establish sample latency and returned order only, not
general provider accuracy or real candidate-window replacement.
# Pebrel/Codex context repair (2026-10-08)

The previous turn stopped while investigating TSF surrounding-text changes.
No such native change was deployed. The actual target was Jev reading the
draft in Codex running inside Pebrel, not Codex model/session compaction.
The installed native patch remains unchanged.

The adapter now marks a consented `client_app=pebrel.exe` request with
`contextTarget=pebrel` and sends no commit history in that request. The bridge
uses the supported Pebrel Runtime v1 loopback API to read the current Codex
composer and its caret. It checks the focused window, active tab/pane, local
Codex process, session identity when available, supported grid shape, composer
background/prompt, and hidden/placeholder cells. Only the preceding 80 Unicode
code points are passed to the ranker. The rest of the visible grid is transient
memory, not a provider input or a log. No clipboard, OCR, history-file reading,
global keyboard hooks, or modifications to Codex configuration are involved.

The bridge re-reads the composer before publishing a ranking, including cache
hits. A changed draft, cursor, scope or session invalidates the result. Unknown
layouts, focus loss, SSH, unsupported runtime and timeouts abstain instead of
falling back to potentially stale history. A request older than a newly observed
focus scope is also rejected; the first request after a focus change can therefore
be skipped. Ctrl+F8 suppresses document-context acquisition for that composition.

Verified using only synthetic text and a local mock provider:

- 53 Node tests: context framing/transport, consent, CJK/emoji widths, bounded
  multiline prefixes, placeholder rejection, focus/session changes, provider
  payload, cache scope, cancellation, timeout and pre-publication verification,
  plus the existing bridge/provider suite.
- Seven Python unit tests and isolated librime integration, including the nasal
  profile's 14 local matching cases. Real Lua requests were checked for empty
  terminal history, `context_pending`, and manual-clear suppression.
- In the real, initially empty Codex composer, inserted an unsubmitted 13-code-
  point synthetic draft containing Chinese; verified 13 characters at the end,
  10 after moving left three positions, 9 after deleting before the caret, and
  12 after returning to the end. Removed exactly that draft and verified the
  composer was empty. No Enter or live provider request was sent.
- Real Codex draft -> isolated librime/Lua -> bridge Runtime reader -> mock
  ranker -> Lua property refresh passed. Context length 13, result ready in
  2301ms, provider calls zero. Artifact: `runtime/native-174503e6`.
- After deployment, `node scripts/Check-Context.mjs` verified the current empty
  composer: read 1173ms, read plus verification 2294ms, no provider calls.
- Autostart discovery without inherited Runtime endpoint succeeded in 616ms via
  `ctl describe`, `ctl snapshot`, and supported non-TTY `pane.exec`; no private
  port file is inspected and no Runtime token is persisted in Jev configuration.

Deployment at 11:59 local: configuration/adapter backup
`%LOCALAPPDATA%/RimeJev/backups/context-20261008-115919`, normal update backup
`%LOCALAPPDATA%/RimeJev/backups/update-20261008-115921`. Lua was deployed and the
bridge restarted, reporting `contextProvider=pebrel-codex`. Nine protected files
(credentials/preferences, personal configuration, native modules and Codex
configuration) retained their hashes. Existing service/model/debounce unchanged.

Remaining limitations: this is not universal application text extraction, nor a
visible TSF candidate-window acceptance test. Real IME preedit overlays and
end-to-end live-provider GUI behavior still need user typing verification. Only
the supported visible Codex composer layout is recognized; long scrolled drafts,
other themes/versions, attachment placeholders and hard/soft-wrap reconstruction
are not universally supported. The Runtime serializes a full bounded visible grid;
local reads measured approximately 0.9-1.0s and the safety re-read adds another
similar interval. This fixes the source of context but is NOT a low-latency
solution. Requests already sent before a later invalidation may still be billed.
A native bounded composer API in Pebrel is the appropriate next optimization.
