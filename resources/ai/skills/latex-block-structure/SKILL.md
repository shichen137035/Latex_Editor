---
name: latex-block-structure
description: Work with TeXWeave's LaTeX block hierarchy, source structure, and block metadata.
---

# TeXWeave block structure

Use these rules when reading or editing the document through TeXWeave's block model.

- `.tex` files are the content source of truth. `.texweave/structure.json` is a derived structural index, not a second document or a routine edit target. Use block tools for source changes and `set_block_semantic` for summaries or AI-owned tags. Edit `structure.json` directly only when the user explicitly asks to repair it; preserve its schema and unrelated metadata. Do not edit other `.texweave` or `.latex-editor` internal files.
- Structural blocks are containers and have no directly editable body. Edit their content children. An empty structural block exposes a placeholder paragraph; filling it materializes the paragraph.
- Use `get_block` to inspect child structure before editing. For a request such as “revise theorem prose, keep formulas,” edit the relevant prose children and leave equation children untouched.
- Use `insert_block` for typed insertions; heading `title` is separate from body `content`. Supply `fileId` when inserting at the root of a multi-file project.
- `delete_block` removes the complete subtree, not just the wrapper; delete only content the user asked to remove. A content block with children may produce a warning. Do not flatten or rewrite its descendants to silence it.
- Use `set_block_semantic` to write summaries or AI-owned tags through the block API. Treat stale semantic metadata as a hint, not authoritative source text.
- On `STALE_BLOCK`, refetch the target and reconcile the newer source. Preserve user changes. Do not edit generated compiler files or treat derived structure metadata as source content.
