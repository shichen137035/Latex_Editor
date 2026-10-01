---
name: latex-project
description: Work effectively with LaTeX projects opened in TeXWeave.
---

# TeXWeave LaTeX project

- Treat the working copy as a LaTeX project. Its `.tex` files are the content source of truth; `.texweave/structure.json` is only a structural index, not a second document.
- Locate first: use `list_blocks` or `find_blocks` (type, title/query, label, actual compiled number, or ordinal). Inspect with `get_block` / `get_blocks`, then call `get_block_source` only for the blocks needed. Do not read entire papers when block APIs can locate the target. For “edit theorem prose, keep formulas”, inspect the theorem's children and read/edit its paragraphs, leaving equation children untouched.
- Use `replace_block_content` for content blocks, with the exact source returned by `get_block_source` and its `revision` as `expectedRevision`. For environment-backed content, preserve the returned wrapper and labels. Structural blocks have no direct editable body: edit their content children instead. An empty structural block exposes a placeholder paragraph; filling it materializes the paragraph.
- Use `insert_block` for typed insertions (heading `title` is separate from body `content`). Supply `fileId` for root insertion in multi-file projects. `delete_block` deletes the complete subtree, not just the wrapper; only delete content the user asked to remove.
- On `STALE_BLOCK`, refetch the target and reconcile the newer source instead of retrying an old replacement. Preserve user changes. A content block with children produces a nonfatal warning, not permission to flatten or rewrite it. Optional summaries and separately owned user/AI tags can be updated with `set_block_semantic`; stale metadata remains a hint, not authority.
- Block tools and shell edits modify the same reviewable working copy. Use normal file edits for preambles, bibliography/style files, or operations outside the block API; inspect only the relevant files. Changes remain subject to TeXWeave's existing diff review and undo workflow.
- Preserve the project's language, document class, package choices, citation style, labels, and existing structure. Keep edits focused on the user's request.
- Keep `\begin{...}` and `\end{...}` pairs balanced. Preserve existing labels and references; update references when a requested edit changes them.
- When a build check is useful, call the TeXWeave `texweave_compile` tool. It runs the configured compiler on the AI working copy and returns build diagnostics. Do not run `latexmk`, `pdflatex`, `xelatex`, `lualatex`, `tectonic`, `arara`, `bibtex`, or `biber` through a shell; TeXWeave owns compilation and its build settings.
- Use reported file and line locations to repair LaTeX errors, then call `texweave_compile` again when appropriate. Explain any unresolved errors or warnings in the final response.
- Do not edit compiler-generated files such as `.aux`, `.log`, `.fls`, `.fdb_latexmk`, `.synctex.gz`, `.xdv`, or build-directory output as source content.
- Summarize source files changed and whether the TeXWeave build succeeded.
