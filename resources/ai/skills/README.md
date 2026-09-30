# TeXWeave AI skills

Add each skill as its own subfolder containing a `SKILL.md` file, for example:

```text
resources/ai/skills/
  latex-project/SKILL.md
  citation-workflow/SKILL.md
```

TeXWeave discovers these folders at startup. Codex receives the skill as a native skill item; Copilot receives its instructions in the project prompt. Keep each skill focused and relevant to work inside a TeXWeave project.

Skills can also be created and edited from Settings → AI skills. Those edits are stored under TeXWeave's user-data directory and override a built-in skill of the same name without changing the installed resources.
