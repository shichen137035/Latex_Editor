# TeXWeave AI skills

Add each skill as its own subfolder containing a `SKILL.md` file, for example:

```text
resources/ai/skills/
  latex-project/SKILL.md
  latex-block-structure/SKILL.md
  latex-block-relations/SKILL.md
  academic-writing/SKILL.md
  citation-workflow/SKILL.md
```

TeXWeave discovers these folders at startup. Both Codex and Copilot receive only an enabled workflow index with names and short descriptions. They read an individual skill through the shared Capability Registry when needed. Skill bodies are not automatically injected and are not also sent as native Codex skill items. Keep skills focused on workflow, choices and constraints; API identifiers and parameter schemas belong to the registry, not skill documents.

The built-in `latex-project` skill is the small everyday foundation: find project content, make focused edits, and compile through TeXWeave. `latex-block-structure` covers the document block hierarchy and its metadata. `latex-block-relations` covers logical dependencies; it tells the AI to skip relation lookups unless the current project has a non-empty relation graph, or the user explicitly asks to create one. `academic-writing` guides formal language, complete reasoning, and clear scholarly narrative. These skills are enabled by default and can be managed independently in Settings → AI skills. Add future focused workflows as their own skills instead of expanding the basics skill into a catch-all.

Skills can also be created and edited from Settings → AI skills. Those edits are stored under TeXWeave's user-data directory and override a built-in skill of the same name without changing the installed resources.
