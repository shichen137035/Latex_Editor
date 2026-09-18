# TeXWeave v0.3.1 Technical Manual

**Version:** 0.3.1  
**Focus:** Preview editing, project math context, live math preview  
**Type:** Implementation specification  
**Priority:** Editing experience and math rendering infrastructure

---

# 1. Version Goal

v0.3.1 is primarily an editing and preview infrastructure update.

The main goals are:

1. Improve editing behavior inside Preview mode, especially around block boundaries and line breaks.
2. Make mathematical Preview understand project-defined LaTeX commands such as `\E`, `\Var`, or custom operators.
3. Add live mathematical preview in Source mode.
4. Reuse the same live math preview when editing mathematics inside Preview mode.
5. Build a shared math rendering pipeline so Preview rendering, source hover preview, and preview-mode draft editing behave consistently.

v0.3.1 should not attempt to redesign the entire block graph system introduced in v0.3.0.

---

# 2. Core Design Principles

v0.3.1 should follow the principles below.

## 2.1 Source remains authoritative

The LaTeX source remains the canonical document representation.

Preview mode is a structured representation of source, not a second document model.

---

## 2.2 Preview editing is local

When a user clicks an editable Preview node, only the relevant source fragment should normally become editable.

Example:

```latex
\begin{lemma}
This is a lemma.
\begin{equation}
1 + 1 = 2
\end{equation}
\end{lemma}
```

Clicking:

```text
This is a lemma.
```

should edit only:

```latex
This is a lemma.
```

It should not automatically expose the equation source.

---

## 2.3 Structural editing must be explicit

For composite environments such as:

```latex
\begin{lemma}
...
\end{lemma}
```

the environment header acts as the structural handle.

Selecting the header may expose actions such as:

```text
Edit environment source
Delete environment
Move environment
```

The complete environment source should only be exposed when explicitly requested.

---

## 2.4 Leaf math environments may be edited as a whole

For a leaf environment such as:

```latex
\begin{equation}
1 + 1 = 2
\end{equation}
```

clicking the formula may expose the whole environment source because the environment is a single semantic editing unit.

---

## 2.5 Draft editing and committed source are different states

Preview editing should use a temporary local draft.

```text
Committed source
      ↓
Preview edit draft
      ↓ Apply
Committed source
```

Before Apply, the underlying committed document source should remain unchanged.

Cancel or Escape should discard the draft.

Apply should commit the draft into the editor document model.

Saving to disk remains a separate operation.

```text
Preview Draft
    ↓ Apply
Editor Document
    ↓ Save / Autosave
Disk
```

---

# 3. v0.3.1 Architecture Overview

The recommended architecture is:

```text
                 Project Source
                      │
                      ↓
              Project Math Context
                      │
                      ↓
               MathMacroRegistry
                      │
                      ↓
                MathRenderService
                /       |        \
               /        |         \
              ↓         ↓          ↓
     Structured      Source      Preview-mode
      Preview        Hover          Draft
                    Preview        Preview
```

Math rendering logic must be shared.

There should not be separate KaTeX configuration logic for:

- Preview formulas;
- Source-mode hover formulas;
- Preview-mode local draft formulas.

---

# 4. Main Modules

Recommended modules:

```text
src/
├── core/
│   ├── math/
│   │   ├── MathMacroRegistry.ts
│   │   ├── MathContextBuilder.ts
│   │   ├── MathRenderService.ts
│   │   ├── MathEnvironmentRegistry.ts
│   │   ├── MathNodeLocator.ts
│   │   ├── types.ts
│   │   └── __tests__/
│   │
│   └── preview/
│       ├── PreviewEditSession.ts
│       ├── PreviewBlockBoundary.ts
│       └── __tests__/
│
├── editor/
│   ├── commands/
│   │   ├── CommandRegistry.ts
│   │   ├── KeybindingManager.ts
│   │   ├── CommandContext.ts
│   │   └── defaultKeybindings.ts
│   │
│   ├── math/
│   │   ├── LiveMathPreviewController.ts
│   │   ├── MathPreviewPopover.tsx
│   │   └── useActiveMathNode.ts
│   │
│   └── preview/
│       ├── PreviewDraftEditor.tsx
│       └── EnvironmentHeaderActions.tsx
│
└── shared/
    └── diagnostics/
```

React components should not contain macro parsing or graph-style source analysis logic.

---

# 5. Preview Editing Model

## 5.1 Editing states

A Preview-editable block should have explicit state.

```ts
type PreviewEditState =
  | "idle"
  | "selected"
  | "editing-draft"
  | "invalid-draft"
  | "applying";
```

Suggested session model:

```ts
interface PreviewEditSession {
  blockId: string;

  originalSource: string;
  draftSource: string;

  sourceStart: number;
  sourceEnd: number;

  isDirty: boolean;
  isValid: boolean;
}
```

---

# 6. Apply / Cancel Behavior

## Apply

When the user applies a draft:

```text
draft source
    ↓
validate / parse candidate
    ↓
replace original source range
    ↓
reparse affected region
    ↓
update Preview
```

If the source structure changes, block identities should be reconciled through the block parser.

---

## Cancel

Cancel should:

```text
discard draft
restore existing Preview
leave source untouched
```

No source rollback should be necessary because the committed source was never changed.

---

# 7. Temporary Invalid States

Editing LaTeX naturally creates incomplete intermediate syntax.

Example:

```latex
\frac{x}{
```

or:

```latex
\begin{equation}
x + y
```

before the closing environment has been typed.

The editor must tolerate these states.

Do not reparse the whole Preview into a broken document on every keystroke.

Instead:

```text
Draft changes
    ↓
try local parse
    ↓
valid?
 ┌─────────────┐
 │             │
yes            no
 │             │
render       keep edit session
new preview  + diagnostic
```

The user should be able to continue typing until the draft becomes valid again.

---

# 8. Block Boundary and Newline Behavior

v0.3.1 should improve the current block-boundary editing logic without attempting a complete structural editor redesign.

Two operations must be distinguished:

```text
newline inside current block
```

and:

```text
create content before/after current block
```

---

# 9. Leaf Block Newline Rules

For an editable text block:

```latex
This is a lemma.
```

pressing Enter inside the text should create a normal newline in the local draft.

At the end of a block, Enter may create additional text inside the same structural parent.

Example:

```latex
\begin{lemma}
This is a lemma.
|
\begin{equation}
...
\end{equation}
\end{lemma}
```

The new text remains inside the lemma.

It must not implicitly move the equation outside the lemma.

---

# 10. Structural Boundary Rules

A normal Enter inside a local draft should not perform a large implicit structural transformation.

For composite blocks, TeXWeave must distinguish:

```text
edit content inside the block
```

from:

```text
create new content before the whole block
create new content after the whole block
```

These are different commands.

Consider:

```latex
\begin{lemma}
aaaa
\end{lemma}
```

When the user selects the `Lemma` header, the entire lemma block is selected as one structural unit.

Two explicit block-boundary commands must then be available.

## 10.1 Insert Before Block

Default shortcut:

```text
Ctrl/Cmd + Enter
```

Equivalent source position:

```latex
|
\begin{lemma}
aaaa
\end{lemma}
```

The new editing position is outside the lemma and immediately before the entire block.

The header UI must also expose an equivalent button/action.

Suggested command ID:

```text
block.insertBefore
```

---

## 10.2 Insert After Block

Default shortcut:

```text
Shift + Enter
```

Equivalent source position:

```latex
\begin{lemma}
aaaa
\end{lemma}
|
```

The new editing position is outside the lemma and immediately after the entire block.

The header UI must also expose an equivalent button/action.

Suggested command ID:

```text
block.insertAfter
```

---

## 10.3 Important Semantic Rule

These commands operate on the **whole selected block source range**.

If the selected block occupies:

```text
[sourceStart, sourceEnd]
```

then:

```text
Insert Before
→ insertion position = sourceStart

Insert After
→ insertion position = sourceEnd
```

The commands must not depend on where the visible header text itself appears.

For composite environments, `Insert After` therefore means after the closing boundary such as:

```latex
\end{lemma}
```

not after the opening header.

Likewise, `Insert Before` means before:

```latex
\begin{lemma}
```

not merely before the first visible child.

---

## 10.4 Parent Context

The inserted editing position belongs to the selected block's parent structural context.

Example:

```latex
\begin{theorem}

    \begin{lemma}
    aaaa
    \end{lemma}

\end{theorem}
```

Selecting the lemma header and using `Insert After` should create a position after the lemma but still inside the theorem:

```latex
\begin{theorem}

    \begin{lemma}
    aaaa
    \end{lemma}

    |

\end{theorem}
```

It must not escape the theorem unless the theorem itself is the selected block.

---

## 10.5 Complete Leaf Blocks

For a complete leaf block, ordinary direct editing remains simple.

Example:

```latex
\begin{equation}
x+y=1
\end{equation}
```

Clicking the formula may expose the complete equation source.

The block-boundary commands are still available when the block itself is selected, but they are not required merely to edit its contents.

# 11. Project Math Context

The current Preview renderer must stop treating each formula as isolated LaTeX.

A formula depends on project-level definitions.

Example:

```latex
\newcommand{\E}{\mathbb{E}}
```

followed by:

```latex
\[
\E[X]
\]
```

The formula renderer must know that:

```latex
\E
```

means:

```latex
\mathbb{E}
```

---

# 12. Math Context Model

Recommended type:

```ts
export interface MathContext {
  macros: Record<string, string>;
  operators: Record<string, string>;
  sourceVersion: number;
}
```

Minimal first version may combine everything into `macros`.

Example:

```ts
{
  "\\E": "\\mathbb{E}",
  "\\Var": "\\operatorname{Var}",
  "\\Cov": "\\operatorname{Cov}"
}
```

---

# 13. MathMacroRegistry

Recommended class:

```ts
export class MathMacroRegistry {
  private macros = new Map<string, string>();

  rebuild(project: ProjectSnapshot): void;

  getMacros(): Record<string, string>;

  get(name: string): string | undefined;

  has(name: string): boolean;
}
```

This registry should be project-scoped.

Do not rebuild it separately for every formula.

---

# 14. Supported Macro Definitions

v0.3.1 should support at least:

```latex
\newcommand
\renewcommand
\providecommand
\DeclareMathOperator
```

Examples:

```latex
\newcommand{\E}{\mathbb{E}}
\renewcommand{\P}{\mathbb{P}}
\providecommand{\Var}{\operatorname{Var}}
\DeclareMathOperator{\Cov}{Cov}
```

Support for commands with arguments should be included when feasible.

Example:

```latex
\newcommand{\norm}[1]{\left\lVert #1 \right\rVert}
```

The internal representation must preserve argument placeholders.

---

# 15. Optional Later Macro Support

These are not mandatory for the first implementation:

```latex
\def
\DeclareRobustCommand
\NewDocumentCommand
complex TeX conditionals
dynamic macro construction
```

Avoid attempting to implement a full TeX interpreter.

---

# 16. Macro Discovery Scope

The Math Context should be built from project-visible sources.

Initial supported sources:

```text
main .tex preamble
local \input files
local \include files
local project .sty files
```

Example:

```latex
\usepackage{mymath}
```

with:

```latex
% mymath.sty
\newcommand{\E}{\mathbb{E}}
```

should make `\E` available when `mymath.sty` exists inside the project.

---

# 17. External Packages

Do not attempt to recursively interpret the full TeX installation.

For standard packages:

```latex
\usepackage{amsmath}
\usepackage{amssymb}
```

the renderer should rely on commands already supported by KaTeX or explicitly configured compatibility mappings.

The project parser should not try to become a TeX engine.

---

# 18. Macro Precedence

Macro definitions should approximately follow document order.

For example:

```latex
\newcommand{\A}{X}
\renewcommand{\A}{Y}
```

should result in:

```text
\A → Y
```

A simple ordered scan is acceptable for v0.3.1.

When conflicting definitions exist:

```text
latest applicable definition wins
```

provided this does not contradict the intended project parsing model.

---

# 19. Macro Context Invalidation

The Math Context must be rebuilt when relevant project sources change.

Triggers include:

```text
main file changed
preamble changed
local .sty changed
\input target changed
\include target changed
macro definition edited
```

Use project/version invalidation rather than rescanning on every formula render.

---

# 20. MathRenderService

All formula rendering should go through one service.

Recommended interface:

```ts
export interface MathRenderOptions {
  displayMode: boolean;
  throwOnError?: boolean;
}

export interface MathRenderResult {
  html?: string;
  error?: MathRenderError;
}

export class MathRenderService {
  render(
    source: string,
    context: MathContext,
    options: MathRenderOptions
  ): MathRenderResult;
}
```

---

# 21. Shared Renderer Requirement

The following must all call the same render service:

```text
Preview formula rendering
Source-mode hover preview
Source-mode cursor preview
Preview-mode draft preview
```

This guarantees consistent custom macro behavior.

---

# 22. Math Node Detection

The editor must identify mathematical regions reliably.

Do not rely on ad-hoc regex detection during mouse movement.

Math regions should be identified during source parsing.

Recommended node:

```ts
export interface MathNode {
  id: string;

  start: number;
  end: number;

  contentStart: number;
  contentEnd: number;

  kind:
    | "inline-dollar"
    | "inline-paren"
    | "display-dollar"
    | "display-bracket"
    | "environment";

  environmentName?: string;

  displayMode: boolean;
}
```

---

# 23. Supported Math Syntax

v0.3.1 should recognize at least:

## Inline

```latex
$x+y$
```

```latex
\(x+y\)
```

---

## Display

```latex
$$x+y$$
```

```latex
\[
x+y
\]
```

---

## Environments

At minimum:

```latex
equation
equation*
align
align*
aligned
gather
gather*
multline
multline*
split
cases
```

The registry should be extensible.

---

# 24. Math Environment Registry

Avoid hardcoding environment checks throughout the codebase.

Use:

```ts
interface MathEnvironmentDefinition {
  name: string;
  displayMode: boolean;
}

const MATH_ENVIRONMENTS = new Map<
  string,
  MathEnvironmentDefinition
>();
```

This allows future environments to be added centrally.

---

# 25. Locating Math Under Cursor

Given an editor offset:

```ts
offset: number
```

the system should find the smallest containing MathNode.

Recommended API:

```ts
findMathNodeAtOffset(
  offset: number
): MathNode | null;
```

If nested mathematical structures exist, return the most relevant editable math unit rather than an arbitrary outer source range.

---

# 26. Efficient Math Node Lookup

For normal document sizes, a sorted interval list is sufficient.

Possible implementation:

```text
MathNode[]
sorted by start offset
```

Use binary search to locate candidates.

Do not scan the entire document on every mousemove.

---

# 27. Live Math Preview Controller

A shared controller should decide whether the floating preview is visible.

Suggested input sources:

```text
cursor inside math
mouse hovering math
Preview draft currently editing math
```

Recommended priority:

```text
Preview draft math
    >
cursor math
    >
hovered math
```

This prevents competing previews.

---

# 28. Source Mode Live Preview

When the user places the cursor inside a formula:

```latex
\[
\E[X_t \mid X_{t-1}]
\]
```

show a floating rendered preview near the formula.

The preview should remain visible while the cursor stays inside the MathNode.

Mouse hover may also activate it.

---

# 29. Live Update Behavior

While the user edits:

```latex
\E[X_t]
```

into:

```latex
\E[X_t^2]
```

the floating preview should update automatically.

Data flow:

```text
Editor buffer changes
       ↓
current MathNode source
       ↓
MathRenderService
       ↓
floating preview update
```

Do not require saving or leaving the formula.

---

# 30. Debouncing

Rendering should not block every keystroke.

Recommended debounce:

```text
50–100 ms
```

Exact value should be tuned experimentally.

Because formulas are usually small and KaTeX is fast, this should feel effectively real-time.

---

# 31. Local Rendering Only

Editing one formula should not rerender the entire Preview document.

Only the active formula preview should rerender.

This is essential for large papers.

---

# 32. Floating Preview Placement

Default placement:

```text
above active formula
```

Fallback:

```text
below active formula
```

when there is insufficient space.

The preview should avoid covering:

```text
current cursor line
selection
completion popup
diagnostics
```

Use an overlay/portal.

Do not insert the preview into the editor's text layout.

---

# 33. Preview Popover UI

Suggested minimal structure:

```text
┌───────────────────────────┐
│ rendered formula          │
└───────────────────────────┘
```

Optional secondary state:

```text
┌───────────────────────────┐
│ previous valid formula    │
│ ⚠ incomplete expression  │
└───────────────────────────┘
```

Keep the component visually lightweight.

---

# 34. Handling Invalid Math During Typing

Incomplete or invalid mathematical input should display the **current invalid source**, not the previous valid preview.

Example:

```latex
\frac{x}{
```

The floating preview should immediately reflect this current state.

When KaTeX cannot parse the expression, use KaTeX's non-throwing error rendering behavior.

Recommended configuration:

```ts
katex.render(source, target, {
  throwOnError: false,
  macros: mathContext.macros
});
```

The invalid content should therefore appear in the preview using the renderer's error presentation, normally red.

Conceptually:

```text
valid current math
→ rendered formula

invalid / incomplete current math
→ current invalid source rendered as an error
→ red error presentation
```

Do not preserve the previous successful formula as the primary preview.

As soon as the user completes the expression:

```latex
\frac{x}{y}
```

the preview should automatically return to normal mathematical rendering.

This approach has three advantages:

1. the floating preview always corresponds to what the user is currently typing;
2. no "last successful preview" state needs to be maintained;
3. error behavior remains consistent with the underlying math renderer.

# 35. Render Error Model

Suggested type:

```ts
export interface MathRenderError {
  message: string;
  position?: number;
  recoverable: boolean;
}
```

Errors during active typing should generally be treated as recoverable.

---

# 36. Preview-Mode Math Editing

When a user clicks a leaf formula in Preview mode:

```text
Rendered formula
      ↓ click
Local source draft
```

Example:

```latex
\begin{equation}
\E[X]
\end{equation}
```

The local source editor should appear.

At the same time, a floating live formula preview should appear near the draft.

---

# 37. Draft Preview Data Source

This preview must render from:

```text
draftSource
```

not:

```text
committed document source
```

Therefore:

```latex
\E[X]
```

may still exist in the committed source while the user has typed:

```latex
\E[X^2]
```

into the draft.

The floating preview must show:

```text
E[X²]
```

immediately.

---

# 38. Preview Draft Math Extraction

If the draft includes delimiters:

```latex
\begin{equation}
\E[X]
\end{equation}
```

the preview service should extract the mathematical body appropriately.

Do not blindly send environment wrappers to a renderer that expects only body content unless the selected renderer supports them.

This logic should live in the math parser/render adapter rather than React.

---

# 39. Composite Environment Behavior

For:

```latex
\begin{lemma}
Text.
\begin{equation}
1+1=2
\end{equation}
\end{lemma}
```

clicking `Text.` edits only the paragraph.

Clicking the equation edits the equation.

Clicking the lemma header selects the environment.

The complete lemma source is only exposed through an explicit environment-level command.

---

# 40. Environment Header Actions

For selected composite environments, the header may expose:

```text
Edit source
Delete
Move
More…
```

Exact UI is outside the strict v0.3.1 backend scope.

The important rule is:

```text
header = structural handle
content = local content editing
```

---

# 41. Leaf vs Composite Environment

Do not classify solely by whether the LaTeX source contains nested `\begin...\end`.

Instead classify based on Preview-editable children.

A formula containing:

```latex
\begin{matrix}
...
\end{matrix}
```

may still be one leaf math block.

A lemma containing:

```text
paragraph
equation
paragraph
```

is composite because those children are independently editable Preview blocks.

---

# 42. Suggested Type

```ts
type PreviewBlockEditKind =
  | "leaf"
  | "composite";
```

Or derive this from the parsed Preview tree rather than persisting it.

---

# 43. Source Mode and Preview Mode Must Share Math Semantics

The following formula:

```latex
\E[X]
```

must render the same way in:

```text
normal Preview
Source hover preview
Source cursor preview
Preview draft preview
```

If one succeeds and another fails, the architecture is wrong.

---

# 44. Diagnostics for Unknown Macros

When rendering:

```latex
\Foo[X]
```

and `\Foo` cannot be resolved:

- do not crash;
- report the unknown macro;
- preserve editing;
- optionally show raw fallback/error text.

Suggested diagnostic:

```text
Unknown math command: \Foo
```

This may later support quick actions such as:

```text
Define command
Search project
Ignore
```

These actions are not required in v0.3.1.

---

# 45. Project Macro Parsing Strategy

Recommended first implementation:

1. Parse project files already known to the project loader.
2. Extract relevant macro declarations.
3. Process them in deterministic source order.
4. Build a macro registry.
5. Pass the registry to every math render request.

Avoid executing arbitrary TeX macros.

The parser should be conservative.

---

# 46. Macro Parser Output

Suggested representation:

```ts
interface ParsedMacroDefinition {
  name: string;
  replacement: string;
  argumentCount: number;
  sourceFile: string;
  sourceStart: number;
  sourceEnd: number;
}
```

This provides future support for:

```text
go to definition
macro inspection
diagnostics
```

without redesigning the parser.

---

# 47. File Dependency Awareness

If:

```latex
\input{macros}
```

or:

```latex
\usepackage{localmath}
```

points to project-local files, changes to those files must invalidate the Math Context.

The project file dependency system should notify the registry rather than the registry polling the filesystem itself.

---

# 48. Performance Goals

v0.3.1 should avoid project-wide synchronous work during interactive editing.

Target architecture:

```text
project macro scan
    → event-driven / cached

math node parsing
    → incremental if possible

active formula rendering
    → local only

popover update
    → debounced
```

Do not rebuild the entire Preview tree for every math keystroke.

---

# 49. Recommended Caching

Safe caches include:

```text
project macro registry
parsed MathNode ranges
current active formula render result
```

Do not maintain a separate "last successful formula" cache merely to mask invalid input. Invalid current input should be rendered as the current error state.

Cache invalidation must be explicit.

---

# 50. Math Preview State

Suggested UI state:

```ts
interface LiveMathPreviewState {
  visible: boolean;

  nodeId: string | null;

  source: string;

  html: string | null;

  error: MathRenderError | null;

  anchorRect: DOMRect | null;

  sourceKind:
    | "source-cursor"
    | "source-hover"
    | "preview-draft"
    | null;
}
```

---

# 51. Event Flow: Source Cursor Preview

```text
cursor moved
    ↓
find MathNode at cursor
    ↓
same node as before?
 ┌────────────┐
 │            │
yes           no
 │            │
reuse      load source
             ↓
       render formula
             ↓
       position popover
```

---

# 52. Event Flow: Source Editing

```text
editor text changed
      ↓
is cursor inside active MathNode?
      ↓
update local source slice
      ↓
debounce
      ↓
render
      ↓
replace popover content
```

If parsing ranges temporarily become stale during malformed editing, the active edit session should retain enough local context to continue rendering until the parser catches up.

---

# 53. Event Flow: Preview Draft Editing

```text
click Preview formula
      ↓
create PreviewEditSession
      ↓
open draft editor
      ↓
activate LiveMathPreviewController
      ↓
draft changes
      ↓
debounced render
      ↓
floating preview update
```

Apply:

```text
draft
  ↓
commit source
  ↓
reparse
  ↓
close draft editor
  ↓
normal Preview rerenders
```

Cancel:

```text
discard draft
close live preview
restore existing rendered block
```

---

# 54. Accessibility / Keyboard Behavior

The live preview must not require mouse interaction.

At minimum:

```text
cursor enters formula
→ preview appears
```

and:

```text
cursor leaves formula
→ preview disappears
```

Mouse hover is an additional activation path.

Preview draft editing should remain usable entirely from keyboard.

---

# 55. Keyboard Command System

All keyboard shortcuts introduced by TeXWeave must be implemented through a configurable command/keybinding layer.

No user-facing shortcut should be permanently hardcoded inside block or editor components.

The Settings UI must provide a shortcut panel where users can inspect and change bindings.

Recommended command model:

```ts
interface EditorCommand {
  id: string;
  title: string;
  context: string;
  defaultShortcut?: string;
}
```

Suggested commands for v0.3.1:

```text
block.insertBefore
block.insertAfter
preview.applyDraft
preview.cancelDraft
environment.editSource
```

---

## 55.1 Default Header-Selection Bindings

When a structural block header is selected:

```text
Ctrl/Cmd + Enter
→ Insert Before Block

Shift + Enter
→ Insert After Block
```

These commands are equivalent to placing the cursor:

```latex
|
\begin{lemma}
aaaa
\end{lemma}
```

and:

```latex
\begin{lemma}
aaaa
\end{lemma}
|
```

respectively.

Both operations must also be available through visible header actions/buttons.

---

## 55.2 Context-Sensitive Shortcuts

Shortcut dispatch must consider editor context.

For example, the same physical key combination may be assigned to different commands in mutually exclusive contexts if desired.

Possible contexts include:

```text
block-header-selected
preview-draft-editing
source-editor
math-preview-active
```

The command system, rather than individual React components, resolves which command is active.

---

## 55.3 Draft Editing Commands

Preview draft editing must provide explicit commands for:

```text
Apply Draft
Cancel Draft
```

Their default shortcuts may be configured separately.

`Escape` may remain the default for canceling a draft.

If `Ctrl/Cmd + Enter` is also used as an Apply shortcut in draft-editing context, that is acceptable because the block-header-selected and draft-editing contexts are distinct. The shortcut panel must make this context clear and allow reassignment.

---

## 55.4 Settings Requirement

The Settings interface must expose a dedicated shortcut/keybinding panel.

At minimum, each entry should show:

```text
Command name
Current shortcut
Context
Reset to default
Change shortcut
```

Conflict detection should warn when two commands compete in the same active context.

Cross-context reuse is allowed when contexts cannot be active simultaneously.

# 56. Testing Strategy

v0.3.1 needs three main test families:

```text
macro parsing
math node detection/rendering
Preview editing
```

---

# 57. Macro Tests

## Case 1

Input:

```latex
\newcommand{\E}{\mathbb{E}}
```

Formula:

```latex
\E[X]
```

Expected:

- macro registry contains `\E`;
- formula renders successfully.

---

## Case 2

```latex
\newcommand{\norm}[1]{\left\lVert #1\right\rVert}
```

Formula:

```latex
\norm{x}
```

Expected:

- argument macro works.

---

## Case 3

```latex
\newcommand{\A}{X}
\renewcommand{\A}{Y}
```

Expected final value:

```text
\A → Y
```

---

## Case 4

Macro defined inside project-local `.sty`.

Expected:

- macro becomes available to Preview renderer.

---

## Case 5

Unknown macro.

Expected:

- renderer returns diagnostic;
- editor does not crash.

---

# 58. Math Node Tests

## Inline dollar

```latex
Text $x+y$ text.
```

Cursor on `x`.

Expected:

```text
MathNode = $x+y$
```

---

## Inline parenthesis

```latex
Text \(x+y\) text.
```

Expected correct node.

---

## Display bracket

```latex
\[
x+y
\]
```

Expected display node.

---

## Equation

```latex
\begin{equation}
x+y
\end{equation}
```

Expected equation node.

---

## Align

```latex
\begin{align}
x &= y \\
z &= w
\end{align}
```

Expected one editable math environment unless later block logic intentionally splits it.

---

# 59. Nested Math Tests

Example:

```latex
\[
\begin{matrix}
a & b \\
c & d
\end{matrix}
\]
```

Expected:

- outer display formula is treated as the editable math unit;
- nested matrix does not create an unrelated floating preview.

---

# 60. Source Live Preview Tests

## Cursor activation

Cursor enters formula.

Expected:

```text
popover visible
```

Cursor leaves.

Expected:

```text
popover hidden
```

---

## Hover activation

Mouse enters formula while cursor is elsewhere.

Expected:

```text
popover visible
```

Cursor inside another formula should take priority.

---

## Live update

Edit:

```latex
x
```

to:

```latex
x^2
```

Expected:

- preview updates without saving;
- whole document Preview is not rerendered.

---

# 61. Invalid Math Tests

Type:

```latex
\frac{x}{
```

Expected:

- no crash;
- floating preview reflects the current invalid expression;
- invalid content is displayed using the renderer's error presentation, normally red;
- previous valid formula is not kept as the primary preview.

Complete:

```latex
\frac{x}{y}
```

Expected:

- preview immediately returns to normal valid rendering.

# 62. Preview Draft Tests

Start:

```latex
\begin{equation}
\E[X]
\end{equation}
```

Click equation.

Expected:

- source draft opens;
- floating formula preview opens.

Edit draft:

```latex
\E[X^2]
```

Expected:

- floating preview changes immediately;
- committed source remains unchanged.

Apply.

Expected:

- committed source changes;
- normal Preview displays new formula.

---

# 63. Cancel Draft Test

Modify draft but press Escape.

Expected:

```text
source unchanged
Preview restored
live preview closed
```

---

# 64. Composite Environment Test

Input:

```latex
\begin{lemma}
This is a lemma.
\begin{equation}
1+1=2
\end{equation}
\end{lemma}
```

Click text.

Expected:

```text
only paragraph source editable
```

Click equation.

Expected:

```text
equation editable as leaf math block
```

Click lemma header.

Expected:

```text
lemma environment selected
```

Complete source editing requires explicit action.

---

# 65. Block Boundary Command Tests

Given:

```latex
\begin{lemma}
aaaa
\end{lemma}
```

Select the lemma header.

## Insert Before

Invoke:

```text
block.insertBefore
```

default:

```text
Ctrl/Cmd + Enter
```

Expected logical source position:

```latex
|
\begin{lemma}
aaaa
\end{lemma}
```

The lemma itself remains unchanged.

---

## Insert After

Invoke:

```text
block.insertAfter
```

default:

```text
Shift + Enter
```

Expected logical source position:

```latex
\begin{lemma}
aaaa
\end{lemma}
|
```

The insertion point must be after the entire source range, including `\end{lemma}`.

---

## Nested Parent Context

Given:

```latex
\begin{theorem}
\begin{lemma}
aaaa
\end{lemma}
\end{theorem}
```

Select the lemma header and invoke `Insert After`.

Expected:

```latex
\begin{theorem}
\begin{lemma}
aaaa
\end{lemma}
|
\end{theorem}
```

The insertion point remains inside the theorem.

---

## UI Parity

The header buttons and keyboard shortcuts must execute the same underlying commands.

Expected:

```text
button action == keyboard action
```

with identical source insertion behavior.

---

## Shortcut Configuration

Rebind `block.insertAfter` to another key in Settings.

Expected:

- new binding works immediately or after the normal settings refresh cycle;
- old binding no longer triggers the command;
- command behavior is unchanged.

# 66. Regression Tests

v0.3.1 must not break:

```text
existing source compilation
existing PDF preview
existing block parsing
existing section navigation
existing Preview rendering
existing block IDs
v0.3.0 relationship backend
```

---

# 67. Error Handling

Interactive math errors should never block editing.

Categories:

```text
unknown macro
temporary incomplete syntax
unsupported environment
renderer failure
macro parser failure
```

The preferred behavior is:

```text
diagnose locally
preserve editor
avoid global Preview crash
```

---

# 68. Logging

During development, timing logs should be available for:

```text
MathContext rebuild
MathNode parse
active formula render
popover update
Preview draft parse
```

This will help detect cases where math preview causes UI stalls.

Production logging may be reduced later.

---

# 69. Security / Robustness

Do not execute arbitrary shell commands or TeX code to resolve Preview macros.

The Math Context parser should interpret only supported declarative macro definitions.

This avoids turning Preview rendering into a TeX execution environment.

---

# 70. Non-Goals for v0.3.1

The following are not required:

```text
full TeX macro engine
full package interpreter
automatic macro rewriting
AI formula correction
symbol definition lookup
semantic math analysis
formula dependency graph
complete environment structural editing UI
```

Keep this release focused.

---

# 71. Recommended Implementation Order

## Phase 1 — Shared math rendering

Implement:

```text
MathContext
MathMacroRegistry
MathRenderService
```

Ensure existing Preview uses it.

---

## Phase 2 — Project macro discovery

Support:

```text
\newcommand
\renewcommand
\providecommand
\DeclareMathOperator
local .sty
local input/include
```

Verify custom commands render correctly.

---

## Phase 3 — Math node indexing

Implement reliable detection of:

```text
inline math
display math
equation
align
other registered math environments
```

---

## Phase 4 — Source live preview

Implement:

```text
cursor activation
hover activation
popover positioning
debounced live updates
temporary invalid-state handling
```

---

## Phase 5 — Preview-mode formula draft preview

Reuse the same renderer/controller for Preview editing.

---

## Phase 6 — Block boundary commands and keybindings

Implement:

```text
block.insertBefore
block.insertAfter
header action buttons
context-aware shortcut routing
shortcut settings integration
parent-context preservation
```

Default header-selection bindings:

```text
Ctrl/Cmd + Enter → before whole block
Shift + Enter    → after whole block
```

Do this without introducing a large structural-editing redesign.

---

# 72. Completion Criteria

v0.3.1 can be considered complete when:

```text
✓ Custom project math commands render in Preview

✓ Local project macro files are recognized

✓ Source mode detects inline and display formulas

✓ Cursor inside a formula opens a rendered preview

✓ Hovering a formula can open the preview

✓ Formula preview updates while source is edited

✓ Preview-mode math draft shows the same live preview

✓ Draft preview uses uncommitted draft source

✓ Invalid intermediate math shows the current error state directly

✓ Invalid math is rendered with the math renderer's visible error presentation

✓ All math rendering paths use the same MathRenderService

✓ Composite environments still support local child editing

✓ Leaf math environments can be edited as a whole

✓ Selected block headers support explicit Insert Before and Insert After actions

✓ Ctrl/Cmd + Enter defaults to Insert Before Block in header-selection context

✓ Shift + Enter defaults to Insert After Block in header-selection context

✓ Equivalent header buttons call the same commands

✓ Block-boundary insertion preserves the selected block's parent context

✓ All user-facing shortcuts are configurable from the shortcut settings panel

✓ Existing compilation and Preview behavior remain functional
```

---

# 73. Final Architecture Summary

The central idea of v0.3.1 is:

```text
              LaTeX Project
                    │
                    ↓
           Project Math Context
                    │
                    ↓
           Shared Math Renderer
          /          |          \
         /           |           \
        ↓            ↓            ↓
 Structured      Source Live   Preview Draft
  Preview          Preview        Preview
```

Preview editing should remain local and draft-based:

```text
Rendered block
     ↓
Local source draft
     ↓
Live local preview
     ↓
Apply
     ↓
Committed source
```

The result should make mathematical editing feel continuous between Source mode and Preview mode rather than treating them as two separate editing systems.

The long-term target is not merely "render LaTeX correctly", but:

> make the relationship between mathematical source and rendered mathematical structure immediately visible while editing.

That principle should guide all v0.3.1 implementation choices.
