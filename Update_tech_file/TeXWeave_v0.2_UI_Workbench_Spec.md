# TeXWeave v0.2 UI / Workbench Specification

> Status: Draft baseline for v0.2  
> Default UI language: English  
> Scope: Desktop UI shell and interaction framework for the local-first LaTeX editor  
> Target stack: Electron + React + TypeScript + Monaco Editor

---

## 1. Purpose

TeXWeave v0.2 introduces the first complete desktop workbench UI on top of the v0.1 core.

The main goal of v0.2 is **not** to finish every future feature. Instead, v0.2 should establish a stable, extensible UI shell so that later capabilities such as Preview, Relations, AI editing, advanced structure analysis, references, and richer PDF synchronization can be added without redesigning the application layout.

The UI should therefore follow these principles:

- local-first desktop application;
- source editing is the primary active feature;
- project files, compiling, diagnostics, history/version access, and layout management should be integrated;
- future features must have reserved UI locations and state interfaces;
- unimplemented features must be shown honestly as placeholders, not mocked as working features;
- layout must be resizable and remember user choices;
- UI text must be internationalization-ready;
- visual theme must be replaceable without rewriting components.

---

# 2. Global UI Architecture

The main workbench is divided into five structural layers:

```text
Application
├── Top Menu / Project Bar
├── Activity Bar
├── Sidebar
├── Workspace
│   ├── Left Pane
│   └── Right Pane
└── Status / Temporary Panels
```

Important terminology:

- **Activity Bar**: the narrow vertical icon strip on the far left.
- **Sidebar**: the panel opened by Activity Bar items, e.g. Files, Search, AI Editor.
- **Workspace**: the main content area that displays Source, Preview, and/or PDF.
- **Bottom Panel**: temporary or expandable panel for Problems, Logs, Output, Versions, etc.
- **Status Bar**: compact always-visible status strip at the bottom.

These concepts should remain separate in code and state management.

---

# 3. Internationalization Requirement

TeXWeave must support multiple UI languages in later versions.

For v0.2:

- English is the default and only required completed locale.
- **No user-visible UI string may be hard-coded directly inside React components.**
- All visible strings must be referenced through an i18n/localization layer.
- Menus, buttons, tooltips, dialog text, placeholders, empty-state messages, warnings, settings labels, and status text must use localization keys.
- Locale files should be external resources.

Example:

```text
locales/
├── en.json
├── zh-CN.json      # future
├── ja.json         # future
└── ...
```

Example usage:

```ts
t("menu.file")
t("project.new")
t("workspace.preview.unavailable")
```

Avoid:

```tsx
<button>New Project</button>
```

Prefer:

```tsx
<button>{t("project.new")}</button>
```

Suggested fallback rule:

```text
requested locale
    ↓
English
    ↓
localization key
```

The UI architecture must assume that translated text may be longer than English text.

Therefore:

- buttons should not depend on fixed text width;
- menus should allow wider labels;
- tooltips should wrap when necessary;
- no feature should rely on English word length.

---

# 4. Theme / Styling Requirement

The UI theme must be replaceable.

v0.2 uses a bright theme by default, based mainly on:

- blue;
- cyan;
- white;
- silver;
- cool gray.

However, the implementation must allow future themes such as:

- Dark;
- High Contrast;
- custom user themes;
- alternate light themes.

## 4.1 CSS Rules

Components must not contain large amounts of hard-coded color values.

Use design tokens / CSS variables:

```css
:root {
  --color-bg-app: #f6f9fc;
  --color-bg-panel: #ffffff;
  --color-bg-toolbar: #f8fbfd;

  --color-primary: #1787c7;
  --color-accent: #2dc7d7;

  --color-text-primary: #172033;
  --color-text-secondary: #708198;

  --color-border: #d9e3ec;

  --color-success: #2fb879;
  --color-warning: #d79a27;
  --color-error: #d94a4a;

  --radius-small: 6px;
  --radius-medium: 10px;
  --radius-large: 16px;

  --shadow-panel: 0 4px 18px rgba(20, 50, 80, 0.08);
}
```

Components should consume semantic tokens rather than literal palette values.

Example:

```css
.toolbar {
  background: var(--color-bg-toolbar);
  border-color: var(--color-border);
}
```

## 4.2 Theme Switching

Recommended structure:

```text
themes/
├── light.css
├── dark.css          # future
├── high-contrast.css # future
└── custom/           # future
```

Theme switching should happen by changing a root theme class or data attribute:

```html
<body data-theme="light">
```

Do not build visual logic into component code unless required by behavior.

---

# 5. v0.2 Feature Availability Rules

Many controls visible in v0.2 correspond to features that are not yet implemented.

These controls **must still exist when they are part of the long-term layout**, but their state must be explicit.

Allowed behaviors:

- disabled control;
- placeholder panel;
- empty-state message;
- "Coming later";
- "Not available in v0.2";
- feature status flag.

Not allowed:

- fake data pretending the feature works;
- clickable controls that silently do nothing;
- mock output presented as a real result;
- temporary UI implementations that bypass future architecture.

Suggested feature state:

```ts
type FeatureAvailability =
  | "available"
  | "placeholder"
  | "disabled";
```

Example:

```ts
registerView({
  id: "relations",
  location: "sidebar",
  availability: "placeholder"
});
```

Placeholder example:

```text
Relations

Relation view is not available in v0.2.
This panel is reserved for future structural graph features.
```

---

# 6. Top Menu / Project Bar

The top bar spans the full application width.

## 6.1 Logo

Position: top-left.

Behavior:

- displays the TeXWeave logo;
- clicking returns to the Project Directory / main page;
- if current changes are unsaved, existing save/dirty-state rules must still apply.

The logo is navigation, not project deletion/closing.

---

## 6.2 File Menu

The `File` menu contains project-level and file-level operations.

Proposed entries:

```text
File
├── New File
├── Open File...
├── Save
├── Save All
├── Duplicate Project
├── Export
│   ├── ZIP
│   ├── PDF
│   └── Markdown
├── Reveal Project in Explorer
└── Close Project
```

Notes:

- Some export operations may be placeholders in v0.2.
- `Export Markdown` may remain disabled until the conversion backend exists.
- Project duplication must eventually define whether internal metadata/history is copied.

---

## 6.3 Edit Menu

Suggested entries:

```text
Edit
├── Undo
├── Redo
├── Cut
├── Copy
├── Paste
├── Select All
├── Find
└── Replace
```

Future additions:

```text
Comment / Uncomment
Duplicate Line
Move Line
Format
```

All entries should dispatch commands through the shared command system.

---

## 6.4 View Menu

`View` is a major control point.

It should manage both **what content is displayed** and **how the workspace is arranged**.

Suggested structure:

```text
View
├── Workspace
│   ├── Source
│   ├── Preview
│   └── PDF
│
├── Layout
│   ├── Single Pane
│   └── Split Pane
│
├── Sidebar
│   ├── Show Sidebar
│   ├── Files
│   ├── Search
│   └── AI Editor
│
├── Panels
│   ├── Problems
│   ├── Output
│   ├── Compile Log
│   └── Versions
│
└── Editor
    ├── Show Tabs
    └── Show Quick Toolbar
```

Preview may be a placeholder in v0.2.

---

## 6.5 Project Name / Project Switcher

The center of the top bar displays the current project name.

Example:

```text
PPAR Paper ▼
```

Clicking opens a project switcher:

```text
Recent Projects
──────────────
PPAR Paper       ✓
Copula Test
Nonlinear ICA
──────────────
All Projects
```

Purpose:

- quick project switching;
- avoid returning to the main project screen for routine switching.

Project settings should remain separate.

---

## 6.6 History / Version

A visible top-level entry should expose editing history and named versions.

Conceptually:

```text
History
├── Automatic History
└── Named Versions
```

Automatic History:

- local recovery/history states;
- generated automatically.

Named Versions:

- user-created semantic checkpoints;
- analogous to named labels/snapshots;
- restorable.

Example:

```text
Current

Today 19:42
Auto save

Today 18:13
Version: Before rewrite

Sep 16
Version: Stable theorem version
```

Restore actions must preserve the existing safety rule: create a recoverable state before destructive restoration.

---

## 6.7 Save Status

The top bar displays save state:

```text
Saved ✓
Saving...
Unsaved ●
Save failed !
```

The status item is interactive.

Clicking it can open:

```text
Auto Save
├── Off
├── After Delay
└── On Focus Change

Save Now
Auto Save Settings...
```

Avoid a large permanent Save button in the main editor toolbar.

---

# 7. Activity Bar

The Activity Bar is the narrow vertical bar on the far left.

## 7.1 Main Items

Recommended v0.2 order:

```text
Files
Search
AI Editor




Settings
Help
```

Top items are workflow/navigation entries.

Bottom items are application-level utilities.

Future additions may include:

```text
References
Relations / Graph
Git
```

## 7.2 Activation Behavior

Only one Sidebar activity should be active at a time.

Example:

```text
Files active
→ File Sidebar visible

Search active
→ Search Sidebar visible

AI Editor active
→ AI Sidebar visible
```

Clicking the currently active activity again:

```text
→ collapse Sidebar
```

When Sidebar is collapsed, the Activity Bar remains visible.

AI Editor may be a placeholder in v0.2.

---

# 8. File Sidebar

The default Sidebar state is `Files`.

Its internal layout:

```text
FILES                 +  🔍  ‹
──────────────────────────────
File Tree
──────────────────────────────
Outline | Relations
```

Both vertical and horizontal sub-layout sizes should be resizable.

---

## 8.1 Files Toolbar

Header:

```text
FILES                 +  Search  Collapse
```

### Create Button

The first button opens:

```text
New File
New Folder
Import File...
```

Use `Import File` instead of `Upload File`, because TeXWeave is a local desktop application.

### File Tree Search

The second button filters/searches the project file tree.

This is different from the global project-content Search activity.

Its purpose is mainly for very large projects.

### Collapse Sidebar

The third control closes the Sidebar.

When closed:

- the Files activity loses its active highlight;
- clicking Files again restores it;
- the previous sidebar width should be restored.

---

# 9. File Tree

The File Tree shows the current local project structure.

Example:

```text
main.tex
reference.bib
chapters/
figures/
```

## 9.1 Folder Interaction

Folders can be expanded/collapsed.

The entire File Tree section can also be collapsed independently.

When collapsed:

```text
FILES
────────────
Outline / Relations
```

The horizontal splitter immediately moves under the File Tree toolbar.

When restored:

- restore the previous File Tree height;
- do not reset to a hard-coded default every time.

---

## 9.2 Context Menus

Right-click empty area:

```text
New File
New Folder
Import File...
Refresh
Reveal in Explorer
```

Right-click file:

```text
Open
Open to Side
Rename
Duplicate
Delete
Reveal in Explorer
Set as Main File
```

Right-click folder:

```text
New File
New Folder
Rename
Delete
Reveal in Explorer
```

---

## 9.3 Main File Indicator

The compilation root should be visually identifiable.

Example:

```text
★ main.tex
```

or another unobtrusive main-file icon.

Context menu:

```text
Set as Main File
```

---

## 9.4 Temporary vs Pinned Files

Recommended behavior:

```text
single click
→ temporary preview tab

double click
→ pinned tab
```

If a temporary tab is open and another file is single-clicked, the temporary tab may be replaced.

Pinned tabs persist.

---

# 10. Outline / Relations Section

Below the File Tree is a mutually exclusive tab area:

```text
Outline | Relations
```

The control can be compact.

The divider between File Tree and this area must be vertically draggable.

---

## 10.1 Outline

Default mode:

```text
Outline by: Sections
```

Default structure is based on LaTeX section hierarchy:

```text
Introduction
  Motivation
Model
  Definition
Estimation
```

Future outline categories:

```text
Sections
Theorems
Definitions
Lemmas
Equations
Figures
Tables
Labels
Custom Blocks
```

v0.2 should implement only the categories supported by the existing parser.

Unsupported categories may appear disabled or omitted.

---

## 10.2 Relations

Relations is reserved for the future relation-graph system.

In v0.2:

- keep the tab;
- keep the view registry entry;
- keep state/route interfaces;
- display a placeholder.

Example:

```text
Relations

Relation view is not available in v0.2.
```

Do not generate fake graph nodes.

---

# 11. Main Workspace

The Workspace supports both single-pane and split-pane layouts.

Core pane types:

```ts
type PaneType =
  | "source"
  | "preview"
  | "pdf";
```

---

# 12. Split-Pane Rules

Allowed combinations:

```text
Source  | Preview
Source  | PDF
Preview | PDF
```

Spatial restrictions:

```text
Source:
  left side only

PDF:
  right side only

Preview:
  flexible
```

Therefore these are not valid:

```text
PDF    | Source
PDF    | Preview
Source on right
PDF on left
```

The purpose is to preserve spatial memory:

```text
source = left
final output = right
preview = intermediary/flexible
```

The central splitter must be draggable.

The split ratio must be remembered.

---

# 13. Single-Pane Modes

Supported states:

```text
Source only
Preview only
PDF only
```

## 13.1 Source Only

The Source editor occupies the entire Workspace.

The toolbar should provide quick switches to:

```text
Preview
PDF
```

Compilation remains available.

PDF-specific zoom/page controls are hidden.

## 13.2 Preview Only

Preview occupies the entire Workspace.

Quick switching to Source and PDF should remain available.

In v0.2, Preview content may be a placeholder.

## 13.3 PDF Only

PDF occupies the full Workspace.

The Source-side toolbar is not shown.

The PDF toolbar expands across the top.

---

# 14. Editor Tabs

The Source side has a tab row:

```text
main.tex ×
reference.bib ×
model.tex ×
```

Tabs must support:

- temporary state;
- pinned state;
- dirty/modified state;
- close;
- reorder;
- keyboard close;
- multiple files.

Example dirty tab:

```text
main.tex ●
```

`View → Show Tabs` may hide the entire tab strip.

Tabs should not assume that every file is `.tex`.

Potential types:

```text
.tex
.bib
.json
.png
.pdf
```

---

# 15. Source Editor

The main source editor is based on Monaco.

It should expose the v0.1 source-editing capabilities through the UI:

- syntax highlighting;
- autocomplete;
- snippets;
- labels/citations;
- folding;
- multi-cursor;
- find/replace;
- diagnostics;
- line numbers;
- file dirty state.

Diagnostics may originate from:

```text
compiler
parser
language server
linter
future AI
```

The editor only renders the unified diagnostic model.

---

# 16. LaTeX Quick Toolbar

Below the Source tab row is a quick editing toolbar.

Its purpose is **LaTeX authoring actions**, not generic editor actions already covered by menu/shortcuts.

Suggested categories:

```text
Section
Environment
Text Style
Case
Math
Figure
Table
Reference
Citation
```

Possible compact icons:

```text
§    Section
{}   Environment
T    Text Style
Ω    Math
▧    Figure
▦    Table
🔗   Reference
📖   Citation
```

Clicking an item opens a compact menu.

Example Environment menu:

```text
Equation
Align
Figure
Table
Theorem
Proof
Itemize
Enumerate
```

## 16.1 Data-Driven Requirement

Toolbar content must not be hard-coded.

Use external resources such as:

```text
resources/
├── commands.xml
├── environments.xml
├── snippets.xml
└── toolbar-actions.json
```

or a repository abstraction backed by XML/JSON/SQLite.

Example architecture:

```text
commands.xml
      ↓
CommandRepository
      ↓
LatexActionService
      ↓
Toolbar Adapter
```

The toolbar should only know about action IDs and metadata.

---

# 17. Source-Side Quick Switch

The far right of the Source toolbar may contain a quick switch.

When the right pane is PDF:

```text
Source | PDF
    ↓
Preview | PDF
```

It toggles the **left pane** between Source and Preview.

When the right pane is already Preview, this control is disabled.

In v0.2, switching to Preview may display the Preview placeholder.

---

# 18. Right-Side Toolbar

The right pane toolbar contains project build and output-related controls.

Proposed structure:

```text
[ Compile ]   Log   │  PDF controls  │  Quick Switch
```

---

## 18.1 Compile Button

Large, visually clear primary action.

States:

```text
Idle
→ Compile

Running
→ spinner + Compiling

Failed
→ error indication
```

During active compilation, the control should eventually allow cancellation / Stop if supported by the compiler service.

Compile is a **project-level command**, even if visually placed near the PDF pane.

Do not couple it directly to the PDF component.

---

## 18.2 Log Button

Shows the result of the last compilation.

Default view should prioritize:

```text
Errors
Warnings
```

The user must also be able to inspect the complete raw log.

Recommended implementation:

```text
Problems | Compile Log
```

in the Bottom Panel.

The Log button may open or focus that panel.

---

## 18.3 PDF Controls

Visible only if the right pane is PDF.

Controls:

```text
Current Page / Total Pages
Zoom Out
Zoom In
Fit Page
Fit Width
```

If the right pane is Preview, these controls are hidden.

---

## 18.4 Right-Side Quick Switch

When left pane is Source:

```text
Source | PDF
⇄
Source | Preview
```

This changes the **right pane** between Preview and PDF.

If left pane is Preview, this control is disabled where the resulting layout would violate the pane restrictions.

---

# 19. Preview

Preview is conceptually distinct from compiled PDF.

Its exact rendering semantics are intentionally not finalized for v0.2.

Possible future directions include:

- structured LaTeX reading mode;
- lightweight semantic rendering;
- HTML/Math rendering;
- source-aware reading view;
- source/preview synchronization.

## v0.2 Requirements

The UI location, routing, pane type, state model, and controls must exist.

Actual rendering may remain unavailable.

Suggested interface:

```ts
interface PreviewState {
  status:
    | "unavailable"
    | "loading"
    | "ready"
    | "error";

  sourceFile?: string;
}
```

Suggested placeholder:

```text
Preview

Preview rendering is not available in v0.2.

Planned:
• Structured LaTeX rendering
• Math rendering
• Source-aware navigation
• Source synchronization
```

---

# 20. PDF Pane

If the v0.2 backend is already capable of compiling to PDF, PDF viewing may be connected.

Otherwise, the PDF pane should also support a clean placeholder state.

Future capabilities:

- page navigation;
- zoom;
- fit page;
- fit width;
- source → PDF synchronization;
- PDF → source synchronization;
- SyncTeX.

---

# 21. Bottom Panel

A collapsible panel at the bottom of the Workspace.

Tabs:

```text
Problems
Output
Compile Log
Versions
```

The panel is collapsed by default unless a task requires attention.

Example:

```text
Problems
────────────────────────────────────────
⚠ main.tex:42 Undefined reference `eq:model`
⚠ main.tex:87 Overfull \hbox
```

Clicking a diagnostic jumps to the corresponding source location.

This completes the core loop:

```text
Source
  ↓
Compile
  ↓
Diagnostics
  ↓
Problems
  ↓ click
Source location
```

---

# 22. Compile Status Indicator

The interface should show compact build status, for example:

```text
✓ Last compile succeeded       0 errors · 2 warnings
```

Clicking errors/warnings should open/focus the Problems panel.

Build status must not rely only on color.

Use icon + text.

---

# 23. Status Bar

Recommended compact bottom status bar.

Example:

```text
main.tex   Ln 142, Col 8   UTF-8   LF   XeLaTeX   ✓ Build   0 errors  2 warnings
```

Potential future status items:

```text
Git
AI
Language Server
SyncTeX
```

The Status Bar should remain compact and secondary.

---

# 24. Resizable Layout

The following dividers must be draggable:

```text
Sidebar | Workspace
File Tree / Outline-Relations
Left Workspace Pane | Right Workspace Pane
Workspace / Bottom Panel
```

State to remember:

```text
sidebarWidth
fileTreeHeight
splitRatio
bottomPanelHeight
```

Collapsed components should restore their previous sizes rather than reset to defaults.

---

# 25. Layout Persistence

Suggested state model:

```ts
interface WorkspaceState {
  mode: "single" | "split";

  leftPane?: PaneType;
  rightPane?: PaneType;

  sidebarVisible: boolean;
  sidebarMode:
    | "files"
    | "search"
    | "ai";

  tabsVisible: boolean;
  quickToolbarVisible: boolean;

  fileTreeVisible: boolean;

  sidebarWidth: number;
  fileTreeHeight: number;
  splitRatio: number;
  bottomPanelHeight: number;

  bottomPanelVisible: boolean;
  bottomPanelTab?:
    | "problems"
    | "output"
    | "compileLog"
    | "versions";
}
```

Workspace layout may eventually be stored per project or per user preset.

---

# 26. Command System

UI elements must not directly call business logic wherever avoidable.

Define reusable commands:

```text
project.open
project.switch
project.close

file.new
file.save
file.saveAll
file.rename

edit.undo
edit.redo
edit.find
edit.replace

latex.compile

history.open
version.create
version.restore

view.source
view.preview
view.pdf
view.toggleSidebar
view.toggleBottomPanel
```

Menus, buttons, keyboard shortcuts, command palette, future AI tools, and plugins should dispatch the same commands.

---

# 27. View Registry

Views should be registered rather than permanently hard-coded into the app shell.

Example concept:

```ts
interface ViewRegistration {
  id: string;
  titleKey: string;
  location:
    | "sidebar"
    | "workspace"
    | "bottom";

  availability:
    | "available"
    | "placeholder"
    | "disabled";
}
```

Examples:

```text
files
search
aiEditor
outline
relations
source
preview
pdf
problems
compileLog
versions
```

---

# 28. Panel Registry

Bottom and auxiliary panels should follow the same model.

Example:

```ts
registerPanel({
  id: "problems",
  location: "bottom"
});
```

Future modules should be able to register without rewriting the Workbench shell.

---

# 29. Feature Registry

Recommended general abstraction:

```ts
interface FeatureRegistration {
  id: string;
  titleKey: string;
  icon?: string;

  availability:
    | "available"
    | "placeholder"
    | "disabled";

  enabled: boolean;
}
```

This separates:

```text
not implemented
```

from:

```text
implemented but disabled by user
```

---

# 30. Search Sidebar

When the Search Activity is active, the Sidebar content changes completely.

v0.2 minimum structure:

```text
SEARCH
────────────────────────
[ Search input ]
```

The exact advanced search behavior can be implemented later.

Possible future options:

- project-wide text search;
- regex;
- case sensitive;
- file filters;
- replacement;
- symbol search.

If backend search is incomplete, retain only the frame and show a placeholder.

---

# 31. AI Editor Sidebar

AI Editor is a reserved first-class Activity Bar item.

In v0.2:

- UI entry exists;
- Sidebar route exists;
- layout state supports it;
- no fake AI conversation should be shown.

Placeholder example:

```text
AI Editor

AI-assisted project editing is not available in v0.2.
```

Future AI context may include:

```text
current selection
current file
current block
current section
project structure
related blocks
compiler diagnostics
```

---

# 32. Settings

Settings button is located near the bottom of the Activity Bar.

Settings architecture should eventually include:

```text
General
Appearance
Editor
LaTeX
Compiler
Shortcuts
Language
Storage
```

For v0.2, sections without implementation may be placeholders.

Language and Theme entries should exist architecturally even if only:

```text
Language: English
Theme: Light
```

are available.

---

# 33. Help

The bottom-most Activity Bar item is Help.

Possible v0.2 entries:

```text
Documentation
Keyboard Shortcuts
About TeXWeave
Report Issue
```

Unimplemented external links may remain disabled.

---

# 34. Main v0.2 Visual Goal

The first theme should be bright and calm.

Design vocabulary:

- white and silver surfaces;
- blue/cyan accents;
- thin borders;
- restrained shadows;
- clear hierarchy;
- modern research-tool feel;
- minimal decoration inside the editor workbench itself;
- visual emphasis on content rather than branding.

The Project Directory may be more visually decorative than the editor workspace.

The editor workspace should remain functional and relatively dense.

---

# 35. Accessibility / Interaction Notes

Even in v0.2:

- active state should not rely on color only;
- focus state must be visible;
- keyboard navigation should be possible for menus and tabs;
- icons should have tooltips;
- disabled controls should explain why they are disabled when useful;
- text contrast should remain readable across themes;
- draggable splitters should have a sufficiently large interaction target even if visually thin.

---

# 36. v0.2 Implementation Scope

## Must Work

```text
Project switching shell
Files Sidebar
File Tree
Source Editor
Editor Tabs
Basic Outline where parser support exists
Resizable layout
Single / Split Workspace
Compile command
Compile status
Problems / Compile Log shell
Save state
History / Versions access shell
View switching
Layout persistence
i18n infrastructure
theme infrastructure
```

## May Be Partial

```text
PDF viewer
Advanced outline categories
History UI details
Version comparison
Advanced project search
```

## Placeholder / Framework Only

```text
Preview rendering
Relations graph
AI Editor
Advanced references panel
Git UI
Cloud / collaboration
Advanced PDF-source synchronization
```

---

# 37. Suggested Source Layout

```text
src/
├── main/
│   ├── main.ts
│   ├── ipc/
│   ├── compiler/
│   ├── projects/
│   └── filesystem/
│
├── preload/
│   └── preload.ts
│
└── renderer/
    ├── App.tsx
    │
    ├── workbench/
    │   ├── Workbench.tsx
    │   ├── ActivityBar/
    │   ├── Sidebar/
    │   ├── Workspace/
    │   ├── BottomPanel/
    │   └── StatusBar/
    │
    ├── features/
    │   ├── files/
    │   ├── search/
    │   ├── ai-editor/
    │   ├── source-editor/
    │   ├── preview/
    │   ├── pdf/
    │   ├── compile/
    │   ├── versions/
    │   └── relations/
    │
    ├── commands/
    ├── registries/
    ├── i18n/
    │   └── locales/
    │       └── en.json
    │
    ├── themes/
    │   └── light.css
    │
    └── styles/
        └── tokens.css
```

---

# 38. Core Architectural Rule

The most important v0.2 rule is:

> Build a complete, extensible Workbench shell before attempting to fully implement every future feature.

The desired evolution is:

```text
v0.1
Core Engine
    ↓
v0.2
Workbench Shell + Real Source Editing
    ↓
v0.3+
Preview / PDF integration / advanced structure
    ↓
Later
Relations / AI / semantic document model
```

A future module should ideally be added by:

```text
register feature
register view
register command
connect service
```

rather than by modifying the global application layout.

---

# 39. Acceptance Criteria

The v0.2 UI architecture can be considered successful when:

1. A user can open a project and see its files.
2. A file can be opened in the Source editor.
3. Multiple files can be handled through tabs.
4. The Sidebar can be opened, closed, switched, and resized.
5. File Tree and Outline areas can be resized.
6. Workspace can switch between supported single/split states.
7. Split ratio is draggable and remembered.
8. Compile can be triggered through the UI.
9. Compiler errors/warnings can be surfaced through Problems/Log UI.
10. Save state is visible.
11. History/Version entry exists and can connect to the v0.1 backend.
12. Preview, Relations, and AI Editor exist as honest placeholders.
13. All visible strings use i18n keys.
14. The default theme uses CSS variables/design tokens.
15. Replacing the theme does not require rewriting React component logic.
16. No unimplemented feature pretends to be functional.
17. Future features can be inserted through registries instead of structural rewrites.

---

# 40. Non-Goals for v0.2

v0.2 does **not** need to solve:

- final Preview semantics;
- full semantic relation graph;
- AI-assisted writing;
- collaboration;
- cloud storage;
- complete Git interface;
- final dark theme;
- complete multilingual translations;
- full reference-management system;
- final production visual polish.

The goal is a robust UI skeleton with real core editing workflows and clean expansion points.

---

**Working product name:** TeXWeave  
**Document purpose:** UI/Workbench implementation baseline for Codex and future development.
