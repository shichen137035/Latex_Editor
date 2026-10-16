# Windows NSIS installer and initial setup

Run `NSIS-build.bat` from the repository, or use `npm run desktop:package:nsis`.
Node.js 22+ is required. The batch entry installs locked dependencies if they are missing.
It rebuilds current source, creates an isolated unpacked application, verifies actual
startup and resource reads, then creates the assisted x64 NSIS installer. The script
returns nonzero on failure. Optional arguments are forwarded, for example:

```bat
NSIS-build.bat 0.6.7-nsis-review
```

Outputs are written to a new `release/<version>-nsis/` directory, or a timestamped
directory if that name already exists. `release/latest-nsis.json` records the latest
successful installer and SHA-256; portable builds retain their own `latest.json`.
The installer is named `TeXWeave-<version>-x64-setup.exe`.
`npm run desktop:dist:nsis` runs the complete release verification suite first.
Use `npm run desktop:verify:package -- <output-directory> --nsis` to recheck a package.

The installer supports per-user installation, an optional system-wide installation,
installation directory selection, shortcuts, and launching the app on completion.
On a packaged app's first launch, the setup dialog provides:

1. Spelling dictionary selection. Bundled English dictionaries are already installed;
   additional selected dictionaries are downloaded through the existing dictionary manager.
   Chinese and Japanese entries are basic rule packages, not full Hunspell dictionaries.
2. Automatically detected LaTeX tool status, re-detection and manual location selection.
   The existing TinyTeX installer can install/repair tools in a dedicated user directory,
   with progress, cancellation and download verification.

Downloads run as the application user after the installer launches the app. They need
an internet connection. Existing external LaTeX distributions are preserved. An offline
user can continue with bundled dictionaries and finish without installing LaTeX.
Failed language downloads remain selected for retry; successful downloads are retained.
“Remind me next time” leaves setup pending. “Finish setup” persists completion in
`%APPDATA%/TeXWeave/config/installation.json`, so upgrades do not repeat it.
Run `TeXWeave.exe --setup` to reopen it, including in a development launch.

When an existing installation is detected, the installer shows an update option before
replacing program files. Updates preserve user data, including settings, dictionaries,
styles, references, AI history and first-run setup state. Silent updates also preserve it.

The uninstaller offers two modes for the current Windows user:

- **Keep settings (default):** removes application files and shortcuts while preserving
  all user data and tools for a later reinstall.
- **Completely uninstall:** additionally removes known TeXWeave settings, dictionaries,
  copied styles, reference library, AI history, caches and the cached installer. Verified
  TinyTeX, Codex and Copilot tools in the default profile tools folder are removed.

Project files, tools in custom/external locations, unknown profile files and other users'
profiles are preserved. Registered projects placed inside a known data directory protect
that directory from removal. Cleanup refuses corrupt project registries and data-root
junctions, and does not follow directory junctions into external files. Unknown/unmarked
tool folders remain in place. The profile root is removed only if empty.

Unattended uninstall preserves data by default. Explicit `/PURGE` requests the same
scoped complete cleanup; `--updated` always overrides it and preserves data. Cleanup
errors stop removal of application files so it can be retried. These options are in the
new uninstaller shipped with this installer; install this build before using them.
Keep projects outside the application installation directory: standard NSIS replacement and removal owns that program directory. The data cleanup protects registered projects inside userData, but does not change this installation-directory rule.
The setup wizard also works for fresh portable profiles. Changing packaging format alone
is not treated as a fix for missing built-in styles: package verification explicitly lists
and reads `default`, `light` and `empty` through the running application's resource API.
