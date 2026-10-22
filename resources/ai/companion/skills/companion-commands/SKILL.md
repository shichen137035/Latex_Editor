---
name: companion-commands
description: Create and configure standalone LaTeX command previews as dividers, placeholders, or spacers, with labels, placement, and adaptive colors.
---

# Companion Commands

Configure command presentation in the visual editor. A command preview is distinct from a block environment, a keyboard shortcut, a shell command, or a LaTeX macro definition. Use `companion-blocks` only for an actual environment/header configuration task.

Discover `customization.commands.list/read/upsert` and inspect the relevant schemas through the registry. Search the compact catalog, then read the selected definition only when modifying or reusing it. Scope is explicit: use global scope for application-wide changes; project scope requires a project-bound conversation, which the global pet does not have merely because a project is open.

Create with a new lowercase id, `mode: "create"`, and a `patch.match` such as `{ "kind": "command", "name": "researchbreak" }`. The command name has letters or `@` only and no leading backslash. Choose a meaningful label or localized labels. Use `divider` for a visible separator, `placeholder` for a named non-rendered operation, or `spacer` for spacing. `placement` controls ownership in implicit heading scopes: `nested` stays in the current scope, `trailing` follows its content, and `independent` switches out of implicit chapter/section ownership. These settings do not remove explicit LaTeX environment wrappers.

For example, this creates a preview separator:

```json
{
  "scope": "global",
  "id": "research-break",
  "mode": "create",
  "patch": {
    "match": { "kind": "command", "name": "researchbreak" },
    "label": "Research break",
    "display": "divider",
    "placement": "nested",
    "color": "#168895",
    "colorMode": "adaptive"
  }
}
```

For an update, send the exact id, `mode: "update"`, `expectedRevision` from the latest read, and only changed fields in `patch`. Unspecified properties, localized labels and other definitions are preserved. Built-in match names cannot be renamed. Enabled command names must be unique; use a new name or update the intended entry. Use six-digit hex seed colors and adaptive mode normally; fixed mode is available for an explicit fixed-color request. Disable an entry with `enabled: false` when recognition should stop without removing its configuration.

Use the plan/execution gateway and current approval mode. Read back the saved definition or verify the operation, and retain the operation id for Undo. Conflicts require a fresh read and plan, not replacing the entire command list. Report which command preview changed and its scope.

Saving a preview does not define a LaTeX macro, add a package, change mathematical rendering, or ensure the document compiles. Requests for `\newcommand`, macro expansion, inline citation rendering or math previews need the relevant project source/rendering workflow. Explain the boundary instead of claiming that a standalone preview definition implements those features. No scripts or executable handlers can be embedded in a command definition. If configuration is unavailable, offer the Preview commands manager.
