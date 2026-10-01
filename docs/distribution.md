# Windows distribution

The Windows release command builds the production renderer and Electron main
process, creates both the NSIS installer and portable executable, then validates
that the artifacts match the current root version and include the runtime
packages, preload, themes, and installer resources:

```powershell
npm ci
npm run desktop:dist:win
```

Versioned artifacts are written to `release/<version>/`, so packaging a newer
release does not overwrite older installers:

- `TeXWeave-<version>-x64-setup.exe`
- `TeXWeave-<version>-x64-portable.exe`
- `win-unpacked/` (the unpacked application checked by the release verifier)

The application bundles its Electron runtime and JavaScript dependencies. A
LaTeX distribution is intentionally not bundled; the installer and first-run
environment detection can discover or install supported TeX tools. The Windows
binaries are currently unsigned, so Windows SmartScreen may show an unknown
publisher warning until a code-signing certificate is configured.

Before publishing, install the NSIS artifact on a clean Windows account or VM
without Node.js, open a sample project, and verify that themes, spell checking,
PDF preview, and LaTeX toolchain detection work. The package verifier checks
file inclusion and version consistency; it does not replace this clean-machine
smoke test.
