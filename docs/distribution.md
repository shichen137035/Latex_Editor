# Windows distribution

The current 0.6.7 packaging path produces one unsigned Windows x64 portable
executable. The previous NSIS installer and its unused component-selection
scripts were retired; a setup installer will be designed separately after its
install, update, and user-data behavior is defined.

On a clean Windows build machine, install the locked dependencies and run the
release build:

```powershell
npm ci
npm run desktop:dist:win
```

The release command runs the full release verification first. Its desktop build
starts by removing generated `dist/` output and TypeScript build-info files,
then recreates the renderer, main process, preload, and workspace package
outputs. It clears only `release/<version>/` before packaging, so an older
version's artifacts remain available. The package verifier checks the app
archive, workspace runtime packages, required resources, version, unpacked app,
and portable executable.

Artifacts are written to `release/<version>/`:

- `TeXWeave-<version>-x64-portable.exe`
- `win-unpacked/`, the unpacked application used by the package verifier

The portable executable does not install shortcuts or register `.tex` file
associations. User settings continue to use Electron's per-user data directory;
projects stay in their existing folders. The binary is unsigned, so Windows may
show a SmartScreen warning. This package check does not replace a clean-account
smoke test of first launch, project editing, PDF preview, and LaTeX detection.
