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

Build with `scripts/Build-Weasel.ps1` in a VS 2022 developer environment with
ATL, MSBuild, Python and 7-Zip, or dispatch the GitHub Actions workflow.
Only x64 TSF and server are built initially. Stock x86/IMM clients do not gain
automatic refresh from this patch and must not be described as supported.

Do not replace a running input method DLL until isolated native and TSF GUI
tests pass. Application restart is necessary to load a changed in-process DLL.
No installation of these experimental binaries is performed by the build.
