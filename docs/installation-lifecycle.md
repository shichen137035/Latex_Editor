# TeXWeave Windows installation lifecycle

TeXWeave uses electron-builder's assisted NSIS installer. The standard NSIS
pages remain responsible for the installation directory, shortcuts and file
association; `build/installer.nsh` adds the TeXWeave component-selection page
and writes a small hand-off manifest to `%APPDATA%\TeXWeave\config`.
The NSIS runtime includes English, Simplified Chinese, Traditional Chinese,
Japanese, Korean and French resources and follows the Windows locale by
default; the first page also records the selected product UI language.

## Ownership model

The running application stores verified ownership in
`config/installation.json`:

- `external`: detected on the machine and not installed by TeXWeave;
- `installed-by-texweave`: installed and managed by TeXWeave;
- `user-managed`: imported or downloaded by the user.

The LaTeX toolchain is detected at every startup. Detection updates the saved
environment snapshot but never overwrites an external installation. Language
packs, spell resources, themes and templates live below `%APPDATA%\TeXWeave`
and survive application updates.

## Updates

Installing a newer NSIS package over an existing installation replaces only the
application layer. The installer does not remove user data, project folders,
external TeX distributions, language packs, spell dictionaries or templates.
The new process revalidates the toolchain on its first startup.

## Uninstall

`deleteAppDataOnUninstall` is disabled. The default uninstaller removes the
application files, shortcuts and `.tex` association only. `%APPDATA%\TeXWeave`
and all projects remain. The optional `--delete-app-data` path is reserved for
an explicit advanced cleanup action and is implemented as an allow-list in
`InstallationStateService`; project paths and external TeX roots are never
targets of that cleanup.

## Components and environment helpers

Installer manifests are shipped under `resources/installer`:

- `manifests/languages.json`
- `manifests/spellcheck.json`
- `manifests/latex.json`
- `profiles/texlive-full.profile`
- `scripts/detect-environment.ps1`
- `scripts/verify-environment.ps1`
- `scripts/install-texlive.ps1`
- `scripts/install-miktex.ps1`

The TeX Live and MiKTeX scripts use external bootstrapper downloads and only
run after explicit selection. TeX Live installation is never bundled into the
application installer and therefore does not inflate the core package.
