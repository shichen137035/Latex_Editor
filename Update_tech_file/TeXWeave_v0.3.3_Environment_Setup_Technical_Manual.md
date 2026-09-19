# TeXWeave v0.3.3 Technical Manual
## Environment Setup and Language Pack Management

**Version:** 0.3.3  
**Focus:** LaTeX environment detection, guided setup, spellcheck language management  
**Type:** Implementation specification

---

# 1. Version Goal

v0.3.3 introduces an **Environment Setup Manager**.

The purpose of this release is to reduce the manual system configuration required before TeXWeave becomes usable.

The release focuses on two external dependency areas:

```text
Environment Setup
├── LaTeX Toolchain
└── Spellcheck Languages
```

Main goals:

1. Detect whether a usable LaTeX compilation environment exists.
2. Detect the active LaTeX distribution, compiler, and build tool.
3. Warn clearly when PDF compilation is unavailable.
4. Provide guided installation or existing-installation selection.
5. Keep TeXWeave usable even when LaTeX compilation is unavailable.
6. Bundle English spellchecking by default.
7. Allow users to search and install additional Hunspell/nspell dictionaries on demand.
8. Provide a Settings page for checking, repairing, and managing the environment.

v0.3.3 is not intended to become a general-purpose package manager.

---

# 2. Core Product Principles

## 2.1 TeXWeave should work before PDF compilation works

If the user has no LaTeX environment installed, TeXWeave must still allow:

```text
source editing
Preview editing
block operations
search
filtering
spellcheck
project navigation
```

Only PDF compilation should be unavailable.

## 2.2 Environment detection may be automatic

TeXWeave may automatically inspect the system for:

```text
TeX distribution
compiler executables
build tools
bibliography tools
installed spellcheck dictionaries
```

This does not require confirmation.

## 2.3 Installation must be user-triggered

Downloading or installing external software requires explicit user action.

Example:

```text
LaTeX environment missing

[ Set Up LaTeX ]
[ Choose Existing Installation ]
[ Not Now ]
```

TeXWeave must not silently install a distribution.

## 2.4 Prefer project-independent environment configuration

Compiler paths, dictionaries, and tool locations belong to TeXWeave user configuration and should not normally be stored inside individual projects.

---

# 3. High-Level Architecture

```text
                   TeXWeave Startup
                         │
                         ↓
                Environment Manager
                 /                \
                /                  \
               ↓                    ↓
      LaTeX Environment       Spellcheck Manager
               │                    │
               ↓                    ↓
        Capability Profile      Language Registry
               │                    │
               ↓                    ↓
        Compile Availability    nspell Dictionaries
```

---

# 4. Recommended Module Structure

```text
src/
├── core/
│   ├── environment/
│   │   ├── EnvironmentManager.ts
│   │   ├── DependencyStatus.ts
│   │   ├── ToolResolver.ts
│   │   ├── types.ts
│   │   │
│   │   ├── latex/
│   │   │   ├── LatexEnvironmentDetector.ts
│   │   │   ├── LatexCapabilityProfile.ts
│   │   │   ├── LatexDistributionBackend.ts
│   │   │   ├── MiKTeXBackend.ts
│   │   │   ├── TeXLiveBackend.ts
│   │   │   ├── LatexInstaller.ts
│   │   │   └── MissingPackageResolver.ts
│   │   │
│   │   └── spellcheck/
│   │       ├── LanguagePackManager.ts
│   │       ├── DictionaryRegistry.ts
│   │       ├── DictionaryInstaller.ts
│   │       ├── SpellcheckLanguage.ts
│   │       └── licenses.ts
│   │
│   └── settings/
│       └── EnvironmentSettingsStore.ts
│
├── editor/
│   └── settings/
│       └── environment/
│           ├── EnvironmentSettingsPage.tsx
│           ├── LatexEnvironmentSection.tsx
│           ├── SpellcheckLanguageSection.tsx
│           ├── AddLanguageDialog.tsx
│           └── EnvironmentWarning.tsx
│
└── shared/
    └── commands/
```

Environment logic must remain outside React components.

---

# 5. Unified Dependency Status

```ts
export type DependencyStatus =
  | "unknown"
  | "checking"
  | "ready"
  | "limited"
  | "missing"
  | "broken"
  | "installing"
  | "restart-required";
```

Meaning:

```text
unknown          not yet checked
checking         detection currently running
ready            fully usable
limited          partially usable
missing          not installed / not found
broken           detected but unusable
installing       installation currently running
restart-required configuration succeeded but restart is needed
```

---

# 6. LaTeX Environment Model

TeXWeave should not represent LaTeX availability as a single boolean.

```ts
export interface LatexEnvironmentStatus {
  distribution: LatexDistributionInfo | null;

  pdflatex: ToolStatus;
  xelatex: ToolStatus;
  lualatex: ToolStatus;

  latexmk: ToolStatus;

  bibtex: ToolStatus;
  biber: ToolStatus;
  makeindex: ToolStatus;

  overallStatus:
    | "ready"
    | "limited"
    | "unavailable";
}
```

---

# 7. Distribution Detection

Initial supported distributions:

```text
MiKTeX
TeX Live
```

```ts
export type LatexDistributionType =
  | "miktex"
  | "texlive"
  | "unknown";

export interface LatexDistributionInfo {
  type: LatexDistributionType;
  version?: string;
  rootPath?: string;
}
```

---

# 8. Tool Detection

Detect at least:

```text
pdfLaTeX
XeLaTeX
LuaLaTeX
latexmk
BibTeX
Biber
MakeIndex
```

```ts
export interface ToolStatus {
  status: DependencyStatus;

  executablePath?: string;
  version?: string;

  source:
    | "user-configured"
    | "detected"
    | "system-path"
    | "unknown";
}
```

---

# 9. Tool Resolution Order

Executable lookup should follow:

```text
1. User-configured executable/path
2. Previously detected TeX installation
3. System PATH
4. Platform-specific standard locations
```

TeXWeave should not require modifying the global system PATH.

---

# 10. Startup Detection

On startup:

```text
TeXWeave launches
      ↓
EnvironmentManager.check()
      ↓
LaTeX detection
      ↓
Spellcheck dictionary detection
```

If the LaTeX environment is ready:

```text
do not interrupt the user
```

If it is missing:

```text
show a clear warning
```

---

# 11. Missing LaTeX Warning

Recommended:

```text
LaTeX compilation environment not found

TeXWeave can still edit and preview source,
but PDF compilation requires a LaTeX environment.

[ Set Up LaTeX ]
[ Choose Existing Installation ]
[ Not Now ]
```

Choosing `Not Now` must not block the application.

---

# 12. PDF Availability State

When no usable compiler exists:

```text
⚠ PDF compilation unavailable

No usable LaTeX compiler is configured.

[ Set Up ]
```

The rest of the application remains usable.

---

# 13. Overall LaTeX Status

## Ready

```text
Distribution     MiKTeX       ✓
Compiler         pdfLaTeX     ✓
Build Tool       latexmk      ✓
```

Normal build pipeline is available.

## Limited

```text
Distribution     TeX Live     ✓
Compiler         pdfLaTeX     ✓
Build Tool       latexmk      Missing
```

UI message:

```text
LaTeX environment partially configured

A compiler is available, but the recommended
build tool is missing.
```

## Unavailable

```text
Distribution     Missing
Compiler         Missing
```

PDF compilation is disabled.

---

# 14. Installation Strategy

The setup flow should not force one distribution.

Recommended choices:

```text
Recommended installation
Choose existing installation
Advanced / manual configuration
```

On Windows, TeXWeave may recommend MiKTeX.

Users must remain free to use TeX Live.

---

# 15. Installation Confirmation

Before installing a distribution:

```text
Install LaTeX Environment

Distribution:
MiKTeX

Installation location:
...

Download / installation:
...

[ Install ]
[ Cancel ]
```

Installation only begins after confirmation.

---

# 16. Existing Installation Selection

If detection fails:

```text
[ Choose Existing Installation ]
```

Allow the user to select a directory or executable.

Example:

```text
C:\texlive\2026\bin\windows\
```

TeXWeave saves the selected location in its own settings.

---

# 17. Distribution Backend Abstraction

```ts
export interface LatexDistributionBackend {
  detect(): Promise<LatexEnvironmentStatus>;

  installPackage?(
    packageName: string
  ): Promise<InstallResult>;

  refreshPackageDatabase?():
    Promise<void>;
}
```

Implementations:

```text
MiKTeXBackend
TeXLiveBackend
```

---

# 18. Missing Package Support

v0.3.3 may include initial missing-package handling.

Example compile error:

```text
algorithm2e.sty not found
```

TeXWeave may produce:

```text
Missing LaTeX package:
algorithm2e

[ Install Package ]
```

The active distribution backend performs installation.

---

# 19. Missing Package Rules

Package installation must:

```text
require explicit user action
report progress
report failure clearly
refresh package database if needed
retry compilation only when appropriate
```

Do not silently install arbitrary packages during compilation.

---

# 20. Spellcheck Architecture

TeXWeave uses:

```text
nspell
+
Hunspell-style dictionaries
```

The nspell engine may ship with the application.

Language data is managed separately.

---

# 21. Default Language Policy

v0.3.3 should bundle only:

```text
English
```

with the application.

The initial installation should not include all available dictionaries.

---

# 22. Additional Languages

All non-default dictionaries are installed on demand.

Settings should show currently installed languages only.

```text
Spell Checking
────────────────────

English                      ✓ Installed

[ + Add Language ]
```

---

# 23. Add Language Dialog

Clicking:

```text
+ Add Language
```

opens a searchable language directory.

```text
Add Language

[ Search languages...              ]

English
  English (Australia)       Install
  English (Canada)          Install
  English (United Kingdom)  Install

French                      Install

German
  German (Austria)          Install
  German (Switzerland)      Install

Spanish                     Install

...
```

The list may contain dozens of available dictionaries and must support search.

---

# 24. Language Search

Search should match:

```text
display name
language code
region
```

Examples:

```text
Search: german
→ German
→ German (Austria)
→ German (Switzerland)

Search: en-GB
→ English (United Kingdom)
```

---

# 25. Language Pack Model

```ts
export interface DictionaryPackage {
  id: string;

  languageCode: string;

  displayName: string;

  region?: string;

  installed: boolean;

  version?: string;

  dictionaryUrl?: string;

  affUrl?: string;
  dicUrl?: string;

  license: LicenseInfo;
}
```

---

# 26. Dictionary Registry

```ts
export interface DictionaryRegistry {
  list():
    Promise<DictionaryPackage[]>;

  search(
    query: string
  ): Promise<DictionaryPackage[]>;

  get(
    id: string
  ): Promise<DictionaryPackage | null>;
}
```

The Settings UI should not hardcode all languages.

---

# 27. Dictionary Installation

```text
User clicks Install
      ↓
download dictionary package
      ↓
validate files
      ↓
store .aff + .dic
      ↓
register language
      ↓
reload spellcheck service
      ↓
Installed ✓
```

---

# 28. Dictionary Storage

Recommended location:

```text
TeXWeave User Data/
└── dictionaries/
    ├── en/
    │   ├── index.aff
    │   └── index.dic
    │
    ├── en-GB/
    │   ├── index.aff
    │   └── index.dic
    │
    └── de/
        ├── index.aff
        └── index.dic
```

Do not store downloaded dictionaries inside projects.

---

# 29. Dictionary License Metadata

```ts
export interface LicenseInfo {
  name: string;
  source?: string;
}
```

Do not assume every dictionary uses the same license.

---

# 30. Installed Language Management

Settings should allow:

```text
enable language
disable language
remove downloaded language
set default language
```

Bundled English may be non-removable or automatically restored.

---

# 31. Spellcheck Language Activation

```ts
export interface SpellcheckSettings {
  enabled: boolean;

  activeLanguages: string[];

  defaultLanguage: string;
}
```

Project-specific language overrides may be added later.

---

# 32. Environment Settings Page

Add:

```text
Settings
└── Environment
```

Recommended page:

```text
Environment

LaTeX
────────────────────────────

Distribution
MiKTeX 25.x                     ✓

Compiler
pdfLaTeX                        ✓
XeLaTeX                         ✓
LuaLaTeX                        ✓

Build Tool
latexmk                         ✓

Bibliography
BibTeX                          ✓
Biber                           ✓

[ Recheck ]
[ Configure ]


Spell Checking
────────────────────────────

English                         ✓ Installed
French                          ✓ Installed

[ + Add Language ]
```

---

# 33. LaTeX Configure Panel

`Configure` should expose:

```text
Detected distribution
Preferred compiler
Build tool
Executable paths
Re-detect environment
Choose existing installation
Install missing environment
```

Advanced paths may live under:

```text
Advanced
```

---

# 34. Recheck Action

The Environment page must provide:

```text
[ Recheck ]
```

This triggers:

```text
distribution detection
tool detection
version detection
status recomputation
```

without restarting the application.

---

# 35. Environment Warning UI

Warnings should be specific.

Preferred:

```text
PDF compilation unavailable

No LaTeX compiler was found.

[ Set Up ]
```

or:

```text
Limited LaTeX environment

pdfLaTeX is available, but latexmk is missing.

[ Configure ]
```

---

# 36. Non-Blocking Startup

Environment checking must not freeze application startup.

```text
App UI starts
      ↓
Environment check runs
      ↓
status updates asynchronously
```

While checking:

```text
LaTeX environment:
Checking...
```

---

# 37. Environment Persistence

Persist:

```text
user-selected LaTeX installation
preferred compiler
preferred distribution
custom executable paths
installed language list
active spellcheck languages
```

Do not persist temporary states such as `checking` or `installing`.

---

# 38. Error Handling

Installation and detection errors should be localized.

Examples:

```text
distribution installer failed
download failed
dictionary archive invalid
permission denied
configured executable missing
package installation failed
```

The application should remain usable.

---

# 39. Download Failure Behavior

For language packs:

```text
download failed
→ keep language uninstalled
→ show retry action
```

For LaTeX installation:

```text
installation failed
→ PDF remains unavailable
→ preserve editor functionality
```

---

# 40. Security Rules

Do not execute arbitrary commands received from remote dictionary metadata.

Only approved distribution backends may invoke known package-manager commands.

Downloaded dictionary files should be treated as data.

---

# 41. Platform Abstraction

```ts
export interface PlatformToolLocator {
  findLatexInstallations():
    Promise<DetectedToolchain[]>;

  findExecutable(
    name: string
  ): Promise<string[]>;
}
```

Avoid scattering platform-specific paths through UI code.

---

# 42. First-Run Flow

```text
TeXWeave starts
      ↓
English dictionary already available
      ↓
Check LaTeX environment
      ↓
 ┌───────────────┬────────────────┐
 │               │                │
Ready          Limited          Missing
 │               │                │
none           warning          warning
                 │                │
                 ↓                ↓
             Configure         Set Up
```

---

# 43. PDF Compile Flow

When the user presses Compile:

```text
check cached environment status
      ↓
usable?
 ┌───────────┐
 │           │
yes          no
 │           │
compile    show setup warning
```

If the cached status is stale or an executable disappeared, refresh before reporting failure.

---

# 44. Spellcheck Flow

On startup:

```text
load bundled English dictionary
      ↓
load enabled downloaded dictionaries
      ↓
initialize nspell instances
```

If a downloaded dictionary is missing or corrupt:

```text
mark broken
disable it
offer reinstall
```

---

# 45. Tests: LaTeX Detection

Required cases:

```text
MiKTeX installed and found
TeX Live installed and found
compiler found through PATH
compiler found through configured path
multiple distributions present
no distribution present
configured path no longer exists
```

---

# 46. Tests: Capability Profile

## Ready

```text
pdflatex ✓
latexmk  ✓
```

Expected:

```text
overallStatus = ready
```

## Limited

```text
pdflatex ✓
latexmk  missing
```

Expected:

```text
overallStatus = limited
```

## Unavailable

```text
all compilers missing
```

Expected:

```text
overallStatus = unavailable
```

---

# 47. Tests: Startup Warning

When LaTeX is missing:

```text
warning appears
Set Up works
Choose Existing Installation works
Not Now dismisses
editor remains usable
PDF remains unavailable
```

---

# 48. Tests: Existing Installation Selection

Select a valid TeX directory:

```text
path saved
tools re-detected
status refreshed
```

Select an invalid directory:

```text
clear validation error
configuration not committed
```

---

# 49. Tests: Language Defaults

Fresh installation:

```text
English installed
English spellcheck available
other dictionaries not bundled
```

---

# 50. Tests: Language Registry

Open Add Language:

```text
available languages listed
search works
regional variants distinguishable
installed languages marked correctly
```

---

# 51. Tests: Language Installation

Install an available language:

```text
download completes
.aff and .dic stored
language marked Installed
spellchecker can activate language
```

---

# 52. Tests: Language Removal

Remove a downloaded language:

```text
dictionary removed
language becomes available for install again
spellcheck service reloads cleanly
```

---

# 53. Tests: Offline Behavior

With no network:

```text
bundled English still works
existing LaTeX installation still works
installed dictionaries still work
Add Language reports network unavailability
installation actions fail gracefully
```

---

# 54. Tests: UI State

Environment Settings should correctly display:

```text
checking
ready
limited
missing
broken
installing
restart-required
```

---

# 55. Performance Requirements

Startup detection should be lightweight.

Recommended:

```text
use cached tool paths first
validate cached executables
perform broader scan only when needed
```

Do not recursively scan entire disks.

Dictionary registry loading should also be cached where practical.

---

# 56. Logging

Development logging should record:

```text
tool resolution path
detected distribution
detected versions
installation command outcome
dictionary download result
environment status transitions
```

Do not log unnecessary user document content.

---

# 57. Non-Goals for v0.3.3

Do not expand Environment Manager to:

```text
Git
Python
R
Pandoc
Node.js
Perl
ImageMagick
general system package management
general application updater
```

Do not bundle all spellcheck languages.

Do not require LaTeX installation before opening TeXWeave.

---

# 58. Recommended Implementation Order

## Phase 1 — Environment Status Core

```text
DependencyStatus
ToolStatus
EnvironmentManager
ToolResolver
```

## Phase 2 — LaTeX Detection

```text
MiKTeX detection
TeX Live detection
pdfLaTeX
XeLaTeX
LuaLaTeX
latexmk
BibTeX
Biber
MakeIndex
```

## Phase 3 — Startup Warning and PDF Gating

```text
missing-environment warning
limited-environment warning
PDF unavailable state
Set Up action
Not Now action
```

## Phase 4 — Existing Installation Configuration

```text
choose installation
custom executable paths
recheck
persist configuration
```

## Phase 5 — Guided Installation

```text
recommended distribution
installation confirmation
progress
failure handling
post-install recheck
```

## Phase 6 — Default English Spellcheck

```text
bundle English dictionary
load at startup
nspell integration
```

## Phase 7 — Dictionary Registry

```text
available language catalog
search
regional variants
license metadata
installed state
```

## Phase 8 — Language Installation UI

```text
Add Language dialog
Install
Remove
Enable / Disable
default language
```

## Phase 9 — Missing LaTeX Package Infrastructure

Initial support:

```text
missing .sty detection
distribution backend routing
user-triggered package installation
```

This phase may be postponed without blocking the core v0.3.3 release.

---

# 59. Completion Criteria

v0.3.3 is complete when:

```text
✓ TeXWeave automatically checks for a LaTeX environment
✓ MiKTeX can be detected
✓ TeX Live can be detected
✓ pdfLaTeX detection works
✓ XeLaTeX detection works
✓ LuaLaTeX detection works
✓ latexmk detection works
✓ missing compiler produces a clear warning
✓ users can dismiss setup and continue editing
✓ PDF compilation clearly reports unavailable state
✓ users can choose an existing LaTeX installation
✓ custom paths can be persisted
✓ environment can be rechecked without restart
✓ English spellcheck is bundled by default
✓ additional languages are not bundled by default
✓ Settings shows installed spellcheck languages
✓ Add Language opens a searchable language registry
✓ additional dictionaries can be installed on demand
✓ installed dictionaries can be activated
✓ dictionary licenses are retained in metadata
✓ offline English spellcheck continues to work
✓ environment installation remains user-triggered
✓ application startup is not blocked by environment detection
```

---

# 60. Final Product Model

```text
LaTeX Environment

Detected
→ use it

Missing
→ warn
→ offer setup
→ allow user to continue without PDF


Spellcheck

English
→ included by default

Other languages
→ searchable catalog
→ install only when requested
```

The central product principle is:

> TeXWeave should help users configure the tools it depends on, but it should never make environment setup a prerequisite for opening and using the editor.
