---
name: latex-project
description: Work effectively with LaTeX projects opened in TeXWeave.
---

# TeXWeave LaTeX project

- Treat the supplied project files as a LaTeX document project. Read the configured main `.tex` file and nearby `.tex`, `.bib`, `.sty`, and `.cls` files before making broad changes.
- Preserve the project's language, document class, package choices, citation style, labels, and existing structure. Keep edits focused on the user's request.
- Keep `\begin{...}` and `\end{...}` pairs balanced. Preserve existing labels and references; update references when a requested edit changes them.
- When a build check is useful, call the TeXWeave `texweave_compile` tool. It runs the configured compiler on the AI working copy and returns build diagnostics. Do not run `latexmk`, `pdflatex`, `xelatex`, `lualatex`, `tectonic`, `arara`, `bibtex`, or `biber` through a shell; TeXWeave owns compilation and its build settings.
- Use reported file and line locations to repair LaTeX errors, then call `texweave_compile` again when appropriate. Explain any unresolved errors or warnings in the final response.
- Do not edit compiler-generated files such as `.aux`, `.log`, `.fls`, `.fdb_latexmk`, `.synctex.gz`, `.xdv`, or build-directory output as source content.
- Summarize source files changed and whether the TeXWeave build succeeded.
