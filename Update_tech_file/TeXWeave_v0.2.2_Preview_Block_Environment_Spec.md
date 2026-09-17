# TeXWeave v0.2.2 Preview & Block Environment Specification

> Product: **TeXWeave**  
> Target version: **v0.2.2**  
> Scope: structured Preview, Block/Environment model, ContentRegion editing, default environment catalog, styling/configuration, parser rules, fallback behavior, and tests.  
> Default UI language: English.

---

## 1. Purpose

TeXWeave Preview is not a miniature PDF viewer and not a WYSIWYG word processor. It is a **high-fidelity, structured, interactive reading layer** over LaTeX source.

Its goals are to:

- render ordinary LaTeX close to the compiled result where practical;
- make document structure clearer than PDF;
- expose important semantic environments as configurable blocks;
- allow local source editing directly from the Preview;
- preserve precise source mappings;
- degrade locally when unsupported LaTeX appears;
- remain compatible with ordinary LaTeX projects;
- provide a foundation for later Relations, AI, semantic navigation, image tools, and table tools.

Preview should prioritize structural clarity, readability, direct interaction, logical source order, and local editing. PDF remains authoritative for final typography, pagination, exact float placement, and publication output.

---

## 2. Core Model

Preview content is represented by two node families:

```ts
type PreviewNode = StructuralBlock | ContentRegion;
```

### 2.1 StructuralBlock

Represents explicit document structure, for example:

- Section / Subsection / Subsubsection
- Abstract
- Theorem / Lemma / Proposition / Corollary
- Definition / Assumption / Remark / Example / Proof
- Equation / Align / Gather / Multline
- Figure / Table
- Itemize / Enumerate / Description
- Quote / Quotation
- Verbatim / Code

A StructuralBlock may contain child `PreviewNode`s.

### 2.2 ContentRegion

Represents ordinary content that is not itself an explicit Environment block:

- paragraph text;
- inline math;
- prose between explicit blocks;
- plain source fragments inside theorem/proof/section content.

ContentRegion exists so that clicking ordinary prose edits only that prose region.

Example:

```latex
\section{Introduction}

First paragraph.

\begin{equation}
E = mc^2
\end{equation}

Second paragraph.
```

Preview tree:

```text
Section
├── ContentRegion #1
├── Equation Block
└── ContentRegion #2
```

Clicking the first paragraph must reveal only `ContentRegion #1`.

---

## 3. ContentRegion Generation

StructuralBlocks claim their source ranges first. Remaining continuous source gaps are automatically filled with ContentRegions.

Conceptually:

```text
Parent source range
├── gap → ContentRegion
├── StructuralBlock
├── gap → ContentRegion
└── StructuralBlock
```

Continuous ordinary text should then be split by natural paragraph boundaries, usually blank lines outside special environments.

Inline math stays inside the surrounding ContentRegion:

```latex
Suppose $X_t$ is stationary and let $m(x)=E[Y|X=x]$.
```

Display math normally becomes a StructuralBlock:

```latex
\[
...
\]
```

or

```latex
\begin{equation}
...
\end{equation}
```

Comments are not rendered in Preview, but remain part of the source mapping.

---

## 4. Source Mapping Invariants

Every editable PreviewNode must map to a source span.

```ts
interface SourceSpan {
  filePath: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}
```

Rules:

1. Sibling source ranges must not overlap.
2. Child ranges must be contained within parent ranges.
3. StructuralBlocks must not cross each other.
4. ContentRegions fill ordinary content gaps rather than overlap explicit blocks.
5. Local edits target only the corresponding source span.
6. Reparsing after edits must regenerate affected mappings.
7. The Preview hierarchy is a tree, not a general graph.

---

## 5. Environment vs Block

**Environment** is the definition/rule layer. It specifies:

- what source pattern creates a block;
- localized display label;
- style tokens;
- accent bar;
- fill/background;
- border and selected border;
- whether children are allowed;
- whether inline source editing is allowed;
- whether the block appears in Outline;
- future behavior options.

**Block** is a concrete Preview instance created from an Environment definition.

Example:

```text
Environment definition: theorem
Concrete instances: Theorem 1, Theorem 2, Theorem 3
```

---

## 6. Block Visual Anatomy

```text
StructuralBlock
├── Accent Bar
├── Header
│   ├── Environment Label
│   ├── Title / Number / Name
│   └── Optional Actions
└── Content
    └── child PreviewNodes
```

The left accent bar is a stable visual identity marker.

Idle blocks should not look like heavy cards.

---

## 7. Block Interaction States

### 7.1 Default

- extremely faint border;
- subdued left accent bar;
- compact low-emphasis label;
- very light or transparent fill.

### 7.2 Hover

- slightly stronger boundary;
- slightly stronger fill;
- no heavy selection border.

### 7.3 Selected

Triggered by clicking the block header or navigating from Outline.

- clearly stronger border;
- stronger accent bar;
- emphasized label;
- optional metadata/actions may appear.

Selection means: **the whole structural block is selected**.

It does not imply editing.

### 7.4 Editing

Triggered by clicking editable content instead of the header.

Only the smallest relevant node becomes a local source editor.

Example:

```text
Theorem
├── ContentRegion A → source editor
├── Equation → remains rendered
└── ContentRegion B → remains rendered
```

---

## 8. Header Click vs Content Click

### Header click

- selects the entire StructuralBlock;
- highlights the whole block;
- does not enter source edit mode.

### Content click

- identifies the smallest editable PreviewNode;
- reveals only that node's source;
- preserves surrounding Preview.

Examples:

```text
ContentRegion → paragraph source editor
Equation body → equation source editor
Theorem body paragraph → only that paragraph's source editor
```

---

## 9. Inline Source Editor

The local source editor may be implemented with a lightweight Monaco instance or another reusable editor.

Required behavior:

- LaTeX syntax highlighting;
- editing limited to the current source span;
- `Esc` cancels;
- `Ctrl+Enter` may apply;
- clicking elsewhere may apply according to preference;
- updates source buffer;
- triggers local/incremental reparse where feasible;
- restores rendered Preview when complete.

The whole page must not switch to source mode.

---

## 10. General Rendering Goal

High-priority support:

- plain text and paragraphs;
- section headings;
- bold/italic/emphasis and common text commands;
- inline and display math;
- theorem-like environments;
- lists;
- quotes;
- basic figure/table recognition;
- basic citation/reference rendering when resolvable.

Preview should look close to compiled output, but it does not need to reproduce:

- exact TeX line breaks;
- exact page breaks;
- exact vertical glue;
- exact float positions;
- every custom macro.

Unsupported syntax must degrade locally, never collapse the entire Preview.

---

## 11. Fallback Rules

Recommended fallback order:

1. known built-in command/environment;
2. known package command/environment;
3. user-configured Environment;
4. safe simple custom macro handling;
5. generic/raw fallback.

Unknown environment:

```text
[CUSTOM ENVIRONMENT]
render supported inner content
```

If rendering is impossible:

```text
Unsupported preview
[Show source]
```

Custom macro expansion is not required to be complete in v0.2.2.

---

## 12. Environment Configuration Model

Environment definitions must be data-driven.

```ts
interface EnvironmentDefinition {
  id: string;
  match: EnvironmentMatchRule;
  labelKey: string;
  style: EnvironmentStyle;
  behavior: EnvironmentBehavior;
}
```

Suggested match rules:

```ts
type EnvironmentMatchRule =
  | { kind: "latex-environment"; name: string }
  | { kind: "command"; command: string }
  | { kind: "display-math" }
  | { kind: "custom-pattern"; patternId: string };
```

Recommended style model:

```ts
interface EnvironmentStyle {
  accentToken: string;
  labelBackgroundToken: string;
  labelTextToken: string;
  fillToken?: string;
  borderToken: string;
  selectedBorderToken: string;
  headerTextToken?: string;
  borderWidth?: number;
  selectedBorderWidth?: number;
  accentWidth?: number;
  radius?: number;
}
```

Recommended behavior model:

```ts
interface EnvironmentBehavior {
  selectable: boolean;
  inlineEditable: boolean;
  allowChildren: boolean;
  showHeader: boolean;
  showLabel: boolean;
  collapsible?: boolean;
  addToOutline: boolean;
  showNumber?: boolean;
}
```

---

## 13. i18n

Environment labels must use locale keys.

Example:

```json
{
  "environment.theorem": "Theorem",
  "environment.proof": "Proof",
  "environment.equation": "Equation"
}
```

Future locale example:

```json
{
  "environment.theorem": "定理",
  "environment.proof": "证明",
  "environment.equation": "公式"
}
```

Parser logic must remain independent of UI language.

English is the default v0.2.2 locale.

---

## 14. Theme Tokens

Environment styling should use semantic design tokens rather than hard-coded colors in React components.

Example light-theme baseline:

```css
:root {
  --env-section-accent: #4f7dd7;
  --env-section-fill: #f7faff;

  --env-theorem-accent: #6f6cc6;
  --env-theorem-fill: #f8f7ff;

  --env-definition-accent: #2b9fa8;
  --env-definition-fill: #f5fbfb;

  --env-proof-accent: #4b9b75;
  --env-proof-fill: #f7fbf8;

  --env-equation-accent: #7a8da3;
  --env-equation-fill: #f8fafc;

  --env-remark-accent: #a88755;
  --env-remark-fill: #fcfaf6;

  --env-example-accent: #478ca8;
  --env-example-fill: #f6fbfd;

  --env-border-default: rgba(70, 95, 120, 0.12);
  --env-border-hover: rgba(70, 95, 120, 0.24);
  --env-border-selected: #2f6bb2;
}
```

Values are examples only. Themes must remain replaceable.

---

# 15. Default Environment Catalog

## 15.1 Section

Source:

```latex
\section{Title}
```

Recommended:
- label: `SECTION`
- accent: strong blue
- fill: very light cool blue
- header: yes
- selectable: yes
- inline edit: yes
- children: yes
- Outline: yes
- numbering: when known

## 15.2 Subsection

- label: `SUBSECTION`
- accent: medium blue
- fill: lighter than Section
- header: yes
- children: yes
- Outline: yes

## 15.3 Subsubsection

- label: `SUBSUBSECTION`
- accent: muted blue-gray
- fill: minimal/transparent
- lower visual weight
- Outline: yes

## 15.4 Abstract

Source:

```latex
\begin{abstract}
...
\end{abstract}
```

- label: `ABSTRACT`
- accent: cool gray-blue
- fill: subtle neutral-blue
- header: yes
- inline edit: yes
- Outline: optional

## 15.5 Theorem

```latex
\begin{theorem}
...
\end{theorem}
```

- label: `THEOREM`
- accent: indigo / blue-violet
- fill: very light violet-blue
- header: yes
- children: yes
- inline edit: yes
- Outline: yes
- numbering: if available

## 15.6 Lemma

- label: `LEMMA`
- accent: slightly lighter indigo
- fill: very light
- same behavior as Theorem
- Outline: yes

## 15.7 Proposition

- label: `PROPOSITION`
- accent: desaturated indigo
- fill: light indigo-gray
- same behavior as Theorem

## 15.8 Corollary

- label: `COROLLARY`
- accent: soft purple-blue
- fill: minimal
- same behavior as Theorem

## 15.9 Definition

```latex
\begin{definition}
...
\end{definition}
```

- label: `DEFINITION`
- accent: cyan / teal
- fill: very light teal
- header: yes
- children: yes
- inline edit: yes
- Outline: yes

## 15.10 Assumption

```latex
\begin{assumption}
...
\end{assumption}
```

- label: `ASSUMPTION`
- accent: teal-blue
- fill: light teal
- header: yes
- children: yes
- inline edit: yes
- Outline: yes

## 15.11 Remark

- label: `REMARK`
- accent: muted amber / warm gray
- fill: warm neutral tint
- header: yes
- children: yes
- Outline: optional

## 15.12 Example

- label: `EXAMPLE`
- accent: blue-cyan
- fill: light cyan
- header: yes
- children: yes
- Outline: optional

## 15.13 Proof

```latex
\begin{proof}
...
\end{proof}
```

- label: `PROOF`
- accent: muted green
- fill: near-transparent green-gray
- header: yes
- children: yes
- inline edit: yes
- Outline: optional
- numbering: no

## 15.14 Equation / Display Math

Examples:

```latex
\begin{equation}
...
\end{equation}
```

and recognized display math.

- label: `EQUATION`
- accent: cool gray-blue
- fill: subtle cool neutral
- header: yes
- children: no
- inline edit: yes
- Outline: optional
- numbering: when known

## 15.15 Align

- label: `ALIGN`
- equation-family styling
- children: no
- inline edit: yes
- Outline: optional

## 15.16 Gather

- label: `GATHER`
- equation-family styling
- children: no
- inline edit: yes

## 15.17 Multline

- label: `MULTLINE`
- equation-family styling
- children: no
- inline edit: yes

## 15.18 Figure

```latex
\begin{figure}
...
\end{figure}
```

v0.2.2:
- recognize as StructuralBlock;
- label: `FIGURE`
- accent: cool cyan-blue
- fill: nearly transparent
- basic image rendering if supported;
- basic caption rendering;
- source mapping;
- inline/source editing.

Advanced image editing is deferred.

## 15.19 Table

```latex
\begin{table}
...
\end{table}
```

v0.2.2:
- recognize as StructuralBlock;
- label: `TABLE`
- accent: slate-cyan
- fill: light neutral
- basic rendering where possible;
- advanced visual table editing deferred.

## 15.20 Itemize

```latex
\begin{itemize}
...
\end{itemize}
```

- label: optional `LIST`
- accent: muted blue-gray
- fill: none
- header/label may be hidden by default to reduce noise
- children: yes
- Outline: no

## 15.21 Enumerate

- label: optional `ENUMERATE`
- same family as Itemize
- Outline: no

## 15.22 Description

- label: optional `DESCRIPTION`
- same list-family styling
- Outline: no

## 15.23 Quote / Quotation

- label: optional `QUOTE` / `QUOTATION`
- accent: neutral gray-blue
- fill: light neutral
- indentation allowed
- Outline: no

## 15.24 Verbatim / Code

```latex
\begin{verbatim}
...
\end{verbatim}
```

- label: `CODE` or `VERBATIM`
- accent: graphite / steel
- fill: cool gray
- monospace content
- children: no
- inline edit: yes
- Outline: no

## 15.25 Plain Paragraph

Plain paragraph text is **not** a user-configured Environment.

It is a ContentRegion:

- no label;
- no accent bar;
- no visible idle border;
- faint hover affordance only;
- click reveals only that paragraph's source.

---

## 16. Default Style Summary

| Environment | Accent family | Fill | Header | Children | Inline edit | Outline |
|---|---|---|---|---|---|---|
| Section | Strong blue | light blue | yes | yes | yes | yes |
| Subsection | Medium blue | very light blue | yes | yes | yes | yes |
| Subsubsection | Blue-gray | minimal | yes | yes | yes | yes |
| Abstract | Gray-blue | neutral-blue | yes | limited | yes | optional |
| Theorem | Indigo | light indigo | yes | yes | yes | yes |
| Lemma | Indigo-light | light | yes | yes | yes | yes |
| Proposition | Indigo-gray | light | yes | yes | yes | yes |
| Corollary | Purple-blue | minimal | yes | yes | yes | yes |
| Definition | Teal | light teal | yes | yes | yes | yes |
| Assumption | Teal-blue | light teal | yes | yes | yes | yes |
| Remark | Warm neutral | warm light | yes | yes | yes | optional |
| Example | Cyan-blue | light cyan | yes | yes | yes | optional |
| Proof | Green | near-transparent | yes | yes | yes | optional |
| Equation | Gray-blue | cool light | yes | no | yes | optional |
| Align/Gather/Multline | Gray-blue | cool light | yes | no | yes | optional |
| Figure | Cyan-blue | minimal | yes | yes | yes | optional |
| Table | Slate-cyan | neutral | yes | yes | yes | optional |
| Itemize/Enumerate | Blue-gray | none | optional | yes | yes | no |
| Description | Blue-gray | none | optional | yes | yes | no |
| Quote/Quotation | Gray-blue | neutral | optional | yes | yes | no |
| Verbatim/Code | Steel | cool gray | yes | no | yes | no |

---


## 17. Virtual Blocks

TeXWeave must support blocks that have **semantic structure inside TeXWeave but no formatting semantics in the compiled PDF**.

These are called:

> **Virtual Blocks**

A Virtual Block is not a normal LaTeX environment. It is TeXWeave metadata layered over ordinary LaTeX source.

### 17.1 Purpose

Virtual Blocks are intended for author-defined semantic groupings such as:

- Intuition
- Idea
- Argument
- Background
- Motivation
- Counterexample
- Question
- Empirical Result
- Draft Note
- Custom semantic regions

The user may want such a region to behave as a block in Preview, Outline, Relations, or future AI features while leaving the final PDF visually unchanged.

### 17.2 Recommended Source Representation

Use TeXWeave-specific LaTeX comments:

```latex
% tw:block-begin type=intuition
This paragraph contains the main intuition.

A second paragraph may also belong to the same virtual block.
% tw:block-end
```

Optional metadata may be added:

```latex
% tw:block-begin type=argument title="Main consistency argument" id=consistency-argument
...
% tw:block-end
```

Because these markers are comments, ordinary LaTeX compilation ignores them.

### 17.3 Source Preservation Rule

TeXWeave-generated markers must:

- occupy their own source lines;
- not be appended to ordinary text;
- not automatically remove or add surrounding paragraph breaks;
- preserve the original LaTeX body unchanged;
- remain readable and removable outside TeXWeave.

The goal is that adding or removing a Virtual Block does not alter the compiled document except where source whitespace was intentionally changed by the user.

### 17.4 Preview Model

Example:

```text
Section
├── ContentRegion
├── VirtualBlock: Intuition
│   ├── ContentRegion
│   └── ContentRegion
└── ContentRegion
```

A Virtual Block behaves like a normal StructuralBlock inside Preview:

- faint idle border;
- configurable accent bar;
- configurable label;
- selectable header;
- nested ContentRegions;
- local source editing;
- optional Outline entry;
- future Relations participation.

It differs from a regular StructuralBlock only in its source origin and lack of PDF formatting semantics.

### 17.5 Block Taxonomy

The Preview model therefore recognizes three practical categories:

```text
Preview structure
├── StructuralBlock
│   └── derived from real LaTeX structure
│       section / theorem / equation / ...
│
├── VirtualBlock
│   └── derived from TeXWeave metadata
│       intuition / argument / idea / ...
│
└── ContentRegion
    └── automatically generated ordinary content
```

Implementation may represent VirtualBlock as a specialized `StructuralBlock` subtype.

Recommended TypeScript extension:

```ts
interface StructuralBlock extends PreviewBaseNode {
  kind: "block";

  origin:
    | "latex"
    | "virtual";

  environmentId: string;

  title?: string;
  number?: string;
  latexLabel?: string;

  children: PreviewNode[];
}
```

### 17.6 Creating Virtual Blocks

Normal users should not be required to type marker comments manually.

Recommended future interaction:

1. select one or more ContentRegions;
2. choose `Create Block`;
3. choose an Environment type such as `Intuition`;
4. TeXWeave inserts the begin/end metadata comments;
5. Preview reparses the selected region as a Virtual Block.

Advanced users may edit markers directly.

### 17.7 Environment Manager Integration

The Environment Manager should allow creation of a new definition with source type:

```text
Block Source

○ LaTeX Environment
○ LaTeX Command
○ Display Math
○ TeXWeave Virtual Block
○ Custom Pattern
```

A Virtual Block definition may specify:

- ID;
- localized label;
- accent style;
- background/fill;
- selected border;
- inline editing behavior;
- allowed children;
- Outline inclusion;
- future Relations availability.

Example:

```xml
<environment id="intuition" enabled="true">
  <match type="virtual-block">
    <type>intuition</type>
  </match>

  <label key="environment.intuition" />

  <style
    accentToken="env.intuition.accent"
    fillToken="env.intuition.fill"
    borderToken="env.border.default"
    selectedBorderToken="env.border.selected"
  />

  <behavior
    selectable="true"
    inlineEditable="true"
    allowChildren="true"
    showHeader="true"
    showLabel="true"
    addToOutline="true"
  />
</environment>
```

### 17.8 Virtual Blocks and Future Relations

Virtual Blocks are especially important for future semantic Relations because they allow authors to introduce structure that LaTeX itself does not define.

Examples:

```text
Assumption
↓ supports

Main Argument
↓ motivates

Simulation Result
```

No PDF-visible markup is required.

---

## 18. Environment Enable / Disable Management

Environment definitions are user-manageable.

Each Environment definition must have an explicit enabled state.

Recommended model:

```ts
interface EnvironmentDefinition {
  id: string;
  enabled: boolean;

  match: EnvironmentMatchRule;
  labelKey: string;
  style: EnvironmentStyle;
  behavior: EnvironmentBehavior;
}
```

### 18.1 Meaning of `enabled`

When:

```text
enabled = true
```

the Environment definition participates in TeXWeave structural recognition and may create a StructuralBlock / VirtualBlock.

When:

```text
enabled = false
```

the Environment definition is ignored for **block creation**.

This must not damage or delete the underlying LaTeX source.

### 18.2 Disabled Environment Rendering

Disabling an Environment means:

- no block boundary;
- no accent bar;
- no Environment label;
- no selection as that Environment block;
- no Outline entry generated from that Environment definition;
- no Environment-specific style.

However, TeXWeave should still render the underlying LaTeX content normally wherever possible.

Examples:

#### Disabled theorem

Source:

```latex
\begin{theorem}
A result.
\end{theorem}
```

If `theorem` is disabled:

- the theorem should not appear as a Theorem block;
- its readable body should still appear in Preview;
- parser/rendering should not expose raw `\begin{theorem}` / `\end{theorem}` unless fallback requires it.

#### Disabled equation block styling

Source:

```latex
\begin{equation}
E = mc^2
\end{equation}
```

If Equation blockification is disabled:

- the formula should still render as display math;
- Equation block chrome/label/accent should disappear.

This distinction is important:

> **Environment recognition for TeXWeave block semantics is separate from basic LaTeX rendering.**

### 18.3 Built-in vs Custom Environments

Built-in environments:

- may be disabled;
- should not normally be permanently deleted;
- may be reset to default.

Custom environments:

- may be enabled/disabled;
- may be duplicated;
- may be deleted.

Recommended Environment Manager actions:

```text
Enable / Disable
Duplicate
Reset to Default     # built-in
Delete               # custom only
```

### 18.4 UI

The Environment Manager list should expose state clearly:

```text
Built-in
  ● Section        On
  ● Theorem        On
  ○ Remark         Off
  ● Equation       On

Custom
  ● Intuition      On
  ○ Draft Note     Off
```

A compact switch is recommended.

Example:

```text
Theorem        [ On  ]
Remark         [ Off ]
```

Disabled environments should remain visible in the manager so they can be re-enabled.

### 18.5 Scope and Override Rules

Enable/disable state may later exist at:

```text
Built-in default
      ↓
Global user override
      ↓
Project override
```

Project override should take precedence.

Example:

```text
Global:
Remark = On

Project:
Remark = Off
```

Effective project state:

```text
Remark = Off
```

### 18.6 Configuration Example

```xml
<environment id="remark" enabled="false">
  <match type="latex-environment">
    <name>remark</name>
  </match>

  <label key="environment.remark" />

  ...
</environment>
```

The GUI and Advanced XML editor must modify the same `enabled` field.

### 18.7 Parser Requirement

Environment matching should conceptually follow:

```text
source construct found
        ↓
matching EnvironmentDefinition exists?
        ↓
enabled?
   ┌────┴────┐
  yes       no
   ↓         ↓
create      render underlying
block       LaTeX without
            TeXWeave block semantics
```

Disabling an Environment must never remove source or cause unrelated Preview nodes to disappear.

---

## 19. Configuration Format

Advanced mode should support direct editing of an external configuration file. XML is recommended because the model is hierarchical and human-readable.

Example:

```xml
<environment id="theorem">
  <match type="latex-environment">
    <name>theorem</name>
  </match>

  <label key="environment.theorem" />

  <style
    accentToken="env.theorem.accent"
    fillToken="env.theorem.fill"
    borderToken="env.border.default"
    selectedBorderToken="env.border.selected"
    labelBackgroundToken="env.theorem.label.bg"
    labelTextToken="env.theorem.label.text"
  />

  <behavior
    selectable="true"
    inlineEditable="true"
    allowChildren="true"
    showHeader="true"
    showLabel="true"
    addToOutline="true"
  />
</environment>
```

GUI and Advanced mode must use the same underlying model.

Correct flow:

```text
XML / Repository
      ↓ parse
Environment Model
      ↓
GUI
```

GUI save:

```text
GUI → Model → serialize → XML
```

Advanced save:

```text
XML → validate → Model → GUI refresh
```

---

## 20. Parsing Pipeline

Recommended:

```text
LaTeX Source
    ↓
Tokenizer / Parser
    ↓
Structural Detection
    ↓
Environment Matching
    ↓
StructuralBlock Tree
    ↓
ContentRegion Gap Filling
    ↓
PreviewNode Tree
    ↓
Renderer
```

Gap filling:

```text
for each parent:
    collect explicit child spans
    sort by source start
    verify non-crossing order
    fill gaps with ContentRegions
    split gaps into natural paragraphs
```

---

## 21. Rendering Architecture

Recommended component structure:

```text
PreviewPane
└── PreviewNodeRenderer
    ├── StructuralBlockRenderer
    │   ├── BlockHeader
    │   ├── AccentBar
    │   └── BlockContent
    └── ContentRegionRenderer
```

Specialized renderers may include:

```text
MathRenderer
TheoremRenderer
ProofRenderer
FigureRenderer
TableRenderer
ListRenderer
CodeRenderer
```

Prefer registry-based renderer selection.

Unknown environment types should fall back to a generic renderer.

---

## 22. Numbering and Labels

Where accurate numbering is already available from parser/compiler metadata, Preview may display:

```text
Theorem 1
Equation 2
Figure 3
```

If accurate numbering is unavailable, do not invent it.

Source labels such as:

```latex
\label{thm:consistency}
```

should normally remain hidden from body text. They may appear when a block is selected or later in an Inspector.

---

## 23. Editing Lifecycle

```text
Preview
 ↓ click content
Inline source editor
 ↓ edit
Apply
 ↓
source buffer update
 ↓
local/incremental reparse
 ↓
affected Preview subtree regenerated
 ↓
Preview restored
```

If parsing fails:

- keep the local source editor open;
- show a local error;
- preserve unrelated valid Preview content.

---

## 24. Performance

Avoid full-document rerender after every keystroke where practical.

Recommended long-term strategy:

- debounce edits;
- identify affected source range;
- rebuild nearest valid structural ancestor;
- reuse unaffected nodes.

An initial whole-file reparse is acceptable if documents remain responsive, but APIs should not lock the architecture into that approach.

---

## 25. v0.2.2 Required Scope

Required:

- Virtual Block recognition and metadata markers;
- Environment enable/disable state and fallback rendering;
- PreviewNode tree;
- StructuralBlock vs ContentRegion distinction;
- Section/Subsection/Subsubsection;
- theorem-like blocks;
- Definition/Assumption/Remark/Example;
- Proof;
- Equation/display math and common equation environments;
- paragraph ContentRegions;
- nested blocks;
- environment labels;
- accent bars;
- default / hover / selected / editing states;
- header selection behavior;
- local source reveal/editing;
- i18n label keys;
- theme-token-driven styles;
- data-driven Environment definitions;
- fallback handling;
- basic Figure and Table recognition;
- tests.

---

## 26. Explicit Non-Goals for v0.2.2

Not required:

- advanced image resize/replace UI;
- drag-and-drop image authoring;
- clipboard image insertion;
- advanced visual table editor;
- complete custom macro expansion;
- exact TeX layout reproduction;
- exact PDF float placement;
- relation graph;
- AI block analysis;
- block relationship authoring;
- collaboration;
- complete citation/reference semantic UI;
- complete SyncTeX integration.

---

## 27. Suggested TypeScript Types

```ts
type PreviewNode = StructuralBlock | ContentRegion;

interface PreviewBaseNode {
  id: string;
  source: SourceSpan;
  parentId?: string;
}

interface StructuralBlock extends PreviewBaseNode {
  kind: "block";
  environmentId: string;
  title?: string;
  number?: string;
  latexLabel?: string;
  children: PreviewNode[];
}

interface ContentRegion extends PreviewBaseNode {
  kind: "content";
  contentType: "paragraph" | "plain" | "other";
}
```

Interaction state:

```ts
interface PreviewInteractionState {
  selectedBlockId?: string;
  hoveredNodeId?: string;
  editingNodeId?: string;
}
```

Only StructuralBlocks may be selected as structural objects. ContentRegions may be edited.

---

## 28. Test Fixture

Recommended fixture:

```text
tests/fixtures/preview-basic/
├── main.tex
├── figures/
│   └── sample.png
└── references.bib
```

Example source:

```latex
\section{Introduction}

First paragraph with inline math $x_t$.

\begin{equation}
x_t = \alpha x_{t-1} + \varepsilon_t
\end{equation}

Second paragraph.

\begin{theorem}
Suppose $X$ is compact.

\begin{equation}
f(x) = x^2
\end{equation}

Then the conclusion holds.
\end{theorem}

\begin{proof}
First proof paragraph.

Second proof paragraph.
\end{proof}
```

Expected tree:

```text
Section
├── ContentRegion
├── Equation
├── ContentRegion
├── Theorem
│   ├── ContentRegion
│   ├── Equation
│   └── ContentRegion
└── Proof
    ├── ContentRegion
    └── ContentRegion
```

---

## 29. Required Tests

### Parser

- section detection;
- theorem detection;
- proof detection;
- equation detection;
- nested equation inside theorem;
- paragraph gap filling;
- paragraph splitting;
- sibling non-overlap;
- child containment;
- malformed environment fallback.

### Content click

Scenario:

```text
Section
├── paragraph A
├── equation
└── paragraph B
```

Click paragraph A.

Expected:

- only paragraph A becomes source editor;
- equation remains rendered;
- paragraph B remains rendered;
- source editor span equals paragraph A only.

### Header click

Click Theorem header.

Expected:

- theorem becomes selected;
- selected border visible;
- accent bar emphasized;
- no source editor opens.

### Nested content

Theorem contains paragraph A, equation, paragraph B.

Click paragraph A.

Expected:

- only paragraph A reveals source;
- theorem remains structurally visible;
- equation and paragraph B remain rendered.

### Equation editing

Click Equation body.

Expected:

- only equation source becomes editable;
- surrounding theorem remains rendered;
- apply updates math rendering.

### Style

For each built-in environment:

- correct label key;
- correct theme tokens;
- selected state differs from idle;
- accent bar appears;
- no literal UI color is hard-coded in components.

### i18n

Switch environment label locale fixture.

Expected:

- label changes;
- parser behavior unchanged;
- styles unchanged.

### Fallback

Unknown custom environment must not crash Preview.

Unsupported command must degrade locally.

Broken source must preserve valid surrounding Preview content.

---


### Virtual Block tests

Source:

```latex
% tw:block-begin type=intuition
First paragraph.

Second paragraph.
% tw:block-end
```

Expected:

- one VirtualBlock is created;
- both paragraphs remain normal ContentRegions inside it;
- PDF-facing LaTeX content remains unchanged except for comment metadata;
- clicking the VirtualBlock header selects the whole virtual block;
- clicking a paragraph edits only that paragraph.

### Disabled Environment tests

Disable `remark`.

Source:

```latex
\begin{remark}
This should remain readable.
\end{remark}
```

Expected:

- no Remark block chrome;
- no Remark label/accent;
- body remains rendered;
- no parser crash;
- source remains unchanged.

Disable Equation block styling.

Expected:

- display math still renders;
- Equation-specific block label/accent/border is absent.

---

## 30. Acceptance Criteria

v0.2.2 is accepted when:

1. ordinary text renders readably;
2. sections become StructuralBlocks;
3. theorem-like environments become configured StructuralBlocks;
4. display equations become StructuralBlocks;
5. plain paragraphs become visually invisible ContentRegions;
6. explicit blocks may contain other blocks;
7. crossing blocks are rejected/recovered;
8. block header click selects without editing;
9. selected block gets a stronger border and accent;
10. idle blocks keep only a faint boundary;
11. paragraph click reveals only that paragraph's source;
12. nested paragraph click does not reveal parent block source;
13. equation click reveals only equation source;
14. source edits update Preview;
15. Environment styles are data-driven;
16. labels use i18n keys;
17. colors use theme tokens;
18. unsupported commands degrade locally;
19. unknown environments do not crash Preview;
20. Figure and Table structures are recognized at a basic level;
21. advanced image/table editing is explicitly deferred;
22. Preview is structurally clearer than a plain PDF replica.
23. Virtual Blocks can be created from TeXWeave comment metadata without adding PDF-visible formatting.
24. Environment definitions can be disabled and re-enabled without modifying or deleting the underlying LaTeX source.

---

## 31. Recommended Development Order

```text
Phase A
PreviewNode model
SourceSpan
Section parser
ContentRegion filler
basic renderer

Phase B
Theorem
Proof
Equation
nested blocks

Phase C
selection
hover
inline source reveal/edit

Phase D
environment repository
XML config
i18n
theme tokens

Phase E
basic Figure/Table recognition
fallback handling
tests
```

---

## 32. Final Definition

> **TeXWeave Preview v0.2.2 is a high-fidelity, block-structured reading layer that renders ordinary LaTeX in a cleaner and more interactive form, exposes semantic environments as configurable StructuralBlocks, treats ordinary prose as invisible ContentRegions, and allows users to reveal and edit only the exact source corresponding to the content they click.**

This specification is the baseline for later image tools, table tools, relation graphs, semantic navigation, and AI-assisted editing.
