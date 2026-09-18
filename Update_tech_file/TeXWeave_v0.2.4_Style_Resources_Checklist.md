# TeXWeave v0.2.4 Style Resources & Project Bootstrap Checklist

> Version: **v0.2.4**  
> Scope: **Style Presets, Local Resource Library, Custom Style Resources, Project Bootstrap**  
> Status: small but foundational update  
> Deferred: online journal resource download/catalog

---

# 0. Version Goal

v0.2.4 introduces a reusable **Style Resource** system.

The key idea is:

> TeXWeave stores reusable LaTeX style resources outside projects.  
> When a user creates a project and selects a resource, TeXWeave copies a project-local snapshot of that resource into the new project.

This avoids hidden runtime dependencies on TeXWeave itself.

A project created by TeXWeave should remain a normal portable LaTeX project that can be compiled in another editor or uploaded to Overleaf.

Required v0.2.4 features:

- [ ] Built-in `Empty` preset
- [ ] Built-in `Default` preset
- [ ] User-created/custom style resources
- [ ] Settings page for managing local resources
- [ ] Import existing resource files
- [ ] Resource selection during new-project creation
- [ ] Copy selected resources into the new project
- [ ] Automatically create `main.tex`
- [ ] Automatically create `reference.bib`
- [ ] Automatically reference the selected Default style in `main.tex`
- [ ] Reserve UI/API space for future downloadable journal resources

---

# 1. Terminology

## 1.1 Style Preset

A predefined TeXWeave starter configuration.

Initial built-in presets:

```text
Empty
Default
```

A preset may reference one or more resources.

## 1.2 Resource

A reusable LaTeX-related file or set of files stored in TeXWeave's local resource library.

Examples:

```text
.sty
.cls
.bst
.bib
.tex
.cfg
.def
```

A resource may also contain supporting files required by a journal/template package.

## 1.3 Resource Pack

A named collection of resources that should be copied together.

Example:

```text
My Journal Pack
├── journal.cls
├── journal.sty
├── journal.bst
└── sample-reference.bib
```

A Resource Pack should have metadata describing how it should be copied and, where possible, how it should be referenced.

---

# 2. Core Portability Rule

Resources selected for a project must be **copied into the project**.

Do not make project compilation depend on:

```text
TeXWeave installation directory
TeXWeave user-data directory
an internal application database
```

Correct:

```text
TeXWeave Resource Library
        ↓ copy at project creation
Project/
├── main.tex
├── reference.bib
├── texweave.sty
└── ...
```

After creation, the copied files belong to the project.

Later changes to the library resource must not silently mutate existing projects.

---

# 3. Built-in Preset: Empty

`Empty` must always exist.

Semantics:

- [ ] no extra package imports;
- [ ] no custom command definitions;
- [ ] no theorem/environment definitions;
- [ ] no formatting changes;
- [ ] no hidden TeXWeave dependency.

Recommended behavior:

A minimal project created with Empty:

```text
Project/
├── main.tex
└── reference.bib
```

Recommended `main.tex`:

```latex
\documentclass{article}

\begin{document}

\end{document}
```

Recommended `reference.bib` is initially empty.

The Empty preset does not need to generate a `.sty` file.

---

# 4. Built-in Preset: Default

`Default` is a conservative academic-writing starter.

It should provide:

- [ ] common mathematical packages;
- [ ] theorem support;
- [ ] basic figure/table packages;
- [ ] common mathematical notation;
- [ ] Preview-compatible standard environments;
- [ ] minimal formatting interference.

Recommended file:

```text
texweave.sty
```

Recommended project:

```text
Project/
├── main.tex
├── reference.bib
└── texweave.sty
```

Recommended `main.tex`:

```latex
\documentclass{article}

\usepackage{texweave}

\begin{document}

\end{document}
```

---

# 5. Default Style Content

Recommended initial packages:

```latex
\RequirePackage{amsmath}
\RequirePackage{amssymb}
\RequirePackage{mathtools}
\RequirePackage{amsthm}
\RequirePackage{bm}

\RequirePackage{graphicx}
\RequirePackage{booktabs}
\RequirePackage{array}

\RequirePackage{xcolor}
\RequirePackage{hyperref}
```

Avoid opinionated packages in v0.2.4 unless necessary:

```text
geometry
biblatex
natbib
fontspec
titlesec
setspace
caption
subcaption
algorithm2e
tikz
```

These can later belong to dedicated resource packs.

---

# 6. Default Environments

The Default preset should define common theorem-like environments when they are not already defined:

```text
theorem
lemma
proposition
corollary
definition
assumption
example
remark
proof
```

Where possible, use guarded definitions to avoid collisions.

Common commands should prefer `\providecommand` where practical.

---

# 7. Resource Library

TeXWeave should maintain a local reusable Resource Library.

Suggested logical structure:

```text
resources/
├── built-in/
│   ├── empty/
│   └── default/
│
└── user/
    ├── my-style/
    ├── my-journal/
    └── ...
```

Actual runtime storage may use the application's user-data directory.

Built-in resources:

- [ ] read-only or resettable;
- [ ] shipped with the application;
- [ ] versioned.

User resources:

- [ ] editable metadata;
- [ ] removable;
- [ ] importable;
- [ ] reusable in future projects.

---

# 8. Custom Resource Creation

Users must be able to create their own resource entries.

Settings route:

```text
Settings
→ Style Resources
```

Recommended actions:

```text
New Resource
Import Files
Import Folder
Duplicate
Rename
Edit Metadata
Delete
```

For v0.2.4, a simple workflow is sufficient.

Example:

```text
New Resource

Name
My Academic Style

Files
[ + Add Files ]

☑ mypaper.sty
☑ notation.sty
☑ references-template.bib
```

---

# 9. Import Existing Resources

Settings should allow users to add existing local files.

Supported initial file types:

```text
.sty
.cls
.bst
.bib
.tex
```

Other auxiliary text-based TeX resource files may also be allowed.

Required behavior:

- [ ] choose one or more files;
- [ ] optionally choose a folder;
- [ ] copy imported files into TeXWeave's user resource library;
- [ ] do not keep fragile live links to the original location;
- [ ] preserve filenames;
- [ ] warn on filename collisions;
- [ ] allow overwrite / rename / cancel;
- [ ] store resource metadata.

For a local desktop app, prefer labels such as:

```text
Import
Add Files
Import Resource
```

rather than cloud-oriented "Upload".

---

# 10. Resource Metadata

Recommended manifest:

```json
{
  "id": "default",
  "nameKey": "resource.default.name",
  "descriptionKey": "resource.default.description",
  "version": 1,
  "source": "built-in",
  "files": [
    {
      "source": "texweave.sty",
      "target": "texweave.sty"
    }
  ],
  "mainStyle": {
    "kind": "package",
    "name": "texweave"
  }
}
```

Custom resource:

```json
{
  "id": "my-journal",
  "name": "My Journal",
  "version": 1,
  "source": "user",
  "files": [
    {
      "source": "journal.cls",
      "target": "journal.cls"
    },
    {
      "source": "journal.bst",
      "target": "journal.bst"
    }
  ]
}
```

The manifest should not require every resource to be a `.sty`.

---

# 11. Resource Types

The architecture should allow:

```ts
type ResourceFileKind =
  | "style"
  | "class"
  | "bibliography-style"
  | "bibliography"
  | "tex"
  | "other";
```

Resource packs may contain multiple types.

This is important because journal resources often contain more than a single `.sty`.

---

# 12. Reference Resources

Some style resources may include bibliography/reference-related files.

Examples:

```text
journal.bst
references-template.bib
citation-config.tex
```

v0.2.4 behavior:

- [ ] allow such files inside a Resource Pack;
- [ ] copy them when the resource is selected;
- [ ] do not automatically merge bibliography entries into `reference.bib`;
- [ ] do not overwrite the project's `reference.bib` silently;
- [ ] resolve filename conflicts explicitly.

`reference.bib` remains the standard new-project bibliography file.

If a selected resource contains another `.bib`, copy it as a separate file unless the resource manifest explicitly defines a safe target.

---

# 13. New Project Flow

Recommended flow:

```text
New Project
↓
Project name / location
↓
Project source
  ○ New blank project
  ○ Existing local project
↓
Style Resources
  ○ Empty
  ● Default
  □ Additional custom resources
↓
Create
```

For v0.2.4:

- [ ] support Empty;
- [ ] support Default;
- [ ] support at least one user resource selection;
- [ ] if multiple selection is easy, allow it.

---

# 14. New Blank Project Bootstrap

When creating a genuinely new project, TeXWeave must automatically create:

```text
main.tex
reference.bib
```

This behavior is independent of style selection.

Minimum output:

```text
Project/
├── main.tex
└── reference.bib
```

---

# 15. Bootstrap with Empty

If Empty is selected:

```text
Project/
├── main.tex
└── reference.bib
```

`main.tex`:

```latex
\documentclass{article}

\begin{document}

\end{document}
```

No TeXWeave style import should be inserted.

---

# 16. Bootstrap with Default

If Default is selected:

```text
Project/
├── main.tex
├── reference.bib
└── texweave.sty
```

`main.tex` should automatically include:

```latex
\usepackage{texweave}
```

Recommended complete initial file:

```latex
\documentclass{article}

\usepackage{texweave}

\begin{document}

\end{document}
```

Required checks:

- [ ] style resource copied successfully before project creation completes;
- [ ] `main.tex` references the copied local style;
- [ ] compile works without access to TeXWeave's internal resource directory.

---

# 17. Custom Resource Injection

A custom resource may optionally declare how it should affect project bootstrap.

Example:

```json
{
  "mainStyle": {
    "kind": "package",
    "name": "mypaper"
  }
}
```

Then TeXWeave may insert:

```latex
\usepackage{mypaper}
```

Alternatively, a future manifest may declare a document class.

For v0.2.4:

- [ ] implement package insertion for simple `.sty` resources if practical;
- [ ] keep arbitrary document-class transformation optional;
- [ ] never guess unsafe imports when metadata is missing.

If TeXWeave cannot determine how a resource should be referenced, copy the files without modifying `main.tex`.

---

# 18. Resource Copy Semantics

Resource copy must be deterministic.

Rules:

- [ ] copy files, never symlink by default;
- [ ] preserve manifest target paths;
- [ ] detect target filename collisions;
- [ ] never silently overwrite project files;
- [ ] abort or ask the user when conflict cannot be resolved;
- [ ] project creation should be transactional where practical;
- [ ] partial failed copies should not leave a falsely successful project.

---

# 19. Preset Snapshot Principle

Selecting a preset copies a snapshot into the project.

After creation:

```text
library/default/texweave.sty
```

and:

```text
MyProject/texweave.sty
```

are independent.

Updating TeXWeave's Default preset must not silently update existing projects.

This is required for reproducibility, portability, safety, and user ownership.

---

# 20. Settings UI

Add a dedicated complex Settings page:

```text
Settings
→ Style Resources
```

Recommended layout:

```text
← Style Resources

Built-in
  Empty
  Default

My Resources
  My Academic Style
  Journal X Pack

[ + New Resource ]
[ Import Files ]
[ Import Folder ]

────────────────────────

Online Resources
Common journal and publisher packages
Coming later
```

Built-in items:

- [ ] cannot be permanently deleted;
- [ ] may expose View Files;
- [ ] may be reset to shipped version if editable copies are supported.

User items:

- [ ] rename;
- [ ] inspect files;
- [ ] edit metadata;
- [ ] delete.

---

# 21. Future Online Resource Catalog

Reserve a section for future online download support.

Do **not** implement downloading in v0.2.4.

UI placeholder:

```text
Online Resources

Browse common journal and publisher resource packs.

Coming later
```

Future possibilities include common publishers and journal-specific packages.

Future implementation will require separate consideration of:

- licensing;
- source authenticity;
- versioning;
- update policy;
- publisher distribution terms;
- package integrity.

No fake online catalog should be shown in v0.2.4.

---

# 22. Relationship with Environment Blocks

Style Resources and Preview Environments are related but distinct.

Example:

```text
texweave.sty
defines:
  theorem
  lemma
  assumption
```

Preview Environment system may recognize:

```text
Theorem Block
Lemma Block
Assumption Block
```

But:

> `.sty` determines LaTeX/PDF behavior.  
> Environment configuration determines TeXWeave Preview behavior.

Disabling a Preview environment must not modify the `.sty`.

---

# 23. Relationship with Future Completion

Resource manifests should expose enough metadata for future IntelliSense.

Possible future manifest fields:

```json
{
  "packages": ["amsmath", "amsthm"],
  "environments": ["theorem", "lemma"],
  "commands": ["R", "E", "Var"]
}
```

v0.2.4 does not need to implement Completion Service integration yet.

However:

- [ ] resource metadata format should not block it;
- [ ] built-in Default metadata should list known environments/commands where practical.

---

# 24. Suggested Internal Services

Possible architecture:

```text
StyleResourceRepository
├── listBuiltIn()
├── listUser()
├── importFiles()
├── importFolder()
├── createResource()
├── deleteResource()
└── getResource()

ProjectScaffolder
├── createMainTex()
├── createReferenceBib()
├── copyResources()
└── injectBootstrapImports()
```

Suggested TypeScript:

```ts
interface StyleResource {
  id: string;
  name: string;
  source: "built-in" | "user" | "online";
  version: number;
  files: ResourceFile[];
  mainStyle?: {
    kind: "package";
    name: string;
  };
}

interface ResourceFile {
  sourcePath: string;
  targetPath: string;
  kind?: ResourceFileKind;
}
```

---

# 25. Project Metadata

Project metadata may remember the origin resource for informational purposes:

```json
{
  "styleResources": [
    {
      "id": "default",
      "version": 1
    }
  ]
}
```

This metadata is informative.

It must not mean the project is still linked to the library copy.

---

# 26. Validation Checklist

## Empty

- [ ] Empty is always available.
- [ ] New Empty project creates `main.tex`.
- [ ] New Empty project creates `reference.bib`.
- [ ] No style file is required.
- [ ] No TeXWeave package import is inserted.

## Default

- [ ] Default is always available.
- [ ] `texweave.sty` is copied into the project.
- [ ] `main.tex` automatically contains `\usepackage{texweave}`.
- [ ] `reference.bib` is created.
- [ ] Default project compiles with a normal local LaTeX installation.
- [ ] Moving the project away from TeXWeave does not break the style dependency.

## Custom Resources

- [ ] User can import `.sty`.
- [ ] User can import multiple files as one resource.
- [ ] User can remove custom resources.
- [ ] Selected custom resources are copied into new projects.
- [ ] Resource filename conflicts are handled explicitly.

## Settings

- [ ] `Style Resources` appears as a dedicated Settings page.
- [ ] Built-in resources are listed separately.
- [ ] User resources are listed separately.
- [ ] Import actions work.
- [ ] Future Online Resources section is an honest placeholder.

---

# 27. Smoke Tests

### Test A: Empty project

1. Create new project.
2. Select Empty.
3. Verify `main.tex`.
4. Verify `reference.bib`.
5. Verify no `texweave.sty`.
6. Compile.

### Test B: Default project

1. Create new project.
2. Select Default.
3. Verify `main.tex`.
4. Verify `reference.bib`.
5. Verify `texweave.sty`.
6. Verify `main.tex` contains `\usepackage{texweave}`.
7. Compile.
8. Move project to another directory.
9. Compile again.

### Test C: User `.sty`

1. Open Settings → Style Resources.
2. Import `my-style.sty`.
3. Create new project.
4. Select the custom resource.
5. Verify a project-local copy exists.
6. Verify original imported file is not required at compile time.

### Test D: Multi-file resource

1. Import `.sty`, `.bst`, and supporting file as one resource.
2. Create project with the resource.
3. Confirm all files are copied.
4. Confirm target layout matches manifest.

### Test E: Conflict

1. Select two resources that both target the same filename.
2. Create project.
3. Confirm TeXWeave does not silently overwrite.
4. Confirm conflict is surfaced clearly.

---

# 28. Non-Goals

Not required in v0.2.4:

- online journal resource download;
- resource marketplace;
- automatic publisher-template detection;
- automatic update of project-local resources;
- remote synchronization;
- full `.cls` project transformation;
- automatic bibliography merging;
- automatic license resolution;
- completion/intellisense implementation;
- advanced template wizard.

---

# 29. v0.2.4 Completion Definition

v0.2.4 is complete when:

- [ ] Empty preset works.
- [ ] Default preset works.
- [ ] new blank projects always create `main.tex` and `reference.bib`.
- [ ] Default projects automatically import their copied local style.
- [ ] users can create/import reusable local style resources.
- [ ] resources can contain multiple files, including bibliography-related files.
- [ ] selected resources are copied into projects.
- [ ] project copies are independent snapshots.
- [ ] resource management exists in Settings.
- [ ] future online resource catalog has a clean placeholder without fake functionality.
- [ ] project portability remains intact.

---

# 30. Design Summary

```text
TeXWeave Resource Library
        ↓ choose at project creation
        ↓ copy
Project-local resources
        ↓
main.tex / LaTeX compilation
```

Never:

```text
Project
   ↓ runtime dependency
TeXWeave internal resource path
```

The central rule is:

> **TeXWeave helps assemble a project, but the resulting LaTeX project owns its own resources.**
