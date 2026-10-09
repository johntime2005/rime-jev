# Experimental Weasel async candidate refresh

This directory contains a GPL-3.0 patch against Weasel 0.17.4, commit
`9cc96e20dc71b80876b12f689bb5863c76c2a7ed` from https://github.com/rime/weasel.
The original GPL license is included. Modified Weasel binaries remain GPL;
the independent MIT bridge does not relicense Weasel.

The patch modifies both WeaselServer and the in-process TSF DLL. The stock
server alone cannot update the TSF candidate window. A TSF-apartment timer
requests an asynchronous edit session, then uses a dedicated IPC message.
The server serializes this request with ordinary keyboard IPC; a Lua property
notifier validates the snapshot and consumes the result. TSF receives the
updated response while holding its document lock and refreshes the real UI.
It does not inject refresh keys, start a second candidate window, or run Lua
on a new thread. Existing upstream key simulation unrelated to Jev is unmodified.

Checks include active server session, TSF context identity, foreground process,
input-event generation, first-page selection, Lua input/caret/snapshot/expiry,
and explicit enable preference. FocusOut clears pending text and history.
Password/disabled TSF contexts are excluded; this is not universal DLP.

The separate `context-pebrel.mjs` bridge adapter can read a verified Codex
composer via Pebrel's local Runtime API when explicitly configured. It does
not use a new TSF surrounding-text patch or require replacing these binaries.
Its visible-grid/read latency and privacy boundaries are documented in the
root README and `VALIDATION.md`; other applications still use commit history.

Build with `scripts/Build-Weasel.ps1` in a VS 2022 developer environment with
ATL, MSBuild, Python and 7-Zip, or dispatch the GitHub Actions workflow.
Only x64 TSF and server are built initially. Stock x86/IMM clients do not gain
automatic refresh from this patch and must not be described as supported.

The local machine has a user-authorized trial replacement; see `REPLACEMENT.md`.
Do not treat that trial as release acceptance or make another native replacement
just to test it. Isolated native and TSF GUI tests remain release gates.
Application restart is necessary to load a changed in-process DLL. No
installation of these experimental binaries is performed by the build.

See `VALIDATION.md` for passing checks, the matched build provenance, and
the remaining native release gates.

## Matched experimental bundle

Download the `weasel-jev-x64-experimental` artifact from a successful matching
build, then stage it with the current adapter (no installation occurs):

```powershell
python scripts/Package-Native.py --artifact runtime/native-build-current --output runtime/native-bundle --source-label github-run-37628405246
python scripts/Package-Native.py --verify runtime/native-bundle
python -m unittest discover -s tests -p "test_*.py"
```

The packager rejects a different patch, missing inputs, non-x64 binaries, and
an existing destination. `manifest.json` records exact SHA-256 hashes of the
binaries and companion sources. Verification detects changed files; it does
not authenticate the caller-supplied source label or certify TSF behavior.
CI also publishes `weasel-jev-x64-bundle` with a manifest. The bundle is not a
standalone installer: it still requires the matching Weasel runtime and Rime
data. Do not copy it over a daily-use installation to perform GUI tests.
