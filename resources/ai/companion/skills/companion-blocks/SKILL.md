---
name: companion-blocks
description: Create and configure custom block environment definitions, including matching, titles, adaptive colors, nesting, and built-in renderers.
---

# Companion Blocks

Configure the visual editor's block environment definitions. These are different from inserting or editing blocks in a document; use project block tools for document content. Standalone command dividers/placeholders belong to `companion-commands`, read only when that task is needed.

## Read a template, then patch one definition

Discover `customization.blocks.list/read/upsert` through the capability registry and inspect their schemas. List uses explicit `scope`, optional search and pagination, and returns metadata only. Read the relevant definition before changing it; reuse its exact id and revision. Choose global scope for application-wide customization. Project scope requires this conversation to have an explicit bound project; the global pet cannot infer one from the open window.

For creation, choose an existing `baseId` with the right family and renderer, give the new definition a stable unused id, and set `mode: "create"`. Supply a new `patch.match`, without a leading backslash for command or environment names. The server copies the template's style and behavior and marks the new definition as custom. Supply the requested label or localized names; do not copy another definition's display names by accident.

For updates, set `mode: "update"` and pass `expectedRevision` from the latest read. Send only requested fields under `patch`; nested style, behavior and localized-name changes preserve unspecified fields. Do not resend the catalog, set `builtIn`, or fabricate a revision. Built-in match rules cannot be renamed; derive a new custom definition instead. Avoid an enabled match already owned by another definition. On a revision or settings conflict, read current state before preparing a new plan.

For example, after discovering and reading the `remark` template, a new note environment can use these upsert arguments:

```json
{
  "scope": "global",
  "id": "research-note",
  "mode": "create",
  "baseId": "remark",
  "patch": {
    "label": "Research note",
    "match": { "kind": "latex-environment", "name": "researchnote" },
    "style": { "colorMode": "adaptive", "baseColor": "#168895" }
  }
}
```

## Preserve semantics and verify

Keep section-like headings distinct from content blocks. Preserve the template's matching form, family, nesting and source-editing behavior unless the user asks to change them. Use supported renderers and existing handler ids only: `builtin.list` provides item rendering; no arbitrary JS/TS plugin loading is available. Prefer adaptive base colors over fixed role colors; retain explicit fixed colors when requested. Typography and specialized figure/table/list options must stay within the inspected schema and shared settings validator.

Plan and execute the upsert through the normal gateway with the current permission mode. The server validates the merged definition, preserves other entries, detects intervening settings changes and returns the saved definition with its new revision. Read back that id when verification is needed. The operation report shows only the requested definition fields and supports Undo; later manual edits may cause an Undo conflict rather than being overwritten. `enabled: false` disables recognition without deleting the saved definition.

This configures preview recognition and appearance. It does not add `\newenvironment`, packages, macros or document source. If the requested LaTeX environment is not defined by the user's source or packages, explain that source work requires a bound project-writing conversation. Do not claim compilation or visual verification without the corresponding result. If the capability is unavailable, direct the user to the Block environments manager.
