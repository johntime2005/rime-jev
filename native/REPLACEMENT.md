# Native replacement handoff

## Current continuation state (2026-10-09)

Native replacement succeeded at 17:07 local after commit `9d7d526` fixed
BOM-less UTF-8 receipt reads and PowerShell 7 module-path inheritance in the
Windows PowerShell elevation helper. The successful `switch-result.json` is
in `%LOCALAPPDATA%/RimeJev/backups/native-20261009-155707-5d2738f6`.
The earlier `continuation-outcome.json` in that directory records the earlier
cancelled attempt only; it must not be used as current installation state.

The server SHA-256 is
`582BB77912D72B5A10AEB175DCEBC6EB4575591530D3BCB61BF6AA5782518241`.
Registered/distribution x64 DLL SHA-256 is
`C6453073BB13AE4D48DFF95880751A3D5FC04E2A9B3911244795CAF13EE2AAB4`.
The server ran as PID 8852 and ordinary live bridge as PID 15648 after the
switch. These IDs are observations, not permanent service identifiers.
Registered DLL COM load/create/release and isolated context/nasal regressions
passed; one COM reference is still retained and hot unloading is not certified.
No user application was terminated. Existing applications may retain old DLLs.

At 17:40 local, Lua commit `bbadb1a` was deployed to avoid acknowledging an
unchanged pending menu after context capture. Such acknowledgment routes through
the full preedit write path and can provoke another document invalidation.
Backup: `%LOCALAPPDATA%/RimeJev/backups/update-20261009-174049`.
Installed files now match `runtime/native-bundle-20261009-bbadb1a`, which records
the same native CI binaries and the updated Lua. The original `9367fda` bundle
is retained unmodified as historical evidence, not called the latest adapter.

`deployment-outcome-20261009.json` beside the native receipt records five
installed bundle-file checks, the updated installation manifest, removal of
trial/mock gates and eight unchanged protected inputs: provider config, key,
preferences, schema list, skin, nasal profile, original prism and `rime.dll`.
The usage ledger legitimately advanced with user typing and two explicit
synthetic probes; it was not overwritten or rolled back. The backend observed
three native apply acknowledgments after the Lua fix, but this is not broad
GUI acceptance.

The user's browser screenshot still shows an incorrect rank-1 choice for
the company-manager sentence. TSF context apps remain an empty list. A
two-call synthetic comparison using the screenshot's seven candidates returned
rank 1 without context (0.60) and rank 5 with the supplied seven-character
prefix (1.00). This confirms that sample's context gap, not verified browser
text capture. Do not silently allowlist all browsers or label the current
installation as passing semantic/target-application acceptance.

For native rollback after the Lua follow-up, the original native switch's
hash guard deliberately rejects the newer Lua. First restore the backed-up
Lua/schema from the matching adapter update (only if current hashes still match
the recorded deployment), update the installation manifest and deploy; then
the original native rollback receipt can restore its matched files. Do not
bypass hash checks or overwrite a user's later edits. F8 immediately disables
automatic requests while retaining ordinary Rime typing.

## Earlier cancelled attempt (2026-10-09)

Source integration is committed as `9367fda`. The new native DLL/server were
downloaded from successful CI run `37888288576` at `aaf1cae`; the patch and all
three native headers match the integrated source. A verified 22-file bundle
is staged at `runtime/native-bundle-20261009-9367fda`. The full combined adapter
passes local regressions, not visible candidate-window acceptance.

The 2026-10-09 replacement attempt did **not** install that bundle: Windows
reported the UAC prompt cancelled before the elevated helper started. No
`switch-result.json` was produced. The existing server remained PID 21668;
the ordinary bridge restarted from the committed source as PID 2852 and
reported a fresh live heartbeat, no errors and zero calls today at inspection.
No live probe was sent. PIDs and counters are observations, not persistent IDs.

Backup receipt:
`%LOCALAPPDATA%/RimeJev/backups/native-20261009-155707-5d2738f6/replacement.json`.
The adjacent `continuation-outcome.json` records the cancelled attempt and
post-attempt verification. All six installed-file/manifest hashes and nine
protected-file hashes remain equal to their backups. Protected files include
provider config, encrypted key, preferences, usage ledger, default schema list,
skin, personal nasal profile, original Rime prism and `rime.dll`. Bridge sources
are also backed up. No user application was terminated and no registry or ACL
change was made for this attempt.

**The installed Lua/schema still contain the 2026-10-08 trial-only gate and
stopped mock IPC path.** Therefore normal-application Jev request recovery is
not yet deployed. The native/adapter files still match the later successful
2026-10-08 15:26 trial replacement, not the earlier cancelled UAC receipt.
Another native replacement requires fresh administrator confirmation; do not
silently bypass it or describe the prepared bundle as installed.

To resume, recheck the receipt's hashes and run `Invoke-NativeSwitch.ps1` with
that `replacement.json`, stopping/restarting only the ordinary bridge around
the transaction. If any installed file has changed, the script refuses and a
new backup/inspection is required. Reopen target applications after a successful
switch; already-running applications can retain the old DLL.

Source rollback was verified in `runtime/rollback-check-aa80d661`:
`python scripts/Test-ContextRollback.py --base d343589` restores the merge's
first-parent tree exactly, preserving main-branch worker/typing improvements.
This is source rollback only, not execution of a native installation rollback.

## Earlier installation records

Status: trial installed on 2026-10-07 at the user's explicit request to replace
directly with rollback available. GUI acceptance remains incomplete; this is
not yet a fully tested production release.

Follow-up at 2026-10-08 11:59 local: added consented Pebrel/Codex composer
context through the local Runtime API, not a native TSF replacement. Lua is
updated/deployed and the bridge reports `contextProvider=pebrel-codex`. Backup:
`%LOCALAPPDATA%/RimeJev/backups/context-20261008-115919`; ordinary adapter backup:
`%LOCALAPPDATA%/RimeJev/backups/update-20261008-115921`. Native modules, credentials,
preferences, skin, personal fuzzy profile and Codex config retain their hashes.
The real synthetic draft and isolated Lua/mock bridge chain passed; visible
TSF/live-provider acceptance remains outstanding. Runtime grid reads add about
two seconds for capture plus safety verification; see `VALIDATION.md`.

Daytime follow-up on 2026-10-08: Lua/schema updated with text-free cancellation
and context diagnostics, independent Jev spelling prism and explicit optional
custom-patch loading. Bridge adds local worker warm-up and short exact-result
cache; debounce trial is 40ms (may increase intermediate API attempts).
Backup: `%LOCALAPPDATA%/RimeJev/backups/update-20261008-103925`; config backup:
`%LOCALAPPDATA%/RimeJev/backups/latency-20261008-103923`. Provider/key/preferences,
ordinary Rime vocabulary and native binaries unchanged. No fuzzy pairs enabled
in the daily-use configuration. Mixed live/cache timings and queueing outliers
are recorded in `VALIDATION.md`, not represented as a GUI latency pass.

Follow-up at 2026-10-08 00:34 local: bridge-only worker isolation is now applied
via restart (PID 25028 at verification), with a 4000ms parent deadline. Existing
provider/key and all eleven protected installation files were unchanged;
CallsToday remained 211 and no live probe was sent. Lua/native files were not
replaced. See `VALIDATION.md` for the stuck-request evidence and local fault tests.

Follow-up on 2026-10-08: the pending-label and bounded local-file-retry changes
were tested and deployed. The new adapter backup is
`%LOCALAPPDATA%/RimeJev/backups/update-20261008-002155`; the installed Lua and
installation manifest match the working tree. The bridge was restarted with
the existing provider/key; no live probe was sent. Native DLL/server, skin,
preferences and provider/key hashes were verified unchanged. See `VALIDATION.md`
for the response-body timeout fix, regression results, and outstanding GUI checks.

Follow-up on 2026-10-07: Lua was updated/deployed from this working tree with
backup `%LOCALAPPDATA%/RimeJev/backups/update-20261007-234536`; the installation
manifest records its new hash. Native binaries below are unchanged. The
bridge is now live with the user's existing provider and key; six synthetic
latency probes were performed. The offline/no-key observation below describes
the original trial replacement only. See `VALIDATION.md` for the recheck.

## Executed trial replacement

- Elevated file replacement completed using `scripts/Invoke-NativeSwitch.ps1`
  and `scripts/Switch-Native.ps1`; the ordinary-user server restarted (PID 36664
  at verification) and schema deployment succeeded.
- Registered and distribution x64 DLL hashes now both equal
  `4002B34A156049D3236FED3AE905C788E493515D20B14302F6D96351E0327753`.
- Server hash equals
  `3DFADE6D76CE46476D1C9AAE09BECE9D0AEC77B817C13C92E918E4A4FAECD788`.
- Backup receipt: `%LOCALAPPDATA%\RimeJev\backups\native-20261007-215625-12caf211\replacement.json`.
- Rollback launcher: `runtime/Rollback-Native.cmd` (requests administrator
  authorization, restores verified original binaries and adapter, redeploys).
- Loaded original DLLs were renamed in the same directory, not deleted; no
  user applications were terminated. Reopen applications to load the new DLL.
- Installed DLL load test and isolated librime regression passed. GUI timing
  and rollback execution are not yet tested. Bridge is offline, with no key
  configured; the trial has not sent any input to a live provider.

## Pre-replacement observations

- Installed server: `D:\rime\weasel-0.17.4\WeaselServer.exe`.
- Registered x64 TSF module: `C:\Windows\System32\weasel.dll`.
- Distribution copy of that module: `D:\rime\weasel-0.17.4\weaselx64.dll`.
- Both original module copies have SHA-256
  `D1986BDAE7A4807012B9DA84CF8CF1459F1B19474BC52A989FC689BC6219F370`.
- Current shell is medium integrity, not elevated. The registered module is
  loaded in applications and cannot be opened for writing by this shell.
- No Windows Sandbox executable or usable Hyper-V VM inventory was found in
  the current environment. A separate Python process isolates DLL load tests,
  but TSF activation may connect to the daily-use server; it is not a substitute
  for an isolated Windows user/session or VM with its own test configuration.

## Before a replacement

1. Complete the real TSF UI and cancellation tests in `VALIDATION.md` using
   a mock bridge, without sending real typing to a provider.
2. Resolve or characterize service/candidate ownership and thread-focus sink
   teardown. The DLL-load test currently reports a retained reference for both
   stock and patched binaries; loading is not an exit-safety acceptance test.
3. Stage a fresh matched bundle and verify it. Existing bundles intentionally
   do not update themselves when documentation or source changes.
4. Run `scripts/Prepare-NativeReplacement.ps1` again immediately before the
   change. Retain the resulting `replacement.json` and every backed-up file.
5. Obtain an elevated maintenance session. Ask the user to save work and close
   applications using the old TSF DLL. Do not forcibly terminate their apps,
   change system ACLs, or use a per-user COM override to bypass permissions.

## Required installation transaction

The scripts implement the file switch and rollback. The GUI checks below remain
acceptance requirements rather than claims of completed verification.

- Validate the registered path again in the native 64-bit registry view.
- Check bundle hashes and all backup hashes before stopping the server.
- Confirm no target changed since preflight; check all target write access.
- Stop only the identified Weasel server, using its supported shutdown command.
- Replace the server, distribution x64 DLL, registered x64 DLL, and matching Lua
  and schema. Preserve dictionaries, skin, user preferences and credentials.
- Update the adapter installation manifest while preserving its original
  uninstall backups. Record old and new hashes in a native transaction receipt.
- Deploy the schema; restart the server as the ordinary logged-in user, not as
  an elevated service. Verify its executable path and the on-disk hashes.
- Open a fresh x64 application, confirm it loads the new registered DLL, and
  repeat the visible-candidate/Space-commit test. Existing processes can retain
  old modules; do not certify installation from disk hashes alone.
- If any step fails, restore every changed target from the verified transaction
  backup and restart the original server. If restoration is blocked, leave an
  explicit recovery receipt and ask for maintenance assistance; never report
  a partial installation as success.

The initial native build only supports automatic refresh in x64 TSF clients.
Stock x86 and IMM components must retain ordinary typing behavior, but they do
not gain automatic Jev refresh. This limitation must be explicit at delivery.
