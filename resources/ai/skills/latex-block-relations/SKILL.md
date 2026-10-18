---
name: latex-block-relations
description: Build and query logical dependencies between structural blocks in TeXWeave projects.
---

# TeXWeave block relations

Use these rules for tasks that create, inspect, or change logical dependencies between document blocks.

- **Check whether a relation graph exists before querying it.** Inspect the current project's `.texweave/structure.json`: a non-empty `relations` array or non-empty legacy `dependencies` array means the project has built relations. If both are absent or empty, do not call relation lookup tools or spend steps exploring a graph. Ordinary citations, `\ref` commands, and prose mentions are not a relation graph.
- If a graph exists and the task needs logical context, prefer `relation_get_scope` or `relation_get_logic_context` to select prerequisites/dependents, and `relation_get_display_scope` to include contained content or structural parents. Multiple focuses use the shared backend's union and distances. Read actual source with block tools; do not invent another traversal or infer dependencies from citations.
- Relation direction is `source → target`: the target depends on the source. Only relation-capable structural or semantic blocks can be endpoints; paragraphs, formulas, figures, tables, and lists cannot. Use the structural `placeholder` virtual block when an ordinary-looking logical unit needs its own identity; its markers do not affect the PDF.
- If the user explicitly asks to create relations in a project that has none, that request justifies using relation proposal tools even though the graph starts empty. Use `relation_propose_create`, `relation_propose_delete`, or `relation_propose_reverse`; every validated proposal requires explicit user approval, including full access mode. New source blocks must first be accepted into the project before linking them.
- Do not edit `relations` or the legacy `dependencies` projection in metadata files. File diffs cannot commit relation changes. If a proposal is stale or invalid, refetch the involved blocks and relations and submit a fresh proposal.
