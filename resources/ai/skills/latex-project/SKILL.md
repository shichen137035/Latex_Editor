---
name: latex-project
description: Core instructions for finding, editing, and compiling LaTeX content in TeXWeave.
---

# LaTeX project basics

Use the TeXWeave project tools and working copy for project work.

- **Find content:** Use `find_blocks` or `list_blocks` to locate relevant material by text, type, title, label, number, or file. Inspect matches with `get_block` and read only the needed source with `get_block_source`. For files outside the block model, search or read only relevant files; use `texweave_list_project_files` before concluding that a file is absent.
- **Write or revise content:** Use `replace_block_range` for focused changes after fetching the latest source. Supply its revision, exact expected text, and only the replacement text. Use `replace_block_content` when replacing a whole editable content block. Use `insert_block` for requested new content. Avoid rewriting unrelated material.
- **Keep edits safe:** Work in TeXWeave's editable working copy. Preserve the document's language, class, packages, labels, citations, and style. On `STALE_BLOCK` or `BLOCK_TEXT_MISMATCH`, fetch the source again and reconcile instead of retrying stale text.
- **Compile:** When a build check is requested or useful, call `texweave_compile`, optionally specifying a project-relative `mainFile`. Read the diagnostics and use reported file and line locations to investigate errors. Recompile after relevant repairs. Never invoke LaTeX compilers from a shell; TeXWeave owns the configured build. Do not edit generated files such as `.aux`, `.log`, `.fls`, `.fdb_latexmk`, `.synctex.gz`, `.xdv`, or build output as source.
- Summarize the files and content changed, and report whether compilation succeeded or which diagnostics remain.
