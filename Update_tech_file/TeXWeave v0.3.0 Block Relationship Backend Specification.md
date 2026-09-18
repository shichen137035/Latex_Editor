# TeXWeave v0.3.0  
## Block Relationship Backend Specification

**Version:** 0.3.0  
**Focus:** Backend / block graph infrastructure  
**Status:** Design specification

---

# 1. Overview

v0.3.0 is primarily a backend architecture update.

The main goal is to extend the existing block system so that blocks are no longer only isolated structural units in a LaTeX document. Blocks may now participate in two independent kinds of relationships:

1. **Document containment relationships**
2. **Logical dependency relationships**

These two relationship systems must remain conceptually separate.

A block may therefore simultaneously have:

- a position in the LaTeX document tree;
- a parent structural block;
- child structural blocks;
- logical prerequisites;
- logical consequences.

Example:

```text
Document hierarchy:

Section 2
├── Definition A
├── Lemma B
└── Theorem C
```

while the logical graph may be:

```text
Definition A ───→ Lemma B
Definition A ───→ Theorem C
Lemma B ─────────→ Theorem C
```

The document hierarchy answers:

> Where is this block located?

The logical graph answers:

> What does this block depend on, and what depends on it?

The two systems must not be merged.

---

# 2. Scope of v0.3.0

v0.3.0 should implement the underlying relationship model and graph algorithms.

It does **not** need to implement the final visual graph editor or Focus Reading interface yet.

Required backend capabilities:

- store direct logical dependency relationships;
- store structural parent/child relationships;
- query direct prerequisites;
- query all direct and indirect prerequisites;
- query direct consequences;
- query all direct and indirect consequences;
- detect logical cycles;
- safely traverse graphs containing cycles;
- detect relationships between blocks inside a prerequisite set;
- detect structural containment conflicts inside logical dependency sets;
- expose reusable graph APIs for future visualization and Focus Reading.

The architecture should support later versions without requiring another redesign.

---

# 3. Terminology

## 3.1 Block

A block is the fundamental semantic unit used by TeXWeave.

Examples may include:

```text
Section
Subsection
Paragraph
Definition
Lemma
Theorem
Equation
Figure
Table
Custom block
```

A block has a stable ID independent of its current source position.

Example:

```ts
type BlockId = string;
```

---

# 4. Two Independent Graphs

TeXWeave should internally maintain two different relationship structures.

---

## 4.1 Document Structure Graph

This represents containment.

Example:

```text
Section
├── Paragraph
├── Lemma
│   ├── Paragraph
│   └── Equation
└── Theorem
```

Represented as:

```text
Section → Lemma
Lemma   → Equation
```

Here the arrow means:

```text
contains
```

This graph should normally form a forest or tree-like hierarchy.

A block should have at most one structural parent.

```ts
structuralParent: BlockId | null;
```

A block may have multiple structural children.

```ts
structuralChildren: BlockId[];
```

Structural cycles must not be allowed.

For example:

```text
A contains B
B contains C
C contains A
```

is invalid.

---

## 4.2 Logical Dependency Graph

This is independent of document containment.

For a logical edge:

```text
A → B
```

the semantic meaning is:

> Block B directly uses or depends on Block A.

Therefore:

```text
A = prerequisite
B = consequence / dependent
```

A block may have:

- zero prerequisites;
- one prerequisite;
- many prerequisites;
- zero consequences;
- many consequences.

Example:

```text
A ─┐
   ├→ C
B ─┘

A ─────→ D
C ─────→ D
```

This is valid.

Unlike the document hierarchy, the logical dependency graph is intentionally allowed to be a **general directed graph**.

In particular:

- multiple roots are allowed;
- disconnected components are allowed;
- skip edges are allowed;
- cycles are allowed;
- a block may depend directly on both an ancestor and descendant in the dependency graph.

These structures may produce diagnostics, but should not automatically be rejected.

---

# 5. Why Logical Cycles Are Allowed

A dependency cycle may exist:

```text
A → B
↑   ↓
└─ C
```

or:

```text
A → B → C → A
```

Such a structure may be undesirable in some papers, but it is not the backend's responsibility to forbid it.

Instead:

1. store the graph faithfully;
2. detect the cycle;
3. expose it as a diagnostic;
4. allow later UI layers to decide how to display it.

This is important because the dependency system represents the author's declared conceptual relationships rather than a formal proof checker.

Therefore:

> v0.3.0 must support cyclic logical graphs without infinite recursion.

---

# 6. Proposed Core Data Model

A minimal block structure may look like:

```ts
export type BlockId = string;

export interface Block {
  id: BlockId;

  type: string;

  sourceStart: number;
  sourceEnd: number;

  documentOrder: number;

  structuralParent: BlockId | null;
  structuralChildren: BlockId[];

  prerequisites: BlockId[];
  consequences: BlockId[];
}
```

However, storing both:

```ts
prerequisites
consequences
```

creates synchronization risk.

A preferable internal representation is to store logical edges centrally.

For example:

```ts
export interface DependencyEdge {
  from: BlockId;
  to: BlockId;
}
```

where:

```text
from = prerequisite
to   = consequence
```

The graph manager maintains adjacency indexes.

```ts
export interface DependencyGraph {
  outgoing: Map<BlockId, Set<BlockId>>;
  incoming: Map<BlockId, Set<BlockId>>;
}
```

Meaning:

```ts
outgoing.get(A)
```

returns blocks that directly depend on A.

```ts
incoming.get(B)
```

returns direct prerequisites of B.

This allows traversal in either direction efficiently.

---

# 7. Graph Manager

Relationship logic should be centralized rather than distributed across React components.

Recommended abstraction:

```ts
class BlockGraphManager {
  private blocks: Map<BlockId, Block>;

  private dependencyOutgoing:
    Map<BlockId, Set<BlockId>>;

  private dependencyIncoming:
    Map<BlockId, Set<BlockId>>;

  // ...
}
```

React should consume graph results, not implement graph traversal itself.

This separation is important for later support of:

```text
Graph View
Focus Reading
Impact Analysis
Logical Reordering
Dependency Inspector
```

---

# 8. Basic Dependency Operations

Required operations:

```ts
addDependency(from: BlockId, to: BlockId): void;

removeDependency(from: BlockId, to: BlockId): void;

hasDependency(from: BlockId, to: BlockId): boolean;
```

Basic validation:

```text
from exists
to exists
from !== to
```

A direct self-loop:

```text
A → A
```

should normally be rejected.

This is different from a multi-node cycle:

```text
A → B → A
```

which is allowed but diagnosed.

---

# 9. Direct Prerequisite Query

For a block:

```text
A → C
B → C
```

the direct prerequisites of C are:

```text
{A, B}
```

API:

```ts
getDirectPrerequisites(
  blockId: BlockId
): BlockId[];
```

Implementation:

```ts
return [
  ...(this.dependencyIncoming.get(blockId) ?? [])
];
```

---

# 10. Direct Consequence Query

For:

```text
A → C
A → D
```

the direct consequences of A are:

```text
{C, D}
```

API:

```ts
getDirectConsequences(
  blockId: BlockId
): BlockId[];
```

---

# 11. All Prerequisites

This operation is fundamental.

Example:

```text
A → B → C → D
    ↑
X ──┘
```

For D:

```text
Direct prerequisite:
C

All prerequisites:
A
B
C
X
```

The algorithm must work even when the graph contains cycles.

---

## 11.1 Traversal algorithm

Use iterative DFS or BFS with a visited set.

Example:

```ts
getAllPrerequisites(blockId: BlockId): Set<BlockId> {
  const result = new Set<BlockId>();
  const visited = new Set<BlockId>();

  const stack = [
    ...(this.dependencyIncoming.get(blockId) ?? [])
  ];

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    if (current !== blockId) {
      result.add(current);
    }

    const parents =
      this.dependencyIncoming.get(current);

    if (!parents) continue;

    for (const parent of parents) {
      if (!visited.has(parent)) {
        stack.push(parent);
      }
    }
  }

  return result;
}
```

Important:

```text
start node must not be returned
```

even if a cycle eventually reaches it.

Example:

```text
A → B → C → A
```

For A:

```text
getAllPrerequisites(A)
```

returns:

```text
{B, C}
```

not:

```text
{A, B, C}
```

---

# 12. All Consequences

Symmetric traversal.

```ts
getAllConsequences(
  blockId: BlockId
): Set<BlockId>
```

Use:

```ts
dependencyOutgoing
```

instead of:

```ts
dependencyIncoming
```

Example:

```text
A → B → C
    ↓
    D → E
```

Then:

```text
getAllConsequences(A)
```

returns:

```text
{B, C, D, E}
```

---

# 13. Relationship Queries

Several generic functions will be useful later.

```ts
isLogicalPrerequisite(
  possiblePrerequisite: BlockId,
  block: BlockId
): boolean;
```

Returns true if:

```text
possiblePrerequisite → ... → block
```

exists.

Similarly:

```ts
isLogicalConsequence(
  possibleConsequence: BlockId,
  block: BlockId
): boolean;
```

These operations can initially use graph traversal.

If performance later becomes a problem, reachability can be cached.

---

# 14. Structural Relationship Queries

The structural tree requires equivalent helper functions.

Required APIs:

```ts
getStructuralParent(
  blockId: BlockId
): BlockId | null;

getStructuralChildren(
  blockId: BlockId
): BlockId[];

getStructuralAncestors(
  blockId: BlockId
): BlockId[];

getStructuralDescendants(
  blockId: BlockId
): BlockId[];
```

Also:

```ts
isStructuralAncestor(
  ancestor: BlockId,
  descendant: BlockId
): boolean;
```

Example:

```text
Lemma
├── Paragraph
└── Equation
```

Then:

```ts
isStructuralAncestor(
  lemmaId,
  equationId
)
```

returns:

```text
true
```

---

# 15. Detecting Logical Cycles

Cycle detection should be implemented independently from traversal.

Two useful outputs are required:

1. whether any cycle exists;
2. which blocks participate in cycles.

---

# 16. Strongly Connected Components

The recommended solution is to implement Strongly Connected Components.

Use either:

- Tarjan's algorithm;
- Kosaraju's algorithm.

Tarjan is preferable because it can be implemented in one DFS pass.

A strongly connected component with:

```text
size > 1
```

represents a logical cycle.

Example:

```text
A → B → C → A
```

produces:

```text
SCC = {A, B, C}
```

while:

```text
D → E
```

produces:

```text
{D}
{E}
```

which are not cycles.

API:

```ts
getStronglyConnectedComponents():
  BlockId[][];
```

and:

```ts
detectDependencyCycles():
  DependencyCycle[];
```

Suggested type:

```ts
export interface DependencyCycle {
  blockIds: BlockId[];
}
```

Future versions may use these SCCs to collapse cycles when generating hierarchical graph layouts.

---

# 17. Cycle Diagnostics

Cycle detection should not modify the graph.

Instead produce diagnostics.

Example:

```ts
export interface GraphDiagnostic {
  type: string;
  severity: "info" | "warning" | "error";
  blockIds: BlockId[];
  message: string;
}
```

Example diagnostic:

```ts
{
  type: "dependency-cycle",
  severity: "warning",
  blockIds: ["A", "B", "C"],
  message:
    "Blocks A, B and C form a logical dependency cycle."
}
```

The backend should not automatically remove any edge.

---

# 18. Detecting Structural Overlap Inside Prerequisites

This is an important v0.3.0 diagnostic.

Suppose the document hierarchy is:

```text
Lemma A
└── Equation B
```

and another block C declares both:

```text
Lemma A → C
Equation B → C
```

Then the prerequisite set of C contains:

```text
A
B
```

while:

```text
A structurally contains B
```

This may be intentional, but should be detectable.

The same issue may involve indirect prerequisites.

Example:

```text
A
└── B
    └── C
```

and all of:

```text
A
C
```

occur somewhere in:

```text
AllPrerequisites(D)
```

Then D's prerequisite closure contains structurally related blocks.

---

# 19. Structural Overlap Definition

Given:

```text
P(v) = all direct and indirect prerequisites of v
```

we want to find pairs:

```text
(x, y)
```

such that:

```text
x ∈ P(v)
y ∈ P(v)
```

and either:

```text
x structurally contains y
```

or:

```text
y structurally contains x
```

Formally:

\[
x,y\in P(v)
\]

and:

\[
x\prec_s y
\]

or:

\[
y\prec_s x
\]

where:

\[
\prec_s
\]

is the structural ancestor relation.

---

# 20. Basic Algorithm

Naive implementation:

```ts
findStructuralOverlapsInPrerequisites(
  blockId: BlockId
): StructuralOverlap[] {
  const prerequisites =
    [...this.getAllPrerequisites(blockId)];

  const overlaps: StructuralOverlap[] = [];

  for (let i = 0; i < prerequisites.length; i++) {
    for (
      let j = i + 1;
      j < prerequisites.length;
      j++
    ) {
      const a = prerequisites[i];
      const b = prerequisites[j];

      if (this.isStructuralAncestor(a, b)) {
        overlaps.push({
          ancestor: a,
          descendant: b
        });
      } else if (
        this.isStructuralAncestor(b, a)
      ) {
        overlaps.push({
          ancestor: b,
          descendant: a
        });
      }
    }
  }

  return overlaps;
}
```

Suggested result:

```ts
export interface StructuralOverlap {
  ancestor: BlockId;
  descendant: BlockId;
}
```

---

# 21. Direct vs Indirect Overlap

Diagnostics should distinguish whether the structurally related blocks are:

```text
both direct prerequisites
```

or:

```text
one/both indirect prerequisites
```

Suggested structure:

```ts
export interface StructuralDependencyOverlap {
  ancestor: BlockId;
  descendant: BlockId;

  ancestorDirect: boolean;
  descendantDirect: boolean;
}
```

This information may later help the UI explain the relationship.

---

# 22. Symmetric Consequence Analysis

Although v0.3.0 mainly requires prerequisite analysis, the same logic should be reusable for consequences.

Provide generic internal code:

```ts
findStructuralOverlaps(
  blockIds: Iterable<BlockId>
): StructuralOverlap[];
```

Then:

```ts
findStructuralOverlapsInPrerequisites(id)
```

becomes:

```ts
findStructuralOverlaps(
  getAllPrerequisites(id)
)
```

while:

```ts
findStructuralOverlapsInConsequences(id)
```

uses:

```ts
getAllConsequences(id)
```

This avoids duplicating graph logic.

---

# 23. Detecting Dependency Relationships Within a Prerequisite Set

A second useful diagnostic concerns logical relationships between prerequisites themselves.

Example:

```text
A → C
A → D
C → D
```

For D:

```text
prerequisites = {A, C}
```

and:

```text
A → C
```

also exists.

This is valid and must not be rejected.

However, it is useful information.

The backend should therefore support:

```ts
findLogicalRelationsWithinSet(
  blockIds: Iterable<BlockId>
): LogicalRelation[];
```

Suggested output:

```ts
export interface LogicalRelation {
  from: BlockId;
  to: BlockId;

  direct: boolean;
}
```

For:

```text
{A, C}
```

it may return:

```text
A → C
```

This gives future visual layers enough information to distinguish simple prerequisite sets from internally layered prerequisite sets.

---

# 24. Important Rule: Do Not Treat These as Errors

The following graph is valid:

```text
A → C → D
 \──────→ D
```

Even though A is already an ancestor of C.

This may represent:

```text
C provides one result,
while D also directly uses information from A.
```

Therefore v0.3.0 must **not** automatically perform transitive reduction.

Do not transform:

```text
A → C
C → D
A → D
```

into:

```text
A → C
C → D
```

unless explicitly requested by a future visualization algorithm.

The semantic graph must preserve declared edges.

---

# 25. Graph Query Result Model

Future features will require richer results than simple arrays.

A general query type is useful.

```ts
export interface GraphTraversalResult {
  start: BlockId;

  direct: Set<BlockId>;

  indirect: Set<BlockId>;

  all: Set<BlockId>;
}
```

Example:

```ts
getPrerequisiteClosure(
  blockId: BlockId
): GraphTraversalResult;
```

For:

```text
A → B → C
X → C
```

querying C returns:

```text
direct:
{B, X}

indirect:
{A}

all:
{A, B, X}
```

This distinction will be useful later for Focus Reading and graph visualization.

---

# 26. Distance Information

It is useful to optionally compute logical distance.

Example:

```text
A → B → C → D
```

From D:

```text
C distance 1
B distance 2
A distance 3
```

Suggested API:

```ts
getPrerequisiteDistances(
  blockId: BlockId
): Map<BlockId, number>;
```

For graphs with several paths, use the minimum distance.

Example:

```text
A → D
A → B → D
```

then:

```text
distance(A, D) = 1
```

This will later support:

- neighborhood views;
- depth-limited Focus Reading;
- dependency highlighting;
- graph layout.

This is inexpensive to compute using BFS.

---

# 27. Depth-Limited Traversal

Future UI will frequently need:

```text
show only prerequisites within 2 levels
```

Therefore implement optional depth limits early.

Example:

```ts
getAllPrerequisites(
  blockId: BlockId,
  options?: {
    maxDepth?: number;
  }
)
```

Likewise:

```ts
getAllConsequences(...)
```

A missing `maxDepth` means unlimited traversal.

---

# 28. Generic Directional Traversal

To avoid duplicated algorithms, internally define:

```ts
type GraphDirection =
  | "incoming"
  | "outgoing";
```

Then implement:

```ts
traverseDependencyGraph(
  start: BlockId,
  direction: GraphDirection,
  options?: {
    maxDepth?: number;
  }
): GraphTraversalResult;
```

Public wrappers:

```ts
getPrerequisiteClosure(id)
```

use:

```text
incoming
```

while:

```ts
getConsequenceClosure(id)
```

uses:

```text
outgoing
```

---

# 29. Recommended Internal Graph API

Suggested initial interface:

```ts
export interface IBlockGraphManager {
  // Dependency editing

  addDependency(
    prerequisite: BlockId,
    consequence: BlockId
  ): void;

  removeDependency(
    prerequisite: BlockId,
    consequence: BlockId
  ): void;

  hasDirectDependency(
    prerequisite: BlockId,
    consequence: BlockId
  ): boolean;


  // Direct queries

  getDirectPrerequisites(
    blockId: BlockId
  ): BlockId[];

  getDirectConsequences(
    blockId: BlockId
  ): BlockId[];


  // Recursive queries

  getPrerequisiteClosure(
    blockId: BlockId
  ): GraphTraversalResult;

  getConsequenceClosure(
    blockId: BlockId
  ): GraphTraversalResult;


  // Reachability

  isPrerequisiteOf(
    prerequisite: BlockId,
    consequence: BlockId
  ): boolean;


  // Structural queries

  getStructuralParent(
    blockId: BlockId
  ): BlockId | null;

  getStructuralChildren(
    blockId: BlockId
  ): BlockId[];

  isStructuralAncestor(
    ancestor: BlockId,
    descendant: BlockId
  ): boolean;


  // Diagnostics

  detectDependencyCycles():
    DependencyCycle[];

  findStructuralOverlapsInPrerequisites(
    blockId: BlockId
  ): StructuralDependencyOverlap[];

  findLogicalRelationsWithinPrerequisites(
    blockId: BlockId
  ): LogicalRelation[];

  validateGraph():
    GraphDiagnostic[];
}
```

---

# 30. Full Graph Validation

Provide one high-level operation:

```ts
validateGraph(): GraphDiagnostic[]
```

This should run all currently supported checks.

Initial v0.3.0 checks:

```text
1. dangling dependency edges
2. self dependency
3. structural cycles
4. logical dependency cycles
5. duplicated edges
6. structural overlaps in prerequisite closures
7. logical relations inside prerequisite sets
```

Not every diagnostic should be an error.

Suggested levels:

```text
error
warning
info
```

Example:

### Error

```text
dependency references missing block
```

### Warning

```text
logical cycle detected
```

### Info

```text
two prerequisites have a structural containment relationship
```

---

# 31. Graph Mutation and Cache Invalidation

Recursive graph queries may later be cached.

Possible caches:

```text
ancestor closure
descendant closure
SCC result
distance map
```

But v0.3.0 should prioritize correctness.

Recommended first implementation:

```text
no persistent reachability cache
```

unless performance testing shows a need.

Graphs for normal academic papers will usually contain hundreds or low thousands of semantic blocks, for which ordinary DFS/BFS is inexpensive.

If caching is later introduced, every:

```text
addDependency
removeDependency
addBlock
removeBlock
changeStructuralParent
```

must invalidate relevant caches.

---

# 32. Complexity

Let:

```text
V = number of blocks
E = number of logical dependency edges
```

A complete DFS/BFS traversal is:

\[
O(V+E)
\]

Cycle detection using Tarjan is:

\[
O(V+E)
\]

Structural overlap detection using naive pair comparison over a prerequisite set of size \(k\):

\[
O(k^2h)
\]

where \(h\) is structural tree depth if ancestor checks walk upward.

This is acceptable initially.

Later optimization may use:

```text
DFS entry/exit timestamps
```

for the structural hierarchy.

Then:

```text
isStructuralAncestor(A, B)
```

can become:

\[
O(1)
\]

using:

\[
tin(A)\le tin(B)
\]

and:

\[
tout(B)\le tout(A).
\]

This optimization is optional for v0.3.0.

---

# 33. Block Deletion

Deleting a block must clean all graph relationships.

If deleting:

```text
B
```

from:

```text
A → B → C
D → B
```

the system should remove:

```text
A → B
D → B
B → C
```

It must **not** automatically create:

```text
A → C
D → C
```

because such an inference changes semantic meaning.

Dependency repair must remain explicit.

---

# 34. Structural Deletion

If deleting a structural container:

```text
Lemma
├── Paragraph
└── Equation
```

the existing block lifecycle logic must decide whether children are:

- deleted;
- promoted;
- reparsed.

The dependency layer should react only after the resulting block structure is known.

It should not independently infer structural changes.

---

# 35. Stable Block IDs

Logical relationships must use stable IDs rather than source offsets.

Bad:

```ts
{
  fromStart: 1820,
  toStart: 2504
}
```

Good:

```ts
{
  from: "block-91d2",
  to: "block-a812"
}
```

Source positions will change constantly during editing.

Relationship identity must therefore be independent of:

```text
line number
character offset
render position
section number
```

This requirement is critical.

---

# 36. Persistence

v0.3.0 should separate graph storage from LaTeX source unless a dedicated syntax has already been established.

Possible internal representation:

```json
{
  "dependencies": [
    {
      "from": "block-a",
      "to": "block-c"
    },
    {
      "from": "block-b",
      "to": "block-c"
    }
  ]
}
```

The exact persistence format may be decided separately.

The graph manager should not depend on whether relationships eventually come from:

- metadata files;
- embedded LaTeX commands;
- comments;
- application state;
- project database.

---

# 37. Future Focus Reading Compatibility

Although Focus Reading is not required in v0.3.0, the backend should directly support it.

Future operation:

```text
Select Theorem T
```

Backward Focus:

```ts
getPrerequisiteClosure(T)
```

Forward Focus:

```ts
getConsequenceClosure(T)
```

Between two blocks A and B:

\[
Desc(A)\cap Anc(B)
\]

Possible future API:

```ts
getBlocksBetween(
  start: BlockId,
  end: BlockId
): Set<BlockId>;
```

Implementation:

```ts
intersection(
  getAllConsequences(start),
  getAllPrerequisites(end)
)
```

plus:

```text
start
end
```

when appropriate.

No UI implementation is required yet.

---

# 38. Future Hierarchical Visualization Compatibility

Because logical cycles are allowed, future graph visualization should not assume the graph is a DAG.

Instead it can use:

```text
Logical graph
↓
Strongly Connected Components
↓
Condensation graph
↓
DAG
↓
hierarchical layout
```

This is one reason SCC detection belongs in v0.3.0 rather than being postponed entirely to UI development.

---

# 39. Recommended Module Structure

A possible implementation structure:

```text
src/
└── core/
    └── blocks/
        ├── types.ts
        ├── BlockStore.ts
        │
        ├── relationships/
        │   ├── DependencyGraph.ts
        │   ├── StructuralGraph.ts
        │   ├── GraphTraversal.ts
        │   ├── StronglyConnectedComponents.ts
        │   ├── GraphDiagnostics.ts
        │   └── types.ts
        │
        └── __tests__/
            ├── dependencyGraph.test.ts
            ├── graphTraversal.test.ts
            ├── cycles.test.ts
            ├── structuralRelations.test.ts
            └── diagnostics.test.ts
```

Keep graph algorithms independent of React.

---

# 40. Minimum Test Cases

## Case 1: Simple chain

```text
A → B → C
```

Expected:

```text
prerequisites(C) = {A, B}
consequences(A) = {B, C}
```

---

## Case 2: Multiple prerequisites

```text
A ─┐
   ├→ C
B ─┘
```

Expected:

```text
directPrerequisites(C) = {A, B}
```

---

## Case 3: Skip dependency

```text
A → B → C
 \──────→ C
```

Expected:

```text
directPrerequisites(C) = {A, B}
allPrerequisites(C) = {A, B}
```

The A → C edge must remain stored.

---

## Case 4: Diamond

```text
    A
   / \
  B   C
   \ /
    D
```

Expected:

```text
allPrerequisites(D) = {A, B, C}
```

A must appear only once.

---

## Case 5: Cycle

```text
A → B → C → A
```

Expected:

```text
cycle detected
```

Queries must terminate.

For A:

```text
allPrerequisites(A) = {B, C}
```

---

## Case 6: Disconnected graph

```text
A → B

C → D
```

Expected:

```text
allPrerequisites(B) = {A}
```

and C/D must not appear.

---

## Case 7: Structural overlap

Document:

```text
Lemma A
└── Equation B
```

Logical graph:

```text
A → C
B → C
```

Expected diagnostic:

```text
A and B are both prerequisites of C,
and A structurally contains B.
```

---

## Case 8: Indirect structural overlap

Document:

```text
A
└── B
```

Logical:

```text
A → X → D
B → Y → D
```

Then:

```text
allPrerequisites(D)
```

contains both A and B.

Expected:

```text
structural overlap detected
```

even though neither is necessarily a direct prerequisite.

---

## Case 9: Logical relation inside prerequisites

```text
A → B
A → C
B → C
```

For C:

```text
direct prerequisites = {A, B}
```

Expected:

```text
A and B are themselves logically related.
```

This is valid and must not remove either edge.

---

## Case 10: Block deletion

Before:

```text
A → B → C
```

Delete B.

Expected:

```text
no edge referring to B remains
```

and:

```text
A → C
```

must not be automatically generated.

---

# 41. Non-Goals for v0.3.0

The following should not block the backend release:

- final graph visualization;
- drag-and-drop relationship editing;
- technology-tree layout;
- Focus Reading UI;
- document reordering;
- automatic logical relationship inference;
- AI-generated dependencies;
- transitive reduction;
- graph simplification;
- dependency importance ranking.

The backend should merely make these possible.

---

# 42. Core Design Principles

The v0.3.0 relationship system should follow these principles.

### 1. Structural hierarchy and logical dependency are different systems

Never derive one automatically from the other.

### 2. Dependency edges are directional

```text
A → B
```

means B directly depends on A.

### 3. Logical graphs may contain cycles

Cycles are detected, not automatically rejected.

### 4. Declared edges are semantic information

Do not automatically remove transitive or apparently redundant edges.

### 5. Recursive queries must always be cycle-safe

Every traversal must use visited-state tracking.

### 6. Stable IDs are mandatory

Relations must not depend on source offsets.

### 7. Diagnostics should describe unusual structures without rewriting them

The author's graph remains authoritative.

### 8. Backend first

React and visualization layers should call graph APIs rather than implementing graph logic themselves.

---

# 43. v0.3.0 Completion Criteria

The backend portion of v0.3.0 can be considered complete when the following operations are reliable:

```text
✓ Create dependency
✓ Delete dependency

✓ Query direct prerequisites
✓ Query all prerequisites

✓ Query direct consequences
✓ Query all consequences

✓ Traverse cyclic graphs safely

✓ Detect logical cycles
✓ Return strongly connected components

✓ Query structural ancestors
✓ Query structural descendants

✓ Detect structural relationships
  inside prerequisite closures

✓ Detect logical relationships
  between prerequisites

✓ Remove dangling relations
  when blocks are deleted

✓ Expose one unified graph
  validation interface

✓ Unit tests cover all above cases
```

At that point later versions can safely build:

```text
Technology Tree
Focus Reading
Impact Analysis
Logical Reading Order
Dependency Highlighting
```

without redesigning the relationship backend.