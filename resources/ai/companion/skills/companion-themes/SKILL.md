---
name: companion-themes
description: Create, customize, and switch TeXWeave color themes, including light/dark palettes and adaptive block and command colors.
---

# Companion Themes

Use this workflow for application appearance. Project LaTeX styles and document typography belong to project-writing workflows.

## Discover and configure

Discover theme capabilities through the registry and inspect their current schemas; do not preload unrelated settings or skill bodies. The supported operations are `themes.list`, `themes.read`, `themes.create`, and `settings.theme.get/set`. Reads use the read gateway; writes require a plan and execution through the operation gateway. These descriptors also feed native tool search. Do not invoke renderer facade methods as model tools or write application files through a shell.

Read the current global theme and search the theme catalog. For switching to an existing theme, use its exact returned id with `settings.theme.set`; no CSS read is necessary. For modifying a user theme, read only that theme's CSS and create a named derivative, preserving unrelated rules. Built-in themes return metadata with `css=null`, because their CSS is compiled into the app; use the token recipe below instead of guessing a source file path.

Creation returns a new id and does not activate or overwrite anything. If the user asks to create and use a theme, create it, then plan and execute the global theme setting with that returned id. A request to create/save alone does not imply activation. Follow the configured approval mode; do not add a separate confirmation for an already authorized change. Verify saved CSS through `themes.read` or the operation's verification action, and read back the active setting after activation. These checks establish saved state, not a visual review. Report the theme name, id and whether it is active. Undo of activation uses the setting operation id; unused generated copies can be removed in the Theme manager. Do not describe creation as an undoable settings change.

## Author semantic CSS

Use a `:root` rule. Do not scope to the display name or invent a custom theme id: creation assigns the id, and the runtime loads CSS only while that theme is active. Set `color-scheme` explicitly. Cover app, panel, toolbar, subdued and hover surfaces; primary, accent, link and text colors; borders, status and feedback. Prefer existing fonts and layout sizes. For a dark palette, replace all light surfaces and matching text roles together to avoid white patches in managers, forms and preview editors. Keep normal text contrast around 4.5:1 or better and interactive boundaries distinguishable.

This compact light palette illustrates real tokens; adjust it to the requested style. For a dark theme, choose dark surface values, light text, and `color-scheme: dark`.

```css
:root {
  color-scheme: light;
  --color-bg-app: #edf5fb;
  --color-bg-app-top: #f8fcff;
  --color-bg-app-bottom: #e5f1fa;
  --color-bg-panel: #ffffff;
  --color-bg-toolbar: #f6faff;
  --color-bg-subtle: #edf4fa;
  --color-bg-hover: #dfedf8;
  --color-primary: #1679b4;
  --color-primary-strong: #105b8c;
  --color-accent: #168895;
  --color-link: var(--color-primary-strong);
  --color-link-hover: var(--color-primary);
  --color-text-primary: #183047;
  --color-text-secondary: #4c657a;
  --color-text-muted: #647a8d;
  --color-border: #ccdde9;
  --color-border-strong: #91adc2;
  --color-success: #187a53;
  --color-warning: #8e6515;
  --color-error: #b43c4a;
  --color-status-bg: #105b8c;
  --color-status-text: #f4faff;
  --shadow-panel: 0 6px 22px #19466917;
  --env-border-default: #46607830;
  --env-border-hover: #46607860;
  --env-border-selected: var(--color-primary);
  --semantic-color-mode: auto;
  --semantic-chroma-scale: 1;
  --semantic-accent-contrast: 3;
  --semantic-text-contrast: 4.5;
  --semantic-fill-mix: .04;
  --semantic-label-mix: .1;
  --semantic-border-mix: .24;
}
```

Blocks and commands derive colors from semantic seeds, surfaces, foreground and these adaptation parameters. Usually keep the adaptive mode and tune its parameters instead of assigning a separate palette to every environment. Existing user color profiles can override a theme's CSS adaptation parameters; do not silently reset those preferences to force an effect. Fixed environment role overrides remain available for an explicit request, but do not freeze all block colors by default.

Use local CSS only: no imports, URLs, external fonts, scripts or application internals. Theme creation rejects external resources and accepts at most 256 KiB. If a required operation is unavailable, explain the limitation and direct the user to Settings → Appearance → Theme rather than claiming it ran.
