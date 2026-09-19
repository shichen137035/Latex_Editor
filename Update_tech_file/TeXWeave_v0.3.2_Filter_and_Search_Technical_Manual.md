# TeXWeave v0.3.2 Technical Manual
## Advanced Search, Filter, and Filtered Preview

**Version:** 0.3.2  
**Focus:** Search / Replace, structural filtering, filtered Preview browsing  
**Type:** Implementation specification

---

# 1. Version Goal

v0.3.2 introduces a dedicated **Search + Filter + Filtered Preview** system.

The version should clearly separate three concepts:

```text
Search
= find text

Filter
= select blocks by structural/property conditions

Filter View
= decide how unmatched blocks are displayed
```

These systems may work together, but they must remain architecturally independent.

The main goals are:

1. Implement the left-side advanced Search panel.
2. Support text and phrase search across the current file or project.
3. Support case sensitivity, whole-word matching, regex, navigation, replace, and replace-all.
4. Introduce a structural Filter system with multiple condition groups.
5. Support OR logic inside appropriate groups and AND logic between groups.
6. Add Preview browsing modes:
   - Original
   - Dim
   - Collapse
   - Remove
7. Highlight matching blocks while handling non-matching blocks according to the selected Filter View.
8. Preserve structural context for nested matching blocks.
9. Keep Search text highlighting visually distinct from Filter block highlighting.
10. Keep all operations non-destructive unless the user explicitly performs Replace.

---

# 2. Core Concept Separation

Search and Filter must not share one unified query model.

They answer different questions.

## Search

Search answers:

> Where does this text occur?

Typical inputs:

```text
word
phrase
whole word
case-sensitive text
regular expression
```

## Filter

Filter answers:

> Which blocks belong to the set I currently care about?

Typical conditions:

```text
Block Type
Document Location
File
Content Properties
```

## Filter View

Filter View answers:

> What should happen to blocks that do not match the current Filter?

Possible modes:

```text
Original
Dim
Collapse
Remove
```

---

# 3. System Architecture

Recommended high-level data flow:

```text
                    Document / Block Model
                             │
                             ↓
                        Filter Engine
                             │
                             ↓
                 Filtered Block State
                             │
                             ↓
                      Filter View
            Original / Dim / Collapse / Remove
                             │
                             ↓
                      Visible Preview
                             │
                             ↓
                       Search Engine
                             │
                             ↓
                  Text Match Highlighting
```

Search and Filter are independent modules.

They may be active at the same time.

---

# 4. Recommended Module Structure

```text
src/
├── core/
│   ├── search/
│   │   ├── SearchEngine.ts
│   │   ├── SearchIndex.ts
│   │   ├── SearchQuery.ts
│   │   ├── ReplaceEngine.ts
│   │   ├── types.ts
│   │   └── __tests__/
│   │
│   ├── filter/
│   │   ├── FilterEngine.ts
│   │   ├── FilterQuery.ts
│   │   ├── FilterGroup.ts
│   │   ├── FilterCondition.ts
│   │   ├── FilterContextResolver.ts
│   │   ├── types.ts
│   │   └── __tests__/
│   │
│   └── preview/
│       ├── FilteredPreviewModel.ts
│       ├── CollapsePlanner.ts
│       └── __tests__/
│
├── editor/
│   ├── search/
│   │   ├── AdvancedSearchPanel.tsx
│   │   ├── SearchInput.tsx
│   │   ├── ReplacePanel.tsx
│   │   ├── SearchResultList.tsx
│   │   └── SearchOptions.tsx
│   │
│   ├── filter/
│   │   ├── FilterPanel.tsx
│   │   ├── FilterGroupSection.tsx
│   │   ├── FilterChip.tsx
│   │   ├── FilterViewSelector.tsx
│   │   └── FilterToggle.tsx
│   │
│   └── preview/
│       └── FilteredPreviewRenderer.tsx
│
└── shared/
    └── commands/
```

React components should consume Search/Filter state and results rather than implementing query logic directly.

---

# 5. Search System

The Search system is text-oriented.

It must remain separate from block/property filtering.

Recommended query type:

```ts
export interface SearchQuery {
  text: string;

  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;

  scope: SearchScope;
}
```

Recommended scope:

```ts
export type SearchScope =
  | "current-file"
  | "entire-project";
```

Future versions may add:

```text
current selection
current section
current block
```

but these are not required for v0.3.2.

---

# 6. Search Features

v0.3.2 should support:

```text
1. Text search
2. Phrase search
3. Case Sensitive
4. Whole Word
5. Regex
6. Previous Match
7. Next Match
8. Highlight All
9. Replace Current
10. Replace All
11. Current File scope
12. Entire Project scope
13. Search result list
```

---

# 7. Search Defaults

Recommended defaults:

```text
Case Sensitive = false
Whole Word     = false
Regex          = false
Scope          = Current File
```

Example:

```text
query = model
```

with default options may match:

```text
model
Model
models
modeling
```

If Whole Word is enabled:

```text
model
Model
```

match, while:

```text
models
modeling
```

do not.

---

# 8. Search Result Model

Recommended result structure:

```ts
export interface SearchResult {
  id: string;

  fileId: string;

  blockId?: string;

  sourceStart: number;
  sourceEnd: number;

  matchStart: number;
  matchEnd: number;

  previewSnippet: string;

  sectionContext?: string;
  blockType?: string;
}
```

Search should retain source positions so clicking a result can navigate accurately.

---

# 9. Search Result Navigation

Required operations:

```ts
nextMatch(): void;
previousMatch(): void;
selectMatch(resultId: string): void;
```

Recommended default behavior while the search input is focused:

```text
Enter
→ next result

Shift + Enter
→ previous result
```

These shortcuts belong to the Search context and should coexist with the context-sensitive keybinding system introduced earlier.

---

# 10. Search Highlighting

Search highlighting is **text-level**, not block-level.

Preview behavior:

```text
all text matches
→ normal search highlight

current match
→ stronger active highlight
```

Search must not highlight an entire theorem or paragraph simply because it contains a matching word.

That responsibility belongs to Filter.

---

# 11. Regex Search

Regex should be supported in v0.3.2.

UI toggle:

```text
.*
```

When regex is enabled:

```ts
useRegex = true;
```

Whole-word behavior may either:

1. be disabled automatically; or
2. be applied as an additional wrapper.

The first implementation should prefer predictable behavior over complex combinations.

If the regex is invalid:

```text
show local query error
do not crash
do not execute replacement
```

---

# 12. Replace System

Replace should be integrated into Search, not Filter.

UI:

```text
Search
[ Gaussian ]

▸ Replace
```

Expanded:

```text
Search
[ Gaussian ]

Replace
[ Student-t ]

[ Replace ] [ Replace All ]
```

Required operations:

```ts
replaceCurrent(
  result: SearchResult,
  replacement: string
): void;

replaceAll(
  results: SearchResult[],
  replacement: string
): ReplaceSummary;
```

---

# 13. Replace Scope and Filter Interaction

When Filter is inactive:

```text
Replace All
→ all Search matches inside Search scope
```

When Filter is active:

```text
Replace All
→ Search matches inside the active filtered browsing set
```

This should be explicit in the UI.

Example:

```text
Replace all 12 matches in current filter
```

This avoids ambiguity for destructive actions.

---

# 14. Replace Safety

Replace All should:

1. calculate the full replacement plan before applying;
2. resolve source ranges from end to beginning or use a transaction system;
3. produce one undoable editor transaction where possible;
4. update Search results after completion.

Recommended result:

```ts
export interface ReplaceSummary {
  replacedCount: number;
  skippedCount: number;
  affectedFiles: string[];
}
```

---

# 15. Filter System

Filter is block-oriented.

It must not include text-search conditions such as:

```text
contains word
contains phrase
title contains
regex text
```

Those belong to Search.

Filter evaluates block metadata and document structure.

---

# 16. v0.3.2 Default Filter Groups

v0.3.2 should implement four groups:

```text
1. Block Type
2. Document Location
3. File
4. Content Properties
```

Reserved for future versions:

```text
Tag
Logical Relationship
Structural Relationship
```

These should not block v0.3.2.

---

# 17. Filter Group Logic

The default logical model is:

```text
OR inside categorical groups
AND between groups
```

Example:

```text
Block Type:
Lemma
Theorem
Proposition
```

means:

\[
Lemma \lor Theorem \lor Proposition.
\]

If Location contains:

```text
Methods
Theory
```

then:

\[
Methods \lor Theory.
\]

Together:

\[
(Lemma \lor Theorem \lor Proposition)
\land
(Methods \lor Theory).
\]

---

# 18. Filter Query Model

Recommended representation:

```ts
export interface FilterQuery {
  enabled: boolean;
  groups: FilterGroup[];
}

export interface FilterGroup {
  id: string;
  type: FilterGroupType;
  operator: "OR" | "AND";
  conditions: FilterCondition[];
}
```

Even if some group operators are fixed in v0.3.2, keeping the operator in the data model leaves room for future expansion.

---

# 19. Top-Level Group Combination

The top-level Filter query should use:

```text
AND
```

between active groups.

Conceptually:

```ts
const matches =
  activeGroups.every(group =>
    evaluateGroup(group, block)
  );
```

Empty groups should not restrict the result.

---

# 20. Block Type Group

Block Type is the most important group.

Suggested initial options:

```text
Section
Subsection
Paragraph
Definition
Lemma
Theorem
Proposition
Corollary
Equation
Figure
Table
Algorithm
List
Custom Block
```

Multiple selected values are OR.

---

# 21. Document Location Group

Document Location filters blocks by structural position.

Recommended UI:

```text
Introduction
Methods
├─ Model
├─ Estimation
└─ Theory
Results
Appendix
```

Multiple selected locations are OR.

A block should match a selected location if it is structurally contained within that section/subsection.

---

# 22. File Group

The File group is important for multi-file LaTeX projects.

Multiple selections are OR.

For single-file projects, this group may be visually de-emphasized or collapsed.

---

# 23. Content Properties Group

Content Properties represent independent boolean predicates.

Suggested first properties:

```text
Has Math
Has Citation
Has Label
Has Figure
Has Table
Has Reference
```

Unlike categorical groups, selected content properties should default to:

```text
AND
```

Example:

```text
Has Math
Has Citation
```

means:

\[
HasMath \land HasCitation.
\]

---

# 24. Generic Filter Condition Interface

Recommended abstraction:

```ts
export interface FilterConditionEvaluator {
  matches(
    block: Block,
    context: FilterContext
  ): boolean;
}
```

Example union:

```ts
export type FilterCondition =
  | BlockTypeCondition
  | DocumentLocationCondition
  | FileCondition
  | ContentPropertyCondition;
```

Adding a future Tag or Logical Relationship filter should not require redesigning the Filter Engine.

---

# 25. Filter Result States

Each Preview block should receive one of three states:

```ts
export type FilterState =
  | "match"
  | "context"
  | "unmatched";
```

Meaning:

```text
match
→ directly satisfies the Filter

context
→ does not directly satisfy Filter,
  but must remain visible to preserve structural context

unmatched
→ neither match nor required structural context
```

---

# 26. Context Closure

Nested blocks create an important structural issue.

Example:

```text
Lemma A
├── Paragraph
└── Equation B
```

Filter:

```text
Block Type = Equation
```

Equation B matches.

Lemma A does not.

If the parent were completely removed, the matching equation could disappear with it.

Therefore the Filter system must compute a **structural context closure**.

Given the direct match set:

\[
M
\]

the visible context should include required structural ancestors:

\[
M \cup Ancestors_{structural}(M).
\]

---

# 27. Context Example

Input:

```text
Lemma A
├── Paragraph
└── Equation B
```

Filter:

```text
Equation
```

States:

```text
Lemma A       context
Paragraph     unmatched
Equation B    match
```

The parent lemma remains available as a structural shell where needed.

---

# 28. Filter View Modes

Filter View is controlled by one global dropdown.

Possible values:

```ts
export type FilterViewMode =
  | "original"
  | "dim"
  | "collapse"
  | "remove";
```

Default:

```text
Dim
```

---

# 29. Original Mode

Behavior:

```text
match
→ highlighted

context
→ normal

unmatched
→ normal
```

The document layout does not change.

---

# 30. Dim Mode

Default behavior:

```text
match
→ normal emphasis + block highlight

context
→ lightly dimmed or normal-context style

unmatched
→ strongly dimmed
```

Suggested opacity for unmatched blocks:

```text
0.25–0.40
```

The user should still be able to read context if needed.

---

# 31. Collapse Mode

Behavior:

```text
match
→ fully visible

context
→ visible structural shell

unmatched
→ collapsed
```

Consecutive unmatched blocks should be merged into one collapsed range.

Preferred:

```text
⋯ 5 blocks collapsed
```

rather than many separate collapsed placeholders.

---

# 32. Collapse Range Model

Recommended type:

```ts
export interface CollapsedRange {
  startBlockId: string;
  endBlockId: string;

  blockCount: number;

  parentContextId?: string;
}
```

Collapse planning should happen after Filter state assignment.

---

# 33. Remove Mode

Behavior:

```text
match
→ visible

context
→ minimal structural shell

unmatched
→ omitted from current Preview view
```

Important:

```text
Remove affects only the Preview projection.
It never deletes source or blocks.
```

Closing or disabling Filter restores the normal document.

---

# 34. Structural Context in Remove Mode

Example:

```text
Section 2
├── Lemma
├── Theorem ← match
└── Paragraph
```

The result should preferably remain:

```text
Section 2
└── Theorem
```

rather than only showing an isolated theorem.

---

# 35. Filter Highlighting

Filter highlighting is block-level.

A matching theorem, lemma, equation, etc. should receive a visual block state.

Search highlighting remains text-level.

The two styles must be visually distinguishable.

---

# 36. Filter Enable / Disable Toggle

The Filter panel should have a master switch.

Example:

```text
Filters       ●       Dim ▼
```

When disabled:

```text
Filter conditions remain stored
Preview behaves as if no Filter is active
```

---

# 37. Search Behavior with Filter

Search and Filter remain separate systems.

When Filter is active, Search should by default operate on the current filtered browsing set.

Example:

```text
Filter:
Theorem OR Lemma
AND Methods

Search:
Gaussian
```

Search finds `Gaussian` inside the currently filtered block set.

The SearchQuery itself does not acquire Block Type or Location conditions.

---

# 38. Optional Future Search Scope

A future version may add:

```text
Search in:
Current Filtered View
Whole Document
```

v0.3.2 may use the filtered view as the default when Filter is active.

---

# 39. Pinned Editing Rule

If editing causes a block to stop matching the current Filter, it should not disappear during the active edit session.

Therefore:

> An actively edited block remains temporarily visible until the edit session ends.

Suggested state:

```text
pinnedVisible = true
```

After Apply / Cancel:

```text
re-evaluate Filter
```

---

# 40. Search Panel UI Layout

The left-side advanced Search page should use a vertical split.

Recommended layout:

```text
┌──────────────────────────────┐
│ Search                       │
│                              │
│ [ Search text...          × ]│
│ Aa   W   .*   Scope ▼        │
│                              │
│ ▸ Replace                    │
│                              │
│ 17 matches         ↑   ↓     │
│ ──────────────────────────── │
│ Search results               │
│ Search results               │
│ Search results               │
│                              │
├──────────────────────────────┤
│ Filters          ●    Dim ▼  │
│                              │
│ Block Type                   │
│ Theorem · Lemma              │
│                              │
│ Document Location            │
│ Methods                      │
│                              │
│ File                         │
│ main.tex                     │
│                              │
│ Content Properties           │
│ Has Math                     │
└──────────────────────────────┘
```

Search should visually dominate the page.

Recommended initial proportion:

```text
Search + results: 60–70%
Filter:           30–40%
```

The divider may be draggable.

---

# 41. Search Input Row

Recommended controls:

```text
[ search input................ ]

Aa
W
.*
Scope ▼
```

Meanings:

```text
Aa
→ Case Sensitive

W
→ Whole Word

.*
→ Regex

Scope
→ Current File / Entire Project
```

Each toggle should provide a tooltip.

---

# 42. Search Result Header

Example:

```text
17 matches          ↑   ↓
```

Optional:

```text
3 / 17
```

for current result index.

---

# 43. Search Result List

Each result should show:

```text
section/block context
short text snippet
```

Example:

```text
Theorem 3.2
"...under the Gaussian copula assumption..."

Paragraph · Results
"...the Gaussian case produces..."
```

Clicking a result should:

1. activate it;
2. scroll Preview or Source to the match;
3. temporarily emphasize the selected match.

---

# 44. Replace UI

Replace should be collapsible.

Collapsed:

```text
▸ Replace
```

Expanded:

```text
Replace
[ replacement text........ ]

[ Replace ] [ Replace All ]
```

When Filter is active, destructive scope should be visible:

```text
Replace all 12 matches in current filter
```

---

# 45. Filter Panel UI

Recommended header:

```text
Filters        ●        Dim ▼
```

Contains:

```text
master enable switch
Filter View dropdown
```

The dropdown contains:

```text
Original
Dim
Collapse
Remove
```

---

# 46. Filter Group Presentation

Filter conditions should use a compact group + chip pattern.

Example:

```text
Block Type
[Theorem ×] [Lemma ×] [+]
```

or collapsed summary:

```text
Block Type
Theorem · Lemma
```

Clicking the group opens the complete option list.

---

# 47. Block Type Selector

Example:

```text
Block Type
──────────────
☐ Section
☐ Subsection
☐ Paragraph
☐ Definition
☑ Lemma
☑ Theorem
☐ Proposition
☐ Corollary
☐ Equation
☐ Figure
☐ Table
...
```

Multiple choices are allowed.

---

# 48. Document Location Selector

Should preferably use a document tree:

```text
☐ Introduction
☑ Methods
  ☐ Model
  ☑ Theory
☐ Results
☐ Appendix
```

Selection semantics should be explicit.

---

# 49. File Selector

Example:

```text
☑ main.tex
☑ theory.tex
☐ appendix.tex
```

Multiple files are OR.

---

# 50. Content Property Selector

Example:

```text
☑ Has Math
☑ Has Citation
☐ Has Figure
☐ Has Table
```

Selected properties combine with AND by default.

---

# 51. Empty Filter Behavior

If Filter is enabled but no conditions are active:

```text
all blocks match
```

Do not treat an empty Filter as matching nothing.

---

# 52. No-Match Behavior

If a valid Filter produces zero matches:

```text
0 matching blocks
```

Preview should not appear broken.

---

# 53. Search and Filter State Persistence

At minimum:

```text
Filter conditions survive temporary disable/enable
Filter View mode remains selected
Search query remains while switching between Preview/Source when possible
```

---

# 54. Filter Evaluation API

Recommended interface:

```ts
export interface FilterEngine {
  evaluate(
    blocks: Block[],
    query: FilterQuery,
    context: FilterContext
  ): FilterEvaluationResult;
}
```

Suggested result:

```ts
export interface FilterEvaluationResult {
  matches: Set<string>;
  context: Set<string>;
  unmatched: Set<string>;
}
```

---

# 55. Filter Context Resolution

After direct matches are found:

```text
direct Filter evaluation
    ↓
MatchSet
    ↓
Structural Context Resolver
    ↓
ContextSet
    ↓
UnmatchedSet
```

Context resolution must not change the fact that only MatchSet directly satisfies the Filter.

---

# 56. Search API

Recommended:

```ts
export interface SearchEngine {
  search(
    query: SearchQuery,
    context: SearchContext
  ): SearchResult[];
}
```

SearchContext may expose the current Filter result as a scope boundary without merging Filter conditions into SearchQuery.

---

# 57. Performance Strategy

Interactive behavior should be incremental.

Recommended:

```text
Source changes
    ↓
affected blocks reparse
    ↓
Filter re-evaluation
    ↓
Search index update
    ↓
active Search rerun
```

Suggested:

```text
Search typing:
50–150 ms

Filter changes:
immediate or very small debounce
```

---

# 58. Search Index

A simple first version may index:

```text
plain text content
file
block ID
source range
section context
```

Search should retain mappings back to source ranges.

---

# 59. Replace and LaTeX Source

Replacement must always modify source, not rendered Preview text.

Do not perform replacements directly on rendered DOM.

---

# 60. Editing in Filtered Preview

Filtered Preview blocks remain references to original block IDs and source ranges.

They are not temporary copies.

---

# 61. Filter View Is Non-Destructive

The following operations:

```text
Dim
Collapse
Remove
```

must never:

```text
delete source
change block IDs
move source
rewrite document order
```

They only affect the active Preview projection.

---

# 62. Search Tests

Required cases:

```text
basic text search
case-insensitive search
case-sensitive search
whole-word search
regex search
invalid regex handling
next/previous navigation
result list navigation
```

---

# 63. Replace Tests

Required cases:

```text
replace current
replace all
single undo transaction where possible
filter-aware replace-all scope
multi-file replacement
```

---

# 64. Filter Logic Tests

Required cases:

```text
OR inside Block Type
AND between groups
OR inside Location
OR inside File
AND inside Content Properties
empty Filter
zero-match Filter
```

---

# 65. Context Closure Tests

Example:

```text
Lemma
├ Paragraph
└ Equation
```

Filter:

```text
Equation
```

Expected:

```text
Equation  = match
Lemma     = context
Paragraph = unmatched
```

---

# 66. Filter View Tests

## Original

```text
match highlighted
unmatched unchanged
```

## Dim

```text
match highlighted
unmatched visually dimmed
```

## Collapse

```text
consecutive unmatched blocks collapsed into grouped ranges
```

## Remove

```text
unmatched blocks absent from Preview projection
source unchanged
```

---

# 67. Search + Filter Visual Test

Filter:

```text
Theorem OR Lemma
```

Search:

```text
Gaussian
```

Expected:

```text
matching blocks
→ Filter highlight

text "Gaussian"
→ Search text highlight
```

The two highlight styles must remain distinguishable.

---

# 68. Editing Visibility Test

Filter mode:

```text
Remove
```

Begin editing a visible matching block.

Change it so it no longer matches.

Expected:

```text
block remains pinned visible during active edit session
```

After Apply or Cancel:

```text
Filter re-evaluates
```

---

# 69. UI Interaction Tests

Required:

```text
Search panel resizes correctly
Search/Filter split remains usable
Filter master toggle preserves conditions
Filter View dropdown changes Preview immediately
Search result click navigates correctly
Replace panel expands/collapses
Filter chips update correctly
```

---

# 70. Non-Goals for v0.3.2

Not required:

```text
Tag system
Logical dependency filters
Structural relationship filters
AI semantic search
Embedding search
fuzzy semantic search
automatic query generation
Boolean expression editor
saved Filter presets
shared collaborative Filters
```

---

# 71. Recommended Implementation Order

## Phase 1 — Search Engine

Implement:

```text
text search
case sensitivity
whole word
regex
navigation
result model
current-file / project scope
```

## Phase 2 — Search UI

Implement:

```text
search input
option toggles
match counter
previous/next
result list
```

## Phase 3 — Replace

Implement:

```text
Replace
Replace All
undo transaction
Filter-aware replacement scope
```

## Phase 4 — Filter Engine

Implement:

```text
Block Type
Document Location
File
Content Properties
group logic
```

## Phase 5 — Context Resolver

Implement:

```text
match/context/unmatched
structural ancestor closure
```

## Phase 6 — Filtered Preview

Implement:

```text
Original
Dim
Collapse
Remove
```

## Phase 7 — Advanced Search Page

Combine:

```text
Search section
Search results
vertical divider
Filter section
Filter View selector
Filter enable toggle
```

## Phase 8 — Interaction Polish

Implement:

```text
editing pinning
result navigation
Search/Filter highlight separation
shortcut integration
performance tuning
```

---

# 72. Completion Criteria

v0.3.2 is complete when:

```text
✓ Search and Filter are separate systems
✓ Text and phrase Search works
✓ Case Sensitive works
✓ Whole Word works
✓ Regex works
✓ Previous / Next navigation works
✓ Search highlights all text matches
✓ Search result list navigates correctly
✓ Replace current works
✓ Replace All works
✓ Replace All respects active Filter scope
✓ Block Type Filter works
✓ Document Location Filter works
✓ File Filter works
✓ Content Property Filter works
✓ OR logic works inside categorical groups
✓ AND logic works between groups
✓ Content Properties support AND semantics
✓ Matching blocks are visually highlighted
✓ Context blocks are preserved
✓ Original mode works
✓ Dim mode works
✓ Collapse mode works
✓ Remove mode works
✓ Filter master toggle preserves conditions
✓ Filter View defaults to Dim
✓ Search text highlighting and Filter block highlighting are visually distinct
✓ Filtered Preview remains editable
✓ Filter View never mutates source
✓ Active edited blocks remain visible until editing ends
✓ Existing Preview and Source modes continue to work
```

---

# 73. Final Product Model

The v0.3.2 design should remain conceptually simple:

```text
SEARCH
"What words am I looking for?"

FILTER
"What kinds of blocks am I interested in?"

FILTER VIEW
"What should happen to everything else?"
```

Example:

```text
Filter:
(Theorem OR Lemma OR Proposition)
AND
(Methods OR Appendix)
AND
Has Math

Filter View:
Dim

Search:
Gaussian
```

Result:

```text
matching theorem/lemma/proposition blocks
→ remain visually prominent

unrelated blocks
→ dimmed

occurrences of "Gaussian"
→ highlighted as text inside the filtered browsing space
```

The central architectural rule is:

> Search locates text. Filter selects structure. Preview decides how to present the remainder.
