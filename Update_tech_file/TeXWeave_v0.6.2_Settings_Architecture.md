# TeXWeave v0.6.2 — Settings Architecture Refactor

## 1. Overview

v0.6.2 restructures the Settings system to improve clarity, scalability, and navigation as TeXWeave continues to accumulate more configuration options.

The current Settings window mixes three fundamentally different types of content:

1. **Common settings**  
   Frequently used, easy-to-understand preferences such as font size, word wrap, theme, default compiler, auto-save, and AI permission mode.

2. **Large management interfaces**  
   Pages such as Block Environments, Style Resources, Theme management, AI Skills, and LaTeX Toolchain detection. These are not merely “settings”; they are effectively standalone management tools with their own complex UI.

3. **Fine-grained parameters**  
   Detailed options such as acceleration strength, snapshot retention, label prefixes, compiler arguments, thresholds, cache behavior, and other low-level controls.

v0.6.2 separates these responsibilities into three concepts:

- **Basic Settings**
- **Advanced Settings**
- **Managers**

The key principle is:

> **Basic / Advanced describe configuration complexity. Managers describe interaction form.**

Managers are therefore not treated as a third settings complexity level.

---

## 2. Goals

### 2.1 Primary goals

- Reduce the number of permanent entries in the Settings sidebar.
- Keep common options easy to find.
- Move detailed parameters out of the default view.
- Remove large management interfaces from the normal settings hierarchy.
- Add global Settings search.
- Make the Settings architecture scalable for future features.
- Preserve all current functionality during the v0.6.2 refactor.

### 2.2 Non-goals

v0.6.2 does **not** redesign every manager interface.

Existing pages may continue to be used temporarily for:

- Theme management
- Dictionaries / spell-check resources
- Keyboard shortcuts
- Block environments
- Style resources
- LaTeX toolchain
- AI skills

The only mandatory manager-level change in v0.6.2 is:

> **Every Manager page must provide a clear “Back to Settings” action.**

The internal UI of each Manager will be improved separately in later updates.

---

## 3. Core Information Architecture

The Settings window is reorganized around a reduced set of top-level domains.

```text
Settings
├─ General
├─ Appearance
├─ Editor
├─ Preview
├─ Project
├─ Build
└─ AI
```

These top-level sections remain stable whether the user is viewing Basic or Advanced settings.

### 3.1 Complexity switch

The Settings header provides a two-state control:

```text
[ Basic | Advanced ]
```

Switching between Basic and Advanced:

- keeps the current top-level section selected where possible;
- does not change the sidebar structure;
- changes which configuration items are shown inside that section.

Example:

```text
Basic > Project
Advanced > Project
```

Both refer to the same domain, but expose different levels of detail.

---

## 4. Basic Settings

Basic Settings contain options that satisfy most of the following:

- commonly changed;
- easy to understand without internal implementation knowledge;
- directly affect normal workflow;
- safe to expose prominently;
- can be represented as a simple control.

Typical controls include:

- checkbox;
- select;
- number input;
- text input;
- simple path selector;
- compact action row.

### 4.1 Example: Editor

```text
Editor

Font
────────────────────────────
Font family              Inter
Font size                   15

Editing
────────────────────────────
Word wrap                   On
Tab size                     2
Automatic symbol pairing    On
Document word completion    On

Preview editing
────────────────────────────
Math preview on hover      Off
Confirm modified edits      On

Keyboard
────────────────────────────
Keyboard shortcuts    Manage ›
```

The goal is that a normal user can open Settings and immediately understand most of the visible controls.

---

## 5. Advanced Settings

Advanced Settings contain options that are valid and useful, but are either:

- rarely changed;
- implementation-sensitive;
- performance-related;
- highly specific;
- easier to misuse;
- intended mainly for users who understand their effect.

Examples:

- render debounce;
- cache configuration;
- virtualization thresholds;
- acceleration strength;
- maximum scroll speed;
- snapshot retention;
- label prefixes;
- compiler arguments;
- executable overrides;
- diagnostics;
- environment variables;
- low-level search behavior.

### 5.1 Example: scrolling

Basic:

```text
Smooth accelerated scrolling    On
```

Advanced:

```text
Scrolling
────────────────────────────
Acceleration strength        4
Maximum speed               6×
Slowdown time            500 ms
```

The top-level category remains `General`; only the level of detail changes.

---

## 6. Managers

Some current Settings pages are too large or too interactive to behave like ordinary settings.

These should become **Managers**.

Managers are dedicated configuration tools launched from the relevant Settings domain.

### 6.1 Manager list for v0.6.2

The following existing pages are reclassified as Managers:

- **Theme Manager**
- **Dictionary Manager**
- **Shortcut Manager**
- **Block Environment Manager**
- **Style Resource Manager**
- **LaTeX Toolchain Manager**
- **AI Skill Manager**

Additional managers may be introduced later if a settings page grows beyond normal settings-page complexity.

### 6.2 Manager entry pattern

Managers are opened from normal Settings rows.

Example:

```text
Appearance

Theme
────────────────────────────
Active theme            Light

                   Manage themes ›
```

Example:

```text
Project

Block environments
Configure semantic Preview blocks.

                         Manage ›
```

### 6.3 Temporary implementation policy

For v0.6.2:

- reuse the existing page implementation;
- do not require visual redesign of manager contents;
- do not require unified manager internals yet;
- retain all current functionality;
- route the page through the new Manager navigation model.

### 6.4 Mandatory Back action

Every Manager page must contain a visible:

```text
‹ Back to Settings
```

or equivalent button.

Behavior:

- returns to the Settings section from which the Manager was opened;
- restores the previous Basic / Advanced mode;
- preserves Settings scope where applicable;
- should not discard unsaved manager changes without confirmation.

Recommended location:

- top-left of the Manager content header.

Example:

```text
‹ Back to Settings

Block Environment Manager
```

---

## 7. Settings Header

The current header contains too many permanently visible maintenance actions.

The v0.6.2 header should move toward:

```text
Settings

[ Search settings... ]    [ Global ▾ ] [ Basic | Advanced ] [ ⋯ ] [ × ]
```

### 7.1 Header elements

#### Search

Persistent search field:

```text
Search settings...
```

#### Scope

Existing global/project scope remains available:

```text
Global settings ▾
Project settings ▾
```

Exact wording may follow current implementation.

#### Complexity

```text
Basic | Advanced
```

#### Overflow menu

Move low-frequency actions into `⋯`:

```text
Reset current section
Restore all defaults
Export settings
Import settings
```

Additional maintenance actions may be added later.

#### Close

Keep the existing close button.

---

## 8. Search

Settings search becomes a first-class navigation feature.

Search must cover:

- Basic settings;
- Advanced settings;
- Manager entries.

### 8.1 Search result types

A result may point to:

1. a directly editable Basic setting;
2. a directly editable Advanced setting;
3. a Manager entry.

Example query:

```text
label
```

Possible results:

```text
Editor
Automatically create environment labels            On

Project > Images                         Advanced
Image label prefix                                fig

Project > Tables                         Advanced
Table label prefix                                tab

Block Environment Manager
Environment label rules                       Open ›
```

### 8.2 Advanced results

Advanced settings must still appear in search even when the user is currently in Basic mode.

They should be marked with:

```text
Advanced
```

Selecting the result may either:

- open the relevant Advanced section automatically; or
- display/edit the result directly from search.

The implementation may choose the simpler approach for v0.6.2.

### 8.3 Manager results

Manager results should be marked with:

```text
Manager
```

Selecting them opens the existing Manager page.

### 8.4 Search metadata

Each setting should ideally expose searchable metadata such as:

```ts
interface SettingDefinition {
  id: string;
  category: SettingsCategory;
  title: string;
  description?: string;
  keywords?: string[];
  level: "basic" | "advanced";
}
```

Managers should also be searchable by:

- display name;
- description;
- aliases;
- relevant feature names.

---

## 9. Sidebar

The current sidebar contains too many sub-pages.

v0.6.2 reduces it to stable domains:

```text
GENERAL
  General
  Appearance

EDITING
  Editor
  Preview

PROJECT
  Project

BUILD
  Build

AI
  AI
```

A visually flatter version is also acceptable:

```text
General
Appearance
Editor
Preview
Project
Build
AI
```

The exact group labels may remain flexible, but the number of persistent navigation items should be substantially reduced.

Manager pages must **not** remain permanent first-level Settings sidebar items.

---

## 10. Current Page Migration

### 10.1 General

Current content:

- auto-save;
- hide build artifacts;
- restore last project;
- start maximized;
- right-side panel behavior;
- accelerated scrolling.

Migration:

**Basic > General**

- auto-save;
- hide build artifacts;
- restore last project at startup;
- start maximized;
- right-side panel behavior;
- enable accelerated scrolling.

**Advanced > General**

- acceleration strength;
- maximum scrolling speed;
- slowdown time;
- future startup/debug/internal options.

---

### 10.2 Appearance

Current content:

- active theme;
- imported CSS themes;
- scanned theme folder;
- theme refresh;
- import CSS/folder.

Migration:

**Basic > Appearance**

- active theme;
- UI scale;
- interface density;
- future appearance-level preferences.

**Theme Manager**

- built-in themes;
- imported themes;
- import CSS;
- import folder;
- scanned theme folder;
- delete theme;
- refresh themes.

For v0.6.2, reuse the current theme page and add `Back to Settings`.

---

### 10.3 Language

The current dedicated `Language` sidebar page should be folded into General.

**Basic > General**

- interface language.

Language no longer requires its own permanent sidebar entry.

---

### 10.4 Editor

Current content includes:

- font size;
- word wrap;
- tab size;
- symbol pairing;
- math preview;
- document word completion;
- automatic labels;
- preview edit confirmations;
- other fine-grained editor behavior.

Migration:

**Basic > Editor**

- font family / font size;
- word wrap;
- tab size;
- automatic symbol pairing;
- document word completion;
- math preview on hover;
- common preview-edit behavior.

**Advanced > Editor**

- detailed completion behavior;
- label generation rules;
- detailed preview-edit safeguards;
- diagnostics or fine-grained editor behavior.

---

### 10.5 Search & Filter

The current page is small enough to remain normal Settings content.

Migration should depend on semantic ownership:

**Basic > Preview**

- commonly visible structural filter groups.

**Advanced > Preview**

- detailed structural-search behavior;
- future filter-depth or relation-specific defaults.

Avoid keeping `Search & Filter` as a permanent top-level sidebar page.

---

### 10.6 Spell Checking

Current page contains both common preferences and resource management.

Split it.

**Basic > Editor**

- spell-check mode;
- automatic/manual language behavior;
- selected language.

**Advanced > Editor**

- provider behavior;
- detailed detection behavior;
- ignore rules;
- future grammar/spell-check thresholds.

**Dictionary Manager**

- provider status;
- installed dictionaries;
- Chinese rules package;
- download / repair actions;
- language package installation;
- resource availability.

For v0.6.2, reuse the current spell-resource page where practical.

---

### 10.7 Shortcuts

Shortcut configuration is a Manager.

**Basic > Editor**

```text
Keyboard shortcuts    Manage ›
```

**Shortcut Manager**

- current shortcut list;
- reference link modifier;
- editing;
- reset individual shortcut;
- conflict detection in future versions.

For v0.6.2, reuse the existing Shortcuts page and add `Back to Settings`.

---

### 10.8 Images

Split into common defaults and detailed LaTeX generation controls.

**Basic > Project**

- default image width;
- default insertion type;
- add caption;
- add label;
- alignment where appropriate.

**Advanced > Project**

- project image directory;
- placement string;
- label prefix;
- lower-level generated-LaTeX defaults.

No separate Manager is required at this stage.

---

### 10.9 Tables

**Basic > Project**

- default table style;
- alignment;
- first row as header;
- add caption;
- add label;
- default editor mode.

**Advanced > Project**

- float placement;
- label prefix;
- automatic fixed-width conversion;
- low-level table-generation parameters.

No separate Manager is required at this stage.

---

### 10.10 Version History

**Basic > Project**

- automatic snapshots;
- snapshot before restore;
- snapshot before large delete.

**Advanced > Project**

- minimum snapshot interval;
- maximum snapshots;
- retention days;
- future cleanup policy.

Version History does not require a dedicated Manager in v0.6.2 unless future functionality expands significantly.

---

### 10.11 Block Environments

Reclassify the current page as:

**Block Environment Manager**

Entry:

```text
Project

Block environments
Configure which LaTeX structures become Preview blocks.

                         Manage ›
```

Manager keeps the existing interface for v0.6.2:

- built-in block list;
- custom blocks;
- enable / disable;
- identity and family;
- source type;
- appearance;
- advanced XML;
- add environment.

Add:

```text
‹ Back to Settings
```

---

### 10.12 Style Resources

Reclassify as:

**Style Resource Manager**

Entry:

```text
Project

Style resources
Manage reusable local LaTeX resources.

                         Manage ›
```

Reuse the current page for v0.6.2.

Add:

```text
‹ Back to Settings
```

---

### 10.13 Compiler / Toolchain

Split normal preferences from system management.

**Basic > Build**

- default engine;
- automatic compilation;
- common build mode.

**Advanced > Build**

- compiler arguments;
- timeout;
- executable override;
- environment variables;
- detailed build configuration.

**LaTeX Toolchain Manager**

- detected distribution;
- installation path;
- executable discovery;
- pdfLaTeX;
- XeLaTeX;
- LuaLaTeX;
- latexmk;
- BibTeX;
- Biber;
- MakeIndex;
- recheck;
- locate executable;
- locate directory.

For v0.6.2, reuse the current Local LaTeX Toolchain page.

Add:

```text
‹ Back to Settings
```

---

### 10.14 AI Assistant

**Basic > AI**

- default AI mode;
- default permissions;
- common review behavior.

**Advanced > AI**

- context limits;
- block-selection behavior;
- future low-level provider / execution options.

No dedicated Manager required for these common settings.

---

### 10.15 AI Skills

Reclassify as:

**AI Skill Manager**

Entry:

```text
AI

AI skills
Manage project instructions used by AI tools.

                         Manage ›
```

For v0.6.2, reuse the current Project Skills page.

Add:

```text
‹ Back to Settings
```

---

## 11. Reset Behavior

The current UI shows a permanent `Reset` button for nearly every setting.

This creates unnecessary visual noise.

### 11.1 Per-setting reset

Recommended behavior:

- if the value equals its inherited/default value, hide reset;
- show reset on row hover; or
- show reset persistently only when the value differs from default.

Example:

Default:

```text
Word wrap                             ☑
```

Modified:

```text
Word wrap                             ☑  ↶
```

### 11.2 Section reset

`Reset section` remains supported but moves to the header overflow menu.

### 11.3 Restore defaults

`Restore defaults` also moves to the overflow menu.

This action must require confirmation.

---

## 12. Scope Behavior

The existing Global / Project setting scope must be preserved.

The new architecture must not break inherited values.

Recommended conceptual model:

```text
Built-in default
      ↓
Global value
      ↓
Project override
```

A project-level reset should restore the inherited Global value rather than necessarily restoring the built-in default.

The existing footer explanation may be retained or refined.

Example:

```text
Changes are saved automatically.
Project Reset restores the inherited global value.
```

---

## 13. Navigation Behavior

### 13.1 Opening a Manager

When the user opens a Manager, store:

```ts
interface SettingsReturnContext {
  category: SettingsCategory;
  mode: "basic" | "advanced";
  scope: "global" | "project";
  scrollPosition?: number;
}
```

### 13.2 Returning

`Back to Settings` restores:

- previous Settings category;
- Basic / Advanced state;
- Global / Project scope;
- optionally previous scroll position.

This makes Managers feel like child pages rather than unrelated windows.

---

## 14. Suggested Component Model

The refactor should move toward reusable setting definitions and generic rendering.

Possible structure:

```ts
type SettingsLevel = "basic" | "advanced";

type SettingsCategory =
  | "general"
  | "appearance"
  | "editor"
  | "preview"
  | "project"
  | "build"
  | "ai";

interface SettingDefinition<T = unknown> {
  id: string;
  category: SettingsCategory;
  level: SettingsLevel;

  title: string;
  description?: string;
  keywords?: string[];

  scope: "global" | "project" | "both";

  control:
    | "boolean"
    | "number"
    | "text"
    | "select"
    | "slider"
    | "path"
    | "action";

  defaultValue: T;
}
```

Managers may use a separate definition:

```ts
interface SettingsManagerDefinition {
  id: string;
  category: SettingsCategory;
  title: string;
  description: string;
  keywords?: string[];
  route: string;
}
```

This enables:

- sidebar generation;
- search;
- Basic / Advanced filtering;
- manager discovery;
- consistent reset behavior.

---

## 15. Visual Density

v0.6.2 should reduce unnecessary vertical and horizontal noise.

### 15.1 Standard row

Recommended normal setting row:

```text
Setting title                       Control
Optional description
──────────────────────────────────────────
```

Avoid permanent reset-button columns.

### 15.2 Manager row

Recommended compact manager entry:

```text
[icon] Block environments
       Configure Preview block recognition.    Manage ›
```

Manager rows should not become oversized dashboard cards unless the content genuinely requires it.

### 15.3 Grouping

Use internal groups such as:

```text
Editor

Font
──────────────────

Editing
──────────────────

Preview editing
──────────────────

Keyboard
──────────────────
```

This is preferable to creating extra sidebar entries.

---

## 16. Implementation Order

Recommended v0.6.2 implementation sequence:

### Phase 1 — Core architecture

- introduce Basic / Advanced state;
- replace old sidebar structure;
- create stable top-level categories;
- migrate existing settings to new categories.

### Phase 2 — Manager routing

- reclassify large pages as Managers;
- add manager entry rows;
- reuse current Manager pages;
- add mandatory `Back to Settings`;
- preserve return context.

### Phase 3 — Search

- index Basic settings;
- index Advanced settings;
- index Managers;
- add badges for Advanced / Manager;
- support navigation from search results.

### Phase 4 — Header cleanup

- add persistent search;
- add Basic / Advanced selector;
- retain scope selector;
- move reset / restore actions into overflow menu.

### Phase 5 — Row cleanup

- reduce permanent Reset buttons;
- unify row spacing;
- unify descriptions;
- add modified-state reset indicator.

---

## 17. Acceptance Criteria

v0.6.2 Settings refactor is considered complete when:

- [ ] Settings sidebar is reduced to stable top-level domains.
- [ ] Basic and Advanced use the same category structure.
- [ ] Basic / Advanced can be switched from the Settings header.
- [ ] Large configuration tools are opened as Managers.
- [ ] Existing Manager pages remain functional without requiring redesign.
- [ ] Every Manager has a visible `Back to Settings` action.
- [ ] Returning from a Manager restores the previous Settings context.
- [ ] Search can find Basic settings.
- [ ] Search can find Advanced settings.
- [ ] Search can find Managers.
- [ ] Advanced search results are clearly marked.
- [ ] Manager search results are clearly marked.
- [ ] Global / Project scope behavior remains intact.
- [ ] Section reset and restore-default actions remain available.
- [ ] Per-setting reset controls no longer create a permanent full-page Reset column.
- [ ] Existing settings values migrate without data loss.

---

## 18. Final Architecture Summary

```text
                      TeXWeave Settings

                ┌────────────────────┐
                │       BASIC        │
                │                    │
                │ Common, clear,     │
                │ everyday settings  │
                └─────────┬──────────┘
                          │
                    Basic / Advanced
                          │
                ┌─────────▼──────────┐
                │      ADVANCED      │
                │                    │
                │ Detailed, fine-    │
                │ grained controls   │
                └────────────────────┘


                Separate interaction form:

                ┌────────────────────┐
                │      MANAGERS      │
                │                    │
                │ Theme              │
                │ Dictionaries       │
                │ Shortcuts          │
                │ Block environments │
                │ Style resources    │
                │ LaTeX toolchain    │
                │ AI skills          │
                └────────────────────┘
```

The central rule for future development is:

> **Basic / Advanced determine how detailed a setting is.  
> Managers determine whether the task needs a dedicated interface.**

This distinction should remain stable as TeXWeave grows.
