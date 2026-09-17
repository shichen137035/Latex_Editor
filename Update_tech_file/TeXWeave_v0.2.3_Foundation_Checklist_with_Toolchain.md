# TeXWeave v0.2.3 Foundation Checklist

> Version: **v0.2.3**  
> Scope: **i18n, Settings, Theme, Shortcuts**  
> Document type: implementation checklist / verification checklist  
> Goal: consolidate four lightweight but foundational systems before continuing larger editor features.

---

# 0. Version Goal

v0.2.3 should **not** introduce major new editor capabilities.

This version exists to verify and stabilize four infrastructure systems:

- [ ] Internationalization (i18n)
- [ ] Settings
- [ ] Theme
- [ ] Shortcuts / Keybindings

These systems should be implemented in a way that later features can reuse directly.

Core principle:

> New UI features added after v0.2.3 should not need to invent their own text, settings persistence, colors, or keyboard shortcut mechanisms.

---

# 1. i18n Checklist

## 1.1 Baseline audit

- [ ] Confirm whether an i18n framework/library is already installed.
- [ ] Confirm whether there is already a locale resource directory.
- [ ] Search the renderer codebase for hard-coded visible English strings.
- [ ] Search menus, buttons, dialogs, tooltips, placeholders, status messages, error messages, empty states, and settings labels.
- [ ] Confirm Preview Environment labels also use locale keys.
- [ ] Confirm placeholder features such as Preview / Relations / AI use locale keys.
- [ ] Confirm fallback behavior exists when a key is missing.

Recommended structure:

```text
src/renderer/i18n/
├── index.ts
└── locales/
    ├── en.json
    ├── zh-CN.json      # test locale, may be incomplete
    └── ja.json         # future
```

---

## 1.2 Required v0.2.3 behavior

- [ ] English is the default locale.
- [ ] All new UI text must use translation keys.
- [ ] Existing visible hard-coded strings are migrated where practical.
- [ ] Missing translation falls back to English.
- [ ] If English is missing, show the localization key rather than crashing.
- [ ] Locale change updates the UI without restarting the entire app if practical.
- [ ] Layout does not assume English text width.

Example:

```tsx
// Avoid
<button>New Project</button>

// Prefer
<button>{t("project.new")}</button>
```

---

## 1.3 Minimal test locale

A complete second language is **not required**.

However, at least one small test locale should exist to verify the architecture.

Recommended:

```text
zh-CN
```

Translate a representative subset:

- [ ] File
- [ ] Edit
- [ ] View
- [ ] Settings
- [ ] Theme
- [ ] Language
- [ ] Compile
- [ ] Saved
- [ ] Theorem
- [ ] Proof
- [ ] Equation

This is only an architecture test.

---

## 1.4 Suggested key namespaces

```text
app.*
menu.*
project.*
file.*
editor.*
view.*
compile.*
history.*
settings.*
theme.*
language.*
shortcut.*
preview.*
environment.*
status.*
dialog.*
error.*
```

Example:

```json
{
  "menu.file": "File",
  "menu.edit": "Edit",
  "settings.title": "Settings",
  "environment.theorem": "Theorem"
}
```

---

## 1.5 i18n acceptance checks

- [ ] Switching locale changes representative UI text.
- [ ] No parser or editor behavior changes when locale changes.
- [ ] Environment recognition is independent of translated labels.
- [ ] Missing keys do not break rendering.
- [ ] No new feature is allowed to add visible text directly in TSX without justification.

---

# 2. Settings Checklist

## 2.1 Baseline audit

- [ ] Locate all current settings/state persistence mechanisms.
- [ ] Check whether settings are currently stored in multiple unrelated places.
- [ ] Identify any settings stored only in React state.
- [ ] Identify any settings stored only in localStorage.
- [ ] Identify project-specific configuration files.
- [ ] Identify global application configuration files.
- [ ] Confirm whether there is already a Settings page.

The goal is to avoid this situation:

```text
Theme       → localStorage
Compiler    → project.json
Editor      → React state
Environment → XML
Language    → another store
```

---

## 2.2 Settings scope model

v0.2.3 should establish two user-facing scopes:

```text
Global Settings
Project Settings
```

Recommended precedence:

```text
Built-in Default
      ↓
Global User Setting
      ↓
Project Override
```

Project override wins.

---

## 2.3 Recommended settings service

```ts
interface SettingsService {
  get<T>(key: string): T;
  set<T>(key: string, value: T, scope?: "global" | "project"): Promise<void>;
  reset(key: string, scope?: "global" | "project"): Promise<void>;
  subscribe(key: string, listener: (value: unknown) => void): () => void;
}
```

Exact implementation may differ.

The important requirement is that UI components do not directly manage persistent configuration files.

---

## 2.4 Settings page sections

The v0.2.3 page should at least expose the following structure:

```text
Settings
├── General
├── Appearance
├── Editor
├── Language
├── Shortcuts
├── Compiler
└── Environment Blocks
```

Not every section needs to be functional yet.

Unimplemented settings may display:

```text
Not available in v0.2.3
```

rather than fake controls.

---

## 2.5 Minimum functional settings

### General

- [ ] Auto-save mode
- [ ] Restore last project / workspace option if already supported
- [ ] Basic startup behavior if already implemented

### Appearance

- [ ] Theme selector

### Editor

- [ ] Font size
- [ ] Word wrap if already supported
- [ ] Tab size if already supported

### Language

- [ ] UI language selector

### Shortcuts

- [ ] Shortcut manager entry

### Compiler / Local LaTeX Environment

Compiler settings in v0.2.3 should include a minimal local LaTeX toolchain discovery and configuration layer.

```text
Compiler
├── Local Toolchain        # machine/global setting
│   ├── Distribution
│   ├── Toolchain directory
│   ├── latexmk
│   ├── pdflatex
│   ├── xelatex
│   ├── lualatex
│   ├── bibtex
│   └── biber
└── Build Settings         # project setting
    ├── Main file
    ├── Default engine
    ├── Shell escape
    ├── Output directory
    └── Extra arguments
```

- [ ] Add a machine/global setting for the detected LaTeX toolchain path.
- [ ] Store concrete executable paths where practical, not only a raw `PATH` string.
- [ ] Support at least `latexmk`, `pdflatex`, `xelatex`, and `lualatex`.
- [ ] Detect `bibtex` and `biber` when available.
- [ ] Allow manual selection of the toolchain directory or executable.
- [ ] Add a `Detect Again` action.
- [ ] Show per-tool status: Found / Not Found.
- [ ] Toolchain paths are global machine settings and must not be written into project configuration.
- [ ] Project settings contain only build choices such as engine, main file, and arguments.

### Environment Blocks

- [ ] Existing Environment Manager entry remains available
- [ ] No need to expand environment features in this version

---

## 2.6 LaTeX Toolchain Startup Detection

TeXWeave should verify the local LaTeX environment during application startup, so the user does not discover a missing compiler only after pressing Compile.

```text
Application starts
      ↓
Load saved toolchain configuration
      ↓
Is the saved path still valid?
   ┌───────┴───────┐
  yes             no / missing
   │                  ↓
   │           Auto-detect toolchain
   │                  ↓
   │       Search PATH + known locations
   │                  ↓
   │             Toolchain found?
   │              ┌───┴───┐
   │             yes      no
   │              │        │
   │              │        └→ Show warning
   │              │
   │              └→ Save detected global path
   │
   └→ Continue startup
```

- [ ] On startup, load any previously saved LaTeX toolchain path.
- [ ] Validate that the saved directory still exists.
- [ ] Validate that `latexmk` or another required executable is still usable.
- [ ] If no valid saved path exists, automatically search for the local LaTeX environment.
- [ ] Search the current process `PATH`.
- [ ] On Windows, optionally search common TeX Live and MiKTeX installation locations.
- [ ] Prefer discovering the toolchain directory and resolving related executables from it.
- [ ] If a valid toolchain is found, save it as a global machine setting.
- [ ] Never write absolute machine paths into project files.
- [ ] Startup must continue even when no toolchain is found.
- [ ] If no toolchain is found, show a visible, non-destructive warning.
- [ ] The warning should provide `Detect Again`, `Locate Manually`, and `Open Compiler Settings`.
- [ ] Do not repeatedly spam the same warning during one session.
- [ ] Compile without a valid toolchain should show an actionable UI error, not a raw stack trace.

Suggested warning:

```text
LaTeX toolchain not found

TeXWeave could not find latexmk or a usable LaTeX installation on this computer.

[ Detect Again ]  [ Locate Manually ]  [ Open Compiler Settings ]
```

Suggested model:

```ts
interface LatexToolchain {
  distribution?: "texlive" | "miktex" | "unknown";
  binDirectory?: string;

  latexmk?: string;
  pdflatex?: string;
  xelatex?: string;
  lualatex?: string;
  bibtex?: string;
  biber?: string;

  detectedAt?: string;
}
```

When invoking `latexmk`, TeXWeave should prepend the known toolchain directory to the child-process PATH, because `latexmk` may call XeLaTeX, pdfLaTeX, BibTeX, or Biber internally.

```ts
const env = {
  ...process.env,
  PATH: `${toolchain.binDirectory}${path.delimiter}${process.env.PATH ?? ""}`
};

spawn(toolchain.latexmk ?? "latexmk", args, { env });
```

---

## 2.7 Persistence

- [ ] Global settings survive application restart.
- [ ] Project settings survive project reopen.
- [ ] Project-specific settings do not leak into unrelated projects.
- [ ] Reset to Default is supported for configurable values.
- [ ] Invalid config values fall back safely.
- [ ] Configuration writes should be atomic where practical.

---

## 2.8 Settings UI behavior

- [ ] Setting changes that can apply immediately should update immediately.
- [ ] Changes requiring reload should explicitly say so.
- [ ] Disabled settings should explain why they are disabled if necessary.
- [ ] Search inside Settings is optional, not required for v0.2.3.
- [ ] Settings UI strings use i18n.
- [ ] Settings UI colors use theme tokens.

---

# 3. Theme Checklist

Theme is intentionally the simplest of the four systems.

Its purpose in v0.2.3 is mainly to prove that the UI is not visually hard-coded.

---

## 3.1 Baseline audit

- [ ] Search CSS/TSX for literal UI color values.
- [ ] Identify colors already stored as CSS variables.
- [ ] Check whether Monaco uses a separate hard-coded theme.
- [ ] Check whether Preview Environment blocks use direct colors.
- [ ] Check whether dialogs, menus, sidebar, status bar, and editor chrome share a token system.

---

## 3.2 Theme token layer

Recommended:

```text
src/renderer/themes/
├── tokens.css
├── light.css
└── dark.css
```

Example semantic tokens:

```css
--color-bg-app
--color-bg-panel
--color-bg-toolbar

--color-text-primary
--color-text-secondary
--color-text-disabled

--color-border
--color-border-active

--color-primary
--color-accent

--color-success
--color-warning
--color-error

--env-theorem-accent
--env-proof-accent
--env-equation-accent
```

Components should consume semantic variables.

---

## 3.3 Required themes

### Light

- [ ] Complete enough for normal use.
- [ ] Default theme.
- [ ] Blue / cyan / white / silver visual direction.

### Dark

- [ ] Minimal but functional validation theme.
- [ ] Does not need final visual polish.
- [ ] Exists mainly to verify that theme switching is real.

---

## 3.4 Theme switching

Recommended root behavior:

```html
<body data-theme="light">
```

or:

```html
<body data-theme="dark">
```

Requirements:

- [ ] Theme can be changed from Settings.
- [ ] Theme change applies without restart.
- [ ] Selection state remains legible.
- [ ] Error/warning/success colors remain distinguishable.
- [ ] Preview blocks use theme-aware tokens.
- [ ] Monaco switches to a corresponding editor theme.
- [ ] Theme choice persists.

---

## 3.5 Theme acceptance checks

- [ ] Light → Dark changes the complete workbench, not just a few panels.
- [ ] No important UI element becomes unreadable.
- [ ] Monaco and surrounding UI do not look visually disconnected.
- [ ] Environment block styles remain usable.
- [ ] No major component requires React logic changes to support a new theme.

---

# 4. Shortcut / Keybinding Checklist

v0.2.3 should introduce a reusable keyboard shortcut system.

The goal is to prevent shortcuts from being scattered across React event handlers.

---

## 4.1 Core principle

Buttons, menu items, and keyboard shortcuts should call the same command.

Example:

```text
Ctrl+S
   ↓
file.save
   ↑
Save menu item
   ↑
future command palette
```

---

## 4.2 Command registry

Before configurable shortcuts, confirm there is a command abstraction.

Recommended command IDs:

```text
file.new
file.save
file.saveAll

edit.undo
edit.redo
edit.find
edit.replace

project.open
project.close
project.switch

latex.compile

view.source
view.preview
view.pdf
view.toggleSidebar
view.toggleBottomPanel

history.open
version.create
version.restore

settings.open
```

Suggested API:

```ts
interface Command {
  id: string;
  execute: (...args: unknown[]) => void | Promise<void>;
}
```

---

## 4.3 Keybinding registry

Recommended model:

```ts
interface Keybinding {
  commandId: string;
  keys: string;
  when?: string;
}
```

Examples:

```text
Ctrl+S        → file.save
Ctrl+Shift+S  → file.saveAll
Ctrl+F        → edit.find
Ctrl+H        → edit.replace
Ctrl+B        → latex.compile
Ctrl+,        → settings.open
```

Use platform-aware representation where needed:

```text
Ctrl on Windows/Linux
Cmd on macOS
```

---

## 4.4 Required v0.2.3 behavior

- [ ] Built-in default shortcuts exist.
- [ ] Shortcuts dispatch registered commands.
- [ ] Users can view shortcuts in Settings.
- [ ] Users can edit shortcuts.
- [ ] User changes persist.
- [ ] A shortcut can be reset to default.
- [ ] Duplicate/conflicting bindings are detected.
- [ ] Invalid key sequences are rejected.
- [ ] Shortcut UI strings use i18n.
- [ ] Shortcut display adapts to platform where relevant.

---

## 4.5 Shortcut Settings UI

Suggested table:

```text
Command                  Shortcut          Action

Save File                Ctrl+S            Edit
Save All                 Ctrl+Shift+S      Edit
Compile                  Ctrl+B            Edit
Find                     Ctrl+F            Edit
Open Settings            Ctrl+,            Edit
```

Click `Edit`:

```text
Press desired shortcut...
```

Then detect:

```text
Conflict:
Ctrl+S is already assigned to Save File.
```

Options:

```text
Cancel
Replace
```

---

## 4.6 Context-sensitive shortcuts

The architecture should support future context expressions:

```text
editorFocus
previewFocus
pdfFocus
sidebarFocus
inlineSourceEditorFocus
```

Example future rule:

```text
Esc
when: inlineSourceEditorFocus
→ exit inline editing
```

Full context-expression language is not required in v0.2.3.

The data model should simply leave room for it.

---

## 4.7 Shortcut persistence

Recommended override model:

```text
Built-in keybindings
        ↓
User keybinding overrides
```

Project-specific shortcut overrides are **not required** for v0.2.3.

Shortcuts are primarily user/application preferences.

---

# 5. Integration Checklist

These four systems must work together.

---

## 5.1 i18n + Settings

- [ ] Language selector is a normal setting.
- [ ] Changing language updates Settings labels themselves.
- [ ] Selected locale persists.

---

## 5.2 Theme + Settings

- [ ] Theme selector is a normal setting.
- [ ] Theme persists.
- [ ] Theme can be changed without restart.

---

## 5.3 Shortcuts + Settings

- [ ] Shortcut manager lives in Settings.
- [ ] Editing a binding updates the active keybinding registry.
- [ ] Reset restores built-in default.

---

## 5.4 Theme + Preview

- [ ] Environment block colors use theme tokens.
- [ ] Selected/hover states remain visible in both Light and Dark.
- [ ] ContentRegion editing surface follows current theme.

---

## 5.5 i18n + Preview

- [ ] Environment labels use translation keys.
- [ ] Changing language changes visible environment labels.
- [ ] Environment parser matching does not depend on translated text.

---

# 6. Suggested Configuration Structure

One possible structure:

```text
user-data/
├── settings.json
├── keybindings.json
└── locale.json              # optional; may be part of settings

project/
└── .texweave/
    ├── project.json
    └── environments.xml
```

Recommended responsibility:

```text
settings.json
→ user/global preferences

keybindings.json
→ user shortcut overrides

project.json
→ project-local overrides

environments.xml
→ block/environment definitions
```

Exact file names may differ.

---

# 7. Validation Checklist

Before marking v0.2.3 complete:

## i18n

- [ ] English locale loads.
- [ ] Test locale loads.
- [ ] Representative strings switch correctly.
- [ ] Missing key fallback works.
- [ ] Environment labels switch correctly.
- [ ] No major visible hard-coded strings remain in core UI.

## Settings

- [ ] Settings page opens.
- [ ] Settings persist across restart.
- [ ] Global vs project scope works where implemented.
- [ ] Reset works.
- [ ] Invalid setting values do not crash the app.
- [ ] Saved LaTeX toolchain path is validated on startup.
- [ ] Missing/invalid toolchain path triggers automatic detection.
- [ ] Successfully detected toolchain is stored globally.
- [ ] Missing toolchain shows an actionable warning.
- [ ] Manual toolchain selection works.
- [ ] Absolute machine paths never leak into project configuration.

## Theme

- [ ] Light theme works.
- [ ] Dark validation theme works.
- [ ] Theme switches live.
- [ ] Monaco theme follows.
- [ ] Preview block colors follow.
- [ ] Theme persists after restart.

## Shortcuts

- [ ] Default shortcuts trigger commands.
- [ ] Settings lists shortcuts.
- [ ] User can rebind a shortcut.
- [ ] Conflict detection works.
- [ ] Reset to default works.
- [ ] Rebound shortcut works immediately.
- [ ] Shortcut overrides persist.

---

# 8. Suggested Smoke Tests

### Test A: Language

1. Launch TeXWeave.
2. Open Settings.
3. Change language from English to test locale.
4. Verify menu, Settings, and one Preview environment label.
5. Restart.
6. Confirm selection persists.

### Test B: Theme

1. Start in Light.
2. Switch to Dark.
3. Check Activity Bar, Sidebar, editor chrome, Monaco, Preview block, status bar.
4. Restart.
5. Confirm Dark persists.

### Test C: Shortcut

1. Open shortcut settings.
2. Change Compile from `Ctrl+B` to another valid shortcut.
3. Trigger it.
4. Confirm compile command runs.
5. Attempt to bind an already-used shortcut.
6. Confirm conflict warning.
7. Reset Compile shortcut.
8. Confirm default binding returns.

### Test D: Project override

1. Set a global editor preference.
2. Open project A with project override.
3. Confirm project A uses override.
4. Open project B.
5. Confirm project B uses global value.

---

### Test E: LaTeX toolchain detection

1. Start TeXWeave with a valid saved toolchain path.
2. Confirm no warning is shown.
3. Invalidate/remove the saved path and restart.
4. Confirm automatic detection runs.
5. If LaTeX is installed, confirm the detected path is stored.
6. If LaTeX is unavailable, confirm an actionable warning appears.
7. Use `Locate Manually` and select a valid toolchain directory or `latexmk`.
8. Compile a minimal project.
9. Confirm child tools such as XeLaTeX can be found through the configured environment.

---

# 9. Non-Goals for v0.2.3

Do not expand this version into:

- advanced completion;
- package-aware IntelliSense;
- AI editor implementation;
- relation graph;
- image authoring;
- table authoring;
- full multilingual translation set;
- polished dark-theme art direction;
- command palette;
- project-specific shortcut system;
- cloud settings sync.

These can follow after the foundation is stable.

---

# 10. Completion Definition

v0.2.3 is complete when:

- [ ] i18n infrastructure is verified and English is cleanly externalized.
- [ ] one second locale proves language switching works.
- [ ] Settings has a unified persistence path.
- [ ] theme selection is implemented through design tokens.
- [ ] Light is production-usable and Dark proves theme extensibility.
- [ ] shortcuts are based on commands, not ad-hoc handlers.
- [ ] users can inspect and change shortcuts in Settings.
- [ ] all four systems persist correctly.
- [ ] all four systems can be reused by future modules without architectural rewrites.
- [ ] local LaTeX toolchain configuration is discovered, persisted, validated, and surfaced through Settings.

---

# 11. Recommended Next Step After v0.2.3

After these four items are stabilized, the next infrastructure target should be:

> **Completion / IntelliSense + Snippet data layer**

because it depends on the same principles already validated here:

- external data;
- user configuration;
- reusable registries;
- project-aware overrides;
- i18n descriptions;
- shortcut-accessible commands.

