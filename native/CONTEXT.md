# Opt-in TSF surrounding context

This is an experimental x64 Weasel TSF integration, not a universal screen
reader. No terminal screen scraping, history-file reading, clipboard capture,
key logging, application injection, or game-memory inspection is used.

## Contract

- Only an explicitly opted-in executable and the existing two enabled Jev
  preferences allow document reads. `jev_windows/context_apps` defaults to an
  empty list. F8 disables automatic requests; Ctrl+F8 suppresses surrounding
  text for the current composition. Neither tool installs native binaries.
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
simulate Windows' whole TSF manager or certify a real application.

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

## Rollback

Development takes place in an isolated worktree; no deployed files or registry
entries are changed. The feature and its tests ship in one reviewable feature
branch against the preceding commit. After merge, `git revert <merge-or-squash
commit>` restores source behavior without rewriting history. An unmerged PR
can simply be closed; the original working tree is untouched.

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
