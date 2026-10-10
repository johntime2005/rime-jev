# Opt-in TSF surrounding context

This is an experimental x64 Weasel TSF integration, not a universal screen
reader. No terminal screen scraping, history-file reading, clipboard capture,
key logging, application injection, or game-memory inspection is used.

## Contract

- Only an explicitly opted-in executable and the existing two enabled Jev
  preferences allow document reads. `jev_windows/context_apps` defaults to an
  empty list. F8 disables automatic requests; Ctrl+F8 suppresses surrounding
  text for the current composition, including subsequent modifier keys, focus
  cleanup and preference changes. Commit or cancellation of the composition
  releases that suppression. Neither tool installs native binaries.
- In a TSF edit session, read **before the composition's start**, not the
  preedit caret. Exclude the whole composition and any replacement selection.
- Preserve actual whitespace and line breaks. Read at most 161 UTF-16 units
  and send at most 80 Unicode scalar values. This is NOT a grapheme-cluster
  promise: a boundary may split a combining/ZWJ sequence. Do not normalize.
- `exact` means 80 scalar values or a confirmed document start, as represented
  by the application's text store. Partial regions, malformed UTF-16, embedded
  objects, failed locks, transient contexts and read-only contexts abstain.
  Transient contexts are rejected by conservative policy, not because the TSF
  flag itself proves surrounding text is absent.
- Known password/private/PIN scopes are excluded. Application allowlisting
  and TSF disabled/empty-context checks are additional gates, NOT universal DLP.
  A malicious or incorrect text store cannot be verified by these APIs.
  Scope metadata is checked even when text consent is off; this does not call
  GetText. An app whose scope metadata lookup fails does not supply context.
- Missing context uses ordinary context-free ranking. Sensitive contexts do
  not submit. Commit history is no longer treated as surrounding text.

Opt in only after testing the application's actual editable control, via the
usual Rime custom patch and deployment:

```yaml
patch:
  jev_windows/context_apps:
    - your-tested-editor.exe
```

Also enable automatic requests and context in Jev preferences. There are no
pre-approved applications. A terminal's TSF store may expose only composition,
not its TUI editor buffer; do not add a terminal merely because Chinese input
works. Games and remote terminals are unsupported unless their document
interface is explicitly integrated and verified. UIA/IMM fallback and TUI
editor-buffer plugins are intentionally not silently substituted.

Local follow-up: the user explicitly enabled `zen.exe` on 2026-10-09 after a
browser-context report. Specific URL-bar capture/commit and boundary checks
are recorded in `ZEN.md`. This does not add a pre-approved app to the generic
schema, certify every Zen control, or limit executable-wide consent to the
URL bar. The separate Pebrel adapter is unchanged.

## Data flow and consistency

1. The native frontend negotiates the context IPC capability. Old servers
   retain ordinary key input. On a new editing key, the matching server puts
   Lua into `pending` before Rime generates candidates. Commit keys and key
   release preserve the displayed choice.
2. The existing TSF timer obtains the document lock. Lua supplies consent;
   the TSF frontend captures a short prefix, excluding the composition.
3. A bounded, strictly validated `JCTX1|stamp|quality|UTF16-hex` message carries
   the snapshot through ordinary serialized Weasel IPC. Hex is framing, NOT
   encryption. No document text is written to diagnostic logs.
4. Lua cancels old requests on stamp changes and includes `document` in its
   bridge request. The bridge returns `JEVWIN2` with the same stamp. Exact
   document-bound responses are consumed only by the native refresh path.
   A manually frozen candidate menu is not regenerated on a changed stamp;
   cancellation must not undo its order, selection or displayed Space commit.
5. Before every native refresh, the prefix is reread in the same TSF lock
   used to apply candidates. Focus/context-stack/external edit notifications
   invalidate the stamp, including same-caret edits. Changed text or quality
   gets a new stamp before Lua can consume a result. No network operation
   occurs while the TSF lock is held.

The context stamp is an opaque local freshness marker, not a global document
revision or security credential. The trust boundary is the current user's
Weasel server/TSF/Lua stack. The server receives per-client packets before
copying to shared IPC buffers under its mutex; it must not mix headers and
text bodies from concurrent clients.

The native property may contain up to 80 scalar values until invalidated;
the bridge's existing private request files expire after about 15 seconds.
Requests sent before a later edit/cancellation cannot be recalled from the
configured provider. Consent and app selection occur before capture/send.

## Verification and release gates

Run in an x64 VS developer environment:

```powershell
./scripts/Test-NativeContext.ps1
node --test tests/bridge.test.mjs tests/provider.test.mjs tests/context.test.mjs
python tests/native_rime.py
python tests/native_rime.py --context
```

The C++ tests call the production reader against controlled COM interfaces.
They verify lock failure, region boundaries, composition/selection anchors,
real whitespace, Unicode bounds and same-caret text changes. They do NOT
certify a real application. A separate `native_tsf_manager` test runs the real
Windows TSF manager against an app-owned synthetic `ITextStoreACP`, checks
actual edit locks/ranges, text/selection notifications and input scopes, and
uses `TF_TMAE_NOACTIVATETIP` to avoid activating the installed input method.
The production async-session wrapper is also exercised against a controlled
COM queue and the real TSF manager. The pending slot is owned until final
`Release`, not merely until `DoEditSession`: Windows may discard an ungranted
session without calling it. Context removal, lock denial, stale callbacks and
subsequent fresh-context recovery must all leave the slot usable. Deactivation
invalidates queued work and stops the timer before starting service teardown.

The librime tests use isolated data and a mock provider. They exercise real
Lua consent, snapshot framing, request/response binding, stale rejection,
native-only consumption and committing the displayed candidate. Setting
properties in a harness is NOT live TSF candidate-window acceptance.

Before enabling any app, compare returned prefixes to its actual logical
buffer/selection through paste, undo/redo, mouse selection, reconversion,
long/offscreen text, soft wrapping, preedit, focus ABA, resize and rapid edits.
Measure capture and key-path P50/P95; a bounded range is not a latency proof.
Do not claim terminal/game compatibility, zero missed edits, or universal
password detection from unit tests. Windows CI builds the complete DLL/server;
production GUI/latency acceptance remains a separate gate.

The first compiled DLL also passed unregistered COM load/create/release in a
disposable process, but retained a service reference (`DllCanUnloadNow=S_FALSE`).
This pre-existing lifetime issue is not a successful unload test. Native trial
rollback still requires terminating/restarting the host application; this PR
does not certify hot DLL unloading.

### Local continuation checks (2026-10-08)

Two additional isolated-librime regressions failed against `c19d25a` and pass
with the current Lua changes:

- Hovering the first candidate after promotion, then changing the document
  stamp, rebuilt the menu in its original order. The context-dirty handler now
  honors the manual-selection pause. The test checks every candidate's text,
  the selection index, no new request or refresh acknowledgment, and the exact
  displayed word committed with Space. It uses the preexisting server property
  protocol, not simulated mouse or keyboard input into another application.
- A modifier key after Ctrl+F8 cleared composition-scoped context suppression
  and granted consent again. Modifiers no longer count as editing actions;
  generic cleanup preserves suppression until the composition ends. Tests
  cover native pending invalidation, modifier release, more pinyin, focus and
  preference changes, empty outgoing context, and consent in a new composition.

The 14 Node tests, three native C++ executables, and both isolated-librime
modes pass locally. These are mock/local tests, with no live provider calls.
This continuation does not install files, merge/push the feature branch, or
certify a new full DLL/server build. Existing CI artifacts predate the Lua
changes and are not a matched delivery bundle.

The separate trial receipt in `../tsf-local-trial/outcome.json` (relative to
the feature worktree root) records a cancelled UAC prompt and no native or
adapter replacement at 13:44. A later `switch-result.json` in the matching
backup records a successful replacement at 15:26; the earlier outcome file
was not updated. The 2026-10-09 installed hashes match that later trial bundle,
including its test-executable-only Lua and stopped mock runtime override.
The older outcome file must not be used to infer current installation state.
Neither receipt is a GUI acceptance result. The trial host and mock-bridge
PIDs were no longer running at continuation inspection.
Real target-application, visible candidate-window and key-path latency gates
remain open.

### Async cancellation continuation (2026-10-09)

The pending edit-session flag was cleared only on callback entry or immediate
request failure. A successful queued request discarded on context removal
never executes that callback, leaving later polling permanently disabled.
The Microsoft `ITfEditSession` contract explicitly requires cleanup on session
destruction for this path.

Added `native/include/JevEditSession.h`, used by the patched Weasel frontend.
It retains the service/context until TSF releases the session, and clears the
service-owned flag before releasing those references. The flag also remains
set while a callback runs, preventing reentrant polling from opening another
slot. Input/focus generation checks remain unchanged. Weasel deactivation now
invalidates the generation and stops candidate polling before other cleanup;
this does not claim to resolve upstream COM ownership or hot-unload issues.

Verification on the local Windows machine:

- Four native C++ executables compile and pass: scalar/protocol, controlled
  text reader, controlled async-session lifetime, and the real TSF manager.
- The real manager discards a queued request on `Pop` with zero callbacks;
  the slot clears and a new context can queue and run successfully. A request
  against the disconnected context also releases its slot. Stale callbacks
  and manager shutdown release references without applying old work. This
  app-owned TSF client may receive a callback during manager deactivation;
  it is not equivalent to testing registered-TIP deactivation.
- Restoring the old callback-only cleanup in an isolated negative-control
  header reproduces the stuck flag in that same real-manager test. The fixed
  integration passes five consecutive executions. The negative control is
  retained under `runtime/context-tests/legacy-callback-cleanup`; it is not a
  different installed DLL or a measurement of a reported user's composition.
- Controlled COM tests cover rejected locks, callback failure, final versus
  nonfinal `Release`, retained generation and owner/context lifetime. They use
  the production wrapper rather than a separately implemented state machine.
- All 14 Node tests and both isolated-librime modes pass, including the earlier
  manual-selection and composition-scoped context-suppression regressions.

Before the subsequent user-authorized commit/deployment, these checks made
no provider calls, installed-file replacement, registry edits, Git commit,
push or merge. The main worktree's files and six installed native/adapter/profile
hashes were unchanged during testing. These checks do not rebuild
the complete DLL/server or certify visible candidate-window behavior. The
previous CI artifacts still predate the pending changes; a new matched build
and isolated target-application GUI/latency acceptance remain required.

## Rollback

The original feature development and tests used an isolated worktree. Source
tests do not deploy files or change registry entries. The user later requested
integration and local deployment; current installation state is recorded in
`REPLACEMENT.md`, not inferred from those earlier isolated-test receipts.
For a merge commit, `git revert -m 1 <merge-commit>` restores the main branch's
preceding behavior without rewriting history. For a squash commit, omit `-m 1`.
`python scripts/Test-ContextRollback.py --base <merge-first-parent>` verifies
that reversal in a disposable clone, retaining unrelated main-branch work.

For a native trial, **before replacing anything**, stop the trial host/server,
back up the matched server, TSF DLL, Lua, schema, bridge sources and configuration
with hashes. Use an isolated Windows test user/VM. Never mix old/new components
as an acceptance test. Restore that matched backup, restart applications to
unload the in-process DLL, and redeploy the restored schema to roll back.

Immediate feature rollback: disable Jev context and clear the app allowlist.
This stops subsequent document reads without uninstalling Rime or touching
personal dictionaries. Turning context off cannot recall prior provider calls.

## Interface references

- https://learn.microsoft.com/en-us/windows/win32/api/msctf/nf-msctf-itfrange-gettext
- https://learn.microsoft.com/en-us/windows/win32/api/msctf/nf-msctf-itfrange-shiftstart
- https://learn.microsoft.com/en-us/windows/win32/api/msctf/nf-msctf-itftexteditsink-onendedit
- https://learn.microsoft.com/en-us/windows/win32/api/msctf/nf-msctf-itfcontext-inwritesession
- https://learn.microsoft.com/en-us/windows/win32/api/inputscope/nn-inputscope-itfinputscope
- https://learn.microsoft.com/en-us/windows/win32/api/msctf/nn-msctf-itfeditsession
- https://learn.microsoft.com/en-us/windows/win32/api/msctf/nf-msctf-itfcontext-requesteditsession
