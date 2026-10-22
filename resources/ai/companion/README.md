# Companion skills

This library is separate from project-writing skills in `resources/ai/skills`. The pet has independent global conversations and works with or without an open project. It shares the application's Copilot and Codex services, software-wide sign-in state, and model preferences. The pet and project assistants use the same Capability Registry and operation gateway. Their history, scope and skill libraries remain separate. The short read-only core is included; enabled extensions are listed by name and description and read only when relevant.

| File | Purpose |
| --- | --- |
| `core/SKILL.md` | Included as the short foundation in pet requests; defines identity, boundaries, and discovery. Read-only through application interfaces. |
| `skills/companion-settings/SKILL.md` | Ordinary preferences, scope, validation, and undo. |
| `skills/companion-presets/SKILL.md` | Generate, save, apply, and export named configurations. |
| `skills/companion-themes/SKILL.md` | Discover, derive, create and activate local CSS themes with adaptive semantic colors; undo activation through the setting operation. |
| `skills/companion-blocks/SKILL.md` | Read and save validated custom block definitions. |
| `skills/companion-commands/SKILL.md` | Read and save standalone command dividers, placeholders and spacers; distinguish preview configuration from LaTeX macros. |

Manage extensions at **Settings → AI → Advanced → AI skills → Pet skills**. Users can add, edit, and disable extensions. Project skills remain separate. User files live under Electron's user-data directory at `ai/companion/skills/<name>/SKILL.md`; disabled names are saved separately. Editing a bundled extension creates a user copy. The core always comes from bundled resources. This read-only protection is enforced by the application and does not prevent an administrator from editing installed files.

Discovery returns names and descriptions only. The AI reads individual enabled bodies through the registry. The GUI library retains its `skills.prepare(names)` helper, but AI requests never call it to preload all extensions. Enabled does not mean automatically loaded or executed. Instructions cannot grant permissions, and workflows for unsupported operations must explain the relevant GUI instead of claiming execution.

Block and command workflows use `customization.blocks.list/read/upsert` and `customization.commands.list/read/upsert`. Read a selected definition and send a partial patch; do not upload full catalogs. Updates require the returned revision, and creation uses an unused id. New blocks derive from a selected base definition with a new match rule. Both use the existing settings validator, explicit scope, permission gateway, compact operation reports and conflict-safe Undo. They do not add project macros or execute user scripts.

The foundation and compact index are injected when starting a native conversation. Unchanged continuations send only the new user message; changed context receives one replacement update, without replaying native history. Session-bound prompt fingerprints persist across application restarts. Extension metadata is refreshed each turn; the immutable bundled core is read once per service lifetime. A replacement provider session receives the foundation and bounded restored history again.

Each extension needs YAML frontmatter within its first 4 KiB, a matching lowercase ASCII name (letters, digits, and hyphens; at most 48 characters), a one-line description (at most 1000 characters), and a total size of at most 128 KiB. Instructions describe behavior; they cannot grant permissions or add executable plugins.

```markdown
---
name: my-preferences
description: My preferred interface and writing conventions.
---

Apply these preferences only when relevant to the user's request.
```

See [API documentation](../../../docs/COMPANION_API.md) for the integration contract.
