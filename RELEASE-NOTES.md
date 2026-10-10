# v0.1.0-windows.2 - Portable Windows installation preview

Download a Windows ZIP from this release, extract the whole archive, and run
`Install.cmd`. See the Chinese quick start at the top of `README.md`.
The repository is private: sign in to a GitHub account with repository access.

This supersedes `v0.1.0-windows.1`: Windows runner validation exposed inconsistent
8.3 path aliases (`RUNNER~1` versus `runneradmin`) in containment checks and
bridge process identification. Existing path parents now expand to their long
names before comparison, including new child paths. Exact process and linked
path guards remain enforced. The earlier tag/assets are retained, not replaced.
An exhausted sharing-violation retry on diagnostic `status.json` no longer stops
the bridge: the next heartbeat retries the status write. Request/ledger writes
remain strict, and no provider retry is added. `statusWriteFailures` counts
these transient diagnostic failures; non-sharing errors still stop the bridge.

## Choose an asset

- `windows-standard.zip`: recommended. Does not replace Weasel binaries.
- `windows-native-x64.zip`: experimental stop-typing refresh for the exact
  tested x64 Weasel 0.17.4 / librime 1.13.1 build. Run `Install-Native.cmd`,
  explicitly confirm, and approve UAC. No x86/IMM or ARM64 native refresh.
- Each ZIP has a `.sha256` file and an internal per-file integrity manifest.
  These hashes detect corruption; they are not a publisher signature.
- GitHub's automatically generated source archives are for development,
  not the recommended end-user download.

## Installation and migration

- Requires Windows 10/11 and an existing working Weasel/Rime installation.
  x64 is tested; ARM64 standard dependency selection is implemented but untested.
  32-bit Windows is not supported. Run as your ordinary Windows account.
- Git, Python and build tools are not needed on the destination computer.
- Missing Node 22.23.3 and pinned Rime Ice are downloaded over HTTPS and checked
  against SHA-256 locks. This is an online installer, not an offline bundle.
- Existing dictionaries, skin and personal settings are retained. Conflicting
  dependency files or locally modified managed files stop installation rather
  than being overwritten. Compilation needs additional disk space and time.
- The application lives under `%LOCALAPPDATA%\RimeJev\app`; Start menu shortcuts
  and login startup do not depend on the extracted download directory.
- Repeat installation verifies/updates the standard adapter, keeping original
  uninstall backups. Roll back an active native install before any update,
  reinstall or uninstall so its original rollback chain stays intact.
- Configuration, API keys, learned dictionaries, fuzzy profiles and application
  consent lists are not exported. Enter the destination's key locally; DPAPI
  keys cannot be transferred to another Windows account/computer.
- Automatic requests and preceding-text access are off by default. Basic local
  Rime typing works without a key. Standard Weasel cannot refresh candidates
  while typing is paused; the optional native package remains experimental.

## Cleanup and verification

- An existing cleanup audit reclaimed 9.60 GiB from 94 repeated test dictionary
  builds. Further cleanup reclaimed 228.54 MiB of disposable migration/browser caches,
  never the installed IME, personal data, rollback backups or source worktrees.
- Future native tests remove generated dictionary indices by default; opt in
  to `--keep-build` only for debugging. Failed dependency installs clean staging.
- 75 local Node tests and 32 Python tests pass, covering Windows PowerShell 5.1,
  cleanup and reproducible packages. Isolated real-librime smoke also verifies
  downloaded dependencies. Checks cover install, update, uninstall and execution
  after deleting the download folder.
- Tests explicitly exercise Windows short-path aliases for clean installs,
  repeat installs, bridge startup/shutdown, uninstall and cache cleanup.
- Native binaries are from successful CI run
  https://github.com/johntime2005/rime-jev/actions/runs/37888288576
  at `aaf1cae50754253b47cf56fc3dc1b2a42559dc81`. The native patch/headers match
  this release; Lua and bridge sources are staged from the release commit.
  Upstream Weasel revision: `9cc96e20dc71b80876b12f689bb5863c76c2a7ed`.
- No production provider calls, live IME replacement or broad cross-computer GUI
  acceptance is performed for packaging. See `native/VALIDATION.md` for native
  limitations. Installation success does not certify ranking quality or latency.

Use `Status.cmd` for diagnostics, `Configure.cmd` to set the destination service,
`Rollback-Native.cmd` for a managed native rollback, and `Uninstall.cmd` to restore
the original managed Rime configuration. Backups, encrypted keys and shared
Rime Ice dependencies are deliberately retained on uninstall.
