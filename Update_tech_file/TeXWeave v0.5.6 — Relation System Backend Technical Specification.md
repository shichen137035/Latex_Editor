# TeXWeave v0.5.6 — Relation System Backend Technical Specification

## 1. Overview

v0.5.6 focuses on rebuilding and stabilizing the document relation system.

The relation system is not intended to reproduce every textual reference inside a LaTeX document. Its purpose is to represent the logical dependency structure between meaningful document blocks and provide a reusable backend foundation for:

- creating and maintaining logical relations;
- querying dependencies;
- constructing relation subgraphs;
- relation-based filtering;
- relation validation;
- AI-assisted document understanding;
- AI-assisted relation editing.

The backend must remain independent from any particular visualization or interaction model.

---

# 2. Core Model

The relation system uses a single directed relation:

```text
A → B
```

with the fixed semantic meaning:

> B logically depends on A.

Examples:

```text
Definition 1 → Lemma 2
Lemma 2 → Theorem 3
Theorem 3 → Corollary 1
```

v0.5.6 does not introduce multiple semantic relation types such as:

```text
supports
implies
contrastsWith
uses
references
```

All logical dependency relations use the same relation model.

This keeps traversal, filtering, validation and AI reasoning deterministic.

---

# 3. Relation Endpoint Rules

Relations may only connect blocks that represent independent logical or structural units.

## 3.1 Eligible blocks

Typical eligible blocks include:

```text
Section
Subsection
Theorem
Lemma
Proposition
Corollary
Definition
Assumption
Remark
Example
Semantic Block
Custom Block
```

Exact block classifications are provided by the v0.5.4 Block System.

The Relation System must not duplicate block parsing or block classification logic.

---

## 3.2 Ineligible blocks

Content blocks cannot directly participate in relations.

Examples:

```text
Text
Paragraph content
Equation
Figure
Image
Table
List
Citation
```

Therefore the following are invalid:

```text
Equation → Theorem
Table → Proposition
Figure → Section
Equation → Equation
```

If an equation belongs to a theorem and another theorem logically depends on that result, the relation is normally:

```text
Theorem A → Theorem B
```

rather than:

```text
Equation A.2 → Theorem B
```

---

# 4. Semantic Blocks

v0.5.6 recognizes the need for ordinary-looking document content to become an independent logical unit.

This is represented by Semantic Blocks or compatible Custom Blocks defined by the Block System.

Example:

```latex
\begin{twblock}
Under the preceding assumptions, we restrict attention
to the stationary case.
\end{twblock}
```

Although such a block may have no special visual effect in the compiled PDF, it may participate in relations:

```text
Lemma 2 → Semantic Block A → Theorem 4
```

The Relation System only needs to know whether the Block System marks the block as relation-capable.

---

# 5. Data Model

## 5.1 Relation identifier

```ts
type RelationId = string;
```

Relation IDs must remain stable across application sessions.

---

## 5.2 Core relation structure

```ts
interface BlockRelation {
  id: RelationId;

  sourceId: BlockId;
  targetId: BlockId;

  createdBy: RelationCreator;

  createdAt: number;
  updatedAt: number;
}
```

Where:

```ts
type RelationCreator =
  | "user"
  | "ai";
```

Semantic interpretation:

```text
sourceId → targetId
```

means:

```text
targetId depends on sourceId
```

This direction must remain consistent throughout the entire application.

---

# 6. Graph Invariants

The relation graph must satisfy the following invariants.

## 6.1 Valid endpoints

Both endpoints must exist and must be relation-capable blocks.

---

## 6.2 No self-relations

Invalid:

```text
A → A
```

---

## 6.3 No duplicate relations

Only one direct edge may exist between the same ordered pair:

```text
A → B
```

Creating another identical relation must fail.

---

## 6.4 No directed cycles

Relations represent logical dependency.

Therefore the graph must remain a Directed Acyclic Graph where possible.

Invalid:

```text
A → B
B → C
C → A
```

Cycle detection must be performed before committing a relation.

---

## 6.5 Document order is irrelevant

Relation validity must not depend on source order.

The following is valid:

```text
Document order:

Theorem B
...
Lemma A
```

while the relation remains:

```text
Lemma A → Theorem B
```

Physical document order and logical dependency order are separate concepts.

No source-order validation is required in v0.5.6.

---

# 7. Relation Service

The main backend service should expose relation operations independently from storage.

Example:

```ts
interface RelationService {
  createRelation(...): Promise<BlockRelation>;
  deleteRelation(...): Promise<void>;

  getRelation(...): Promise<BlockRelation | null>;

  getPrerequisites(...): Promise<BlockId[]>;
  getDependents(...): Promise<BlockId[]>;

  getRelationScope(...): Promise<RelationScope>;
  getRelationSubgraph(...): Promise<RelationGraph>;

  validateGraph(...): Promise<RelationIssue[]>;
}
```

Storage details must remain behind the service boundary.

---

# 8. Relation Validation API

Before creating a relation:

```ts
canCreateRelation(
  sourceId: BlockId,
  targetId: BlockId
): RelationValidationResult;
```

Suggested return type:

```ts
interface RelationValidationResult {
  valid: boolean;

  reason?:
    | "SOURCE_NOT_FOUND"
    | "TARGET_NOT_FOUND"
    | "INVALID_SOURCE"
    | "INVALID_TARGET"
    | "SELF_RELATION"
    | "DUPLICATE_RELATION"
    | "CYCLE";
}
```

The same validation logic must be reused by:

```text
manual editing
AI proposals
file loading
migration
repair operations
tests
```

There must not be multiple implementations of relation validity.

---

# 9. Relation CRUD

## 9.1 Create

```ts
createRelation(
  sourceId: BlockId,
  targetId: BlockId,
  options?: {
    createdBy?: RelationCreator;
  }
): BlockRelation;
```

Processing order:

```text
1. Confirm source exists.
2. Confirm target exists.
3. Confirm both endpoints are relation-capable.
4. Reject source === target.
5. Reject duplicate edge.
6. Check whether the new edge creates a cycle.
7. Persist relation.
8. Invalidate affected graph caches.
9. Emit relation-created event.
```

---

## 9.2 Delete

```ts
deleteRelation(
  relationId: RelationId
): void;
```

Deleting a relation does not delete either block.

---

## 9.3 Reverse

Optional convenience operation:

```ts
reverseRelation(
  relationId: RelationId
): BlockRelation;
```

This must internally validate the reversed edge.

Implementation should behave atomically:

```text
A → B

becomes

B → A
```

Only if the new graph remains valid.

---

# 10. Basic Relation Queries

## 10.1 Direct prerequisites

```ts
getPrerequisites(
  blockId: BlockId
): BlockId[];
```

For:

```text
A → C
B → C
```

returns:

```text
[A, B]
```

for `C`.

---

## 10.2 Direct dependents

```ts
getDependents(
  blockId: BlockId
): BlockId[];
```

For:

```text
A → B
A → C
```

returns:

```text
[B, C]
```

for `A`.

---

## 10.3 Relations around a block

```ts
getRelations(
  blockId: BlockId
): {
  incoming: BlockRelation[];
  outgoing: BlockRelation[];
};
```

Where:

```text
incoming = prerequisites → block
outgoing = block → dependents
```

---

# 11. Transitive Relation Queries

## 11.1 Ancestors

```ts
getAncestors(
  blockId: BlockId,
  options?: {
    maxDepth?: number;
  }
): RelationTraversalResult;
```

For:

```text
A → B → C → D
```

calling:

```ts
getAncestors(D)
```

returns logically:

```text
C
B
A
```

with their respective distances.

---

## 11.2 Descendants

```ts
getDescendants(
  blockId: BlockId,
  options?: {
    maxDepth?: number;
  }
): RelationTraversalResult;
```

This answers:

> Which later logical results depend directly or indirectly on this block?

---

## 11.3 Traversal result

Traversal should preserve relation distance:

```ts
interface RelationTraversalEntry {
  blockId: BlockId;
  distance: number;
}
```

Example:

```text
Focus      distance 0
Direct     distance 1
Indirect   distance 2
...
```

Distance information is useful to graph construction, filtering and AI context selection.

---

# 12. Dependency Queries

## 12.1 Boolean dependency query

```ts
dependsOn(
  blockId: BlockId,
  prerequisiteId: BlockId
): boolean;
```

For:

```text
A → B → C
```

both are true:

```ts
dependsOn(B, A);
dependsOn(C, A);
```

---

## 12.2 Relation path

```ts
findRelationPath(
  sourceId: BlockId,
  targetId: BlockId
): BlockId[] | null;
```

For:

```text
A → B → C → D
```

calling:

```ts
findRelationPath(A, D)
```

may return:

```ts
[A, B, C, D]
```

If multiple valid paths exist, the backend should return a shortest path by default.

---

# 13. Relation Scope

Relation Scope is the core intermediate representation of v0.5.6.

It represents the logical region surrounding one or more focus blocks.

Graph generation, filtering and AI context selection should all consume Relation Scope rather than implementing separate traversal logic.

---

## 13.1 Scope options

```ts
interface RelationScopeOptions {
  focusIds: BlockId[];

  direction:
    | "prerequisites"
    | "dependents"
    | "both";

  depth:
    | number
    | "all";

  includeFocus?: boolean;
}
```

---

## 13.2 Scope entry

```ts
interface RelationScopeEntry {
  blockId: BlockId;

  distance: number;

  direction:
    | "focus"
    | "prerequisite"
    | "dependent";
}
```

---

## 13.3 Scope result

```ts
interface RelationScope {
  focusIds: BlockId[];

  entries: RelationScopeEntry[];

  blockIds: BlockId[];

  relations: BlockRelation[];
}
```

---

## 13.4 API

```ts
getRelationScope(
  options: RelationScopeOptions
): RelationScope;
```

Example:

```text
A → B → C → D
        ↑
        E
```

For:

```ts
getRelationScope({
  focusIds: ["C"],
  direction: "prerequisites",
  depth: "all"
});
```

the logical scope contains:

```text
A
B
E
C
```

---

# 14. Multiple Focus Blocks

Relation Scope should support multiple focus blocks from the beginning.

Example:

```ts
getRelationScope({
  focusIds: [
    "theorem-3",
    "theorem-6"
  ],
  direction: "prerequisites",
  depth: "all"
});
```

The default behavior is union:

```text
Scope(T3, T6)
=
Scope(T3) ∪ Scope(T6)
```

Intersection queries may be added later but are not required for v0.5.6.

---

# 15. Relation Subgraph

Relation Graph generation is a backend graph extraction operation.

It must not contain presentation-specific information.

```ts
interface RelationGraph {
  nodes: RelationGraphNode[];
  edges: BlockRelation[];
}
```

Suggested node representation:

```ts
interface RelationGraphNode {
  blockId: BlockId;

  distance?: number;

  direction?:
    | "focus"
    | "prerequisite"
    | "dependent";
}
```

API:

```ts
getRelationSubgraph(
  scope: RelationScope
): RelationGraph;
```

or convenience form:

```ts
getRelationSubgraph(
  options: RelationScopeOptions
): RelationGraph;
```

The backend must not calculate:

```text
node coordinates
graph colors
card dimensions
visual styles
edge routing
```

These are outside the Relation backend.

---

# 16. Relation-Based Filtering

Relation filtering is implemented as a two-stage process.

```text
Relation Scope
      ↓
Display Scope
```

Relation Scope answers:

> Which logical blocks are relevant?

Display Scope answers:

> Which document blocks must be available when presenting or processing that logical scope?

---

# 17. Display Scope

Because only structural and semantic blocks participate directly in relations, related content blocks must be expanded through the Block System.

Example:

```text
Theorem 2
├─ Text
├─ Equation
└─ Proof
```

If `Theorem 2` belongs to the Relation Scope, its relevant contained content may also need to belong to the Display Scope.

---

## 17.1 Options

```ts
interface DisplayScopeOptions {
  includeContent: boolean;

  includeStructuralParents: boolean;
}
```

---

## 17.2 Result

```ts
interface DisplayScope {
  relationBlockIds: BlockId[];

  contentBlockIds: BlockId[];

  structuralParentIds: BlockId[];

  allBlockIds: BlockId[];
}
```

---

## 17.3 API

```ts
getDisplayScope(
  relationScope: RelationScope,
  options: DisplayScopeOptions
): DisplayScope;
```

The Relation System itself should not reimplement block hierarchy traversal.

Instead it should call Block System APIs introduced before v0.5.6.

Conceptually:

```ts
const descendants =
  blockService.getContainedBlocks(blockId);

const parents =
  blockService.getStructuralParents(blockId);
```

---

# 18. Filtering as Set Operations

Relation filtering should ultimately produce collections of `BlockId`.

This allows relation filtering to combine naturally with other systems.

Example:

```text
Relation Scope
    ∩
Search Results
    ∩
Other Block Filters
```

Backend services should therefore avoid embedding visibility state such as:

```text
hidden
dimmed
opacity
```

into Relation Scope.

Those are presentation decisions.

The backend only determines membership and relation distance.

---

# 19. Graph Validation

The main validation entry point:

```ts
validateRelationGraph(): RelationIssue[];
```

---

## 19.1 Issue model

```ts
interface RelationIssue {
  type: RelationIssueType;

  severity:
    | "error"
    | "warning";

  blockIds: BlockId[];

  relationIds?: RelationId[];

  details?: Record<string, unknown>;
}
```

---

## 19.2 Issue types

```ts
type RelationIssueType =
  | "CYCLE"
  | "INVALID_ENDPOINT"
  | "DUPLICATE_RELATION"
  | "DANGLING_RELATION";
```

---

# 20. Cycle Detection

Cycle detection is mandatory.

Example:

```text
A → B
B → C
C → A
```

should generate:

```ts
{
  type: "CYCLE",
  severity: "error",
  blockIds: ["A", "B", "C"],
  relationIds: [...]
}
```

Cycle checking should occur both:

```text
before relation creation
during full graph validation
```

Incremental checks should normally be used during editing.

Full validation should be available when opening, migrating or repairing a project.

---

# 21. Duplicate Relation Detection

Invalid:

```text
A → B
A → B
```

Duplicate detection must preferably be enforced by storage constraints as well as validation.

A canonical lookup key may be:

```text
sourceId + targetId
```

---

# 22. Dangling Relations

A relation becomes dangling when one or both referenced block IDs no longer exist.

Example:

```text
relation:
block-A → block-B

but block-B was removed
```

Validation result:

```ts
{
  type: "DANGLING_RELATION",
  severity: "error"
}
```

Normal block deletion should clean affected relations automatically.

Dangling relation detection mainly protects against:

```text
manual file changes
older project formats
corrupted state
failed migration
external modifications
```

---

# 23. Invalid Endpoint Detection

A block may still exist but no longer be allowed to participate in relations.

Example:

```text
Block type changed:
Semantic Block → ordinary content block
```

Any existing relation pointing to it becomes invalid.

This must be detected by:

```ts
validateRelationGraph()
```

---

# 24. Block Deletion Integration

Block deletion belongs to the Block System.

Relation System provides dependency information before deletion.

```ts
getRelationImpact(
  blockId: BlockId
): RelationImpact;
```

Suggested result:

```ts
interface RelationImpact {
  incomingRelations: RelationId[];
  outgoingRelations: RelationId[];

  directPrerequisites: BlockId[];
  directDependents: BlockId[];

  downstreamDependents: BlockId[];
}
```

When a block is actually deleted, all attached relations must also be deleted.

This should be transactional where storage permits it.

---

# 25. Relation Events

The Relation Service should emit internal events.

Suggested events:

```ts
type RelationEvent =
  | {
      type: "relation-created";
      relation: BlockRelation;
    }
  | {
      type: "relation-deleted";
      relationId: RelationId;
    }
  | {
      type: "relation-reversed";
      previous: BlockRelation;
      current: BlockRelation;
    }
  | {
      type: "graph-invalidated";
    };
```

These events allow caches, search indexes and AI context services to invalidate stale results.

---

# 26. AI Read APIs

AI should use the same graph logic as the rest of TeXWeave.

AI must not implement independent dependency traversal.

Recommended read operations:

```text
relation.get_prerequisites
relation.get_dependents
relation.get_scope
relation.find_path
relation.get_subgraph
relation.validate
```

---

# 27. AI Relation Context

A convenience backend API may provide compact logical context:

```ts
getLogicContext(
  blockId: BlockId,
  options?: {
    direction?: "prerequisites" | "dependents" | "both";
    depth?: number | "all";
  }
): LogicContext;
```

Suggested structure:

```ts
interface LogicContext {
  focusId: BlockId;

  scope: RelationScope;

  blocks: BlockSummary[];
}
```

Actual block contents should still come from the Block System.

The Relation System determines:

```text
which blocks matter
```

while the Block System determines:

```text
what those blocks contain
```

---

# 28. AI Write Policy

AI should not silently mutate persistent relations.

Instead, AI write operations should produce relation proposals.

Recommended API:

```ts
proposeRelationCreate(
  sourceId: BlockId,
  targetId: BlockId
): RelationProposal;
```

```ts
proposeRelationDelete(
  relationId: RelationId
): RelationProposal;
```

```ts
proposeRelationReverse(
  relationId: RelationId
): RelationProposal;
```

Example:

```ts
interface RelationProposal {
  id: string;

  operation:
    | "create"
    | "delete"
    | "reverse";

  sourceId?: BlockId;
  targetId?: BlockId;
  relationId?: RelationId;

  reason?: string;

  validation: RelationValidationResult;
}
```

A proposal is not part of the persistent graph until explicitly committed.

---

# 29. Commit Proposal

Approved proposals may be committed through normal Relation Service operations.

Example:

```ts
commitRelationProposal(
  proposalId: string
): BlockRelation | void;
```

Internally this must still call:

```ts
createRelation(...)
deleteRelation(...)
reverseRelation(...)
```

AI must not bypass validation.

---

# 30. AI Filtering and Context Selection

AI should be able to request the same Relation Scope used elsewhere.

Example:

```ts
getRelationScope({
  focusIds: [currentTheoremId],
  direction: "prerequisites",
  depth: "all"
});
```

The resulting scope may then be expanded:

```ts
getDisplayScope(scope, {
  includeContent: true,
  includeStructuralParents: false
});
```

This creates a graph-based context selection mechanism:

```text
Focus Block
    ↓
Relation Scope
    ↓
Display Scope
    ↓
Block Content
    ↓
AI Context
```

This mechanism should be preferred over sending the entire document whenever possible.

---

# 31. Persistence

Relation data should be stored independently from raw LaTeX source.

Recommended conceptual project structure:

```text
project/
├─ main.tex
├─ ...
└─ .texweave/
   └─ relations.json
```

Exact storage location may follow the existing TeXWeave project metadata design.

---

# 32. Suggested Serialized Format

Example:

```json
{
  "version": 1,
  "relations": [
    {
      "id": "rel-01",
      "sourceId": "block-lemma-2",
      "targetId": "block-theorem-4",
      "createdBy": "user",
      "createdAt": 1791020000000,
      "updatedAt": 1791020000000
    }
  ]
}
```

The serialized format must contain its own schema version.

---

# 33. Stable Block IDs

Relation persistence depends on stable `BlockId`.

Therefore v0.5.6 assumes the v0.5.4 Block System provides stable identities across:

```text
application restart
recompilation
preview regeneration
ordinary text editing
block movement where identity remains preserved
```

If block identity changes unnecessarily, relations will become unreliable.

The Relation System must not attempt to solve block identity independently.

---

# 34. Migration

When loading older projects:

```text
no relation metadata
```

should be interpreted as:

```text
empty relation graph
```

No automatic AI-generated relations should be created during migration.

For future schema migrations:

```ts
migrateRelationData(
  data: unknown,
  fromVersion: number,
  toVersion: number
): RelationStoreData;
```

Migration must be deterministic and must not require LLM calls.

---

# 35. Caching

Relation traversal may be called frequently by:

```text
filtering
search
graph extraction
AI context generation
dependency inspection
```

The backend may cache:

```text
direct prerequisites
direct dependents
ancestor sets
descendant sets
relation scopes
```

However, cached data must be invalidated whenever a relation is:

```text
created
deleted
reversed
```

or when a relation-capable block is:

```text
deleted
reclassified
reidentified
```

---

# 36. Graph Indexes

At minimum, maintain adjacency indexes:

```ts
Map<BlockId, Set<BlockId>> outgoing;
Map<BlockId, Set<BlockId>> incoming;
```

This provides efficient access for:

```text
direct queries
BFS
DFS
cycle detection
scope construction
```

Optionally maintain:

```ts
Map<RelationId, BlockRelation>
```

and:

```ts
Map<string, RelationId>
```

for `(sourceId, targetId)` duplicate detection.

---

# 37. Complexity Targets

For a graph with:

```text
V = relation-capable blocks
E = relations
```

basic traversal should remain approximately:

```text
O(V + E)
```

for complete graph traversal.

Direct prerequisite/dependent lookup should be near:

```text
O(1 + degree)
```

using adjacency maps.

The relation backend should not perform full document parsing during ordinary relation queries.

---

# 38. Transaction Safety

Operations that change graph consistency should preferably be atomic.

Examples:

```text
reverse relation
delete block + attached relations
relation migration
project import
```

A failed operation must not leave partially updated relation state.

---

# 39. Error Model

Backend errors should be machine-readable.

Example:

```ts
class RelationError extends Error {
  code: RelationErrorCode;
  details?: Record<string, unknown>;
}
```

Suggested codes:

```ts
type RelationErrorCode =
  | "BLOCK_NOT_FOUND"
  | "INVALID_ENDPOINT"
  | "SELF_RELATION"
  | "RELATION_EXISTS"
  | "RELATION_NOT_FOUND"
  | "CYCLE_DETECTED"
  | "INVALID_GRAPH_STATE"
  | "PERSISTENCE_ERROR";
```

Human-readable messages should be derived from codes rather than being the primary API contract.

---

# 40. Testing

v0.5.6 should include dedicated Relation System tests.

## 40.1 Creation tests

Verify:

```text
valid structural relation
semantic block relation
invalid content-block endpoint
self relation
duplicate relation
cycle-producing relation
```

---

## 40.2 Traversal tests

Graphs should include:

```text
chain
branch
merge
diamond
multiple disconnected components
deep dependency graph
```

Example diamond:

```text
    A
   / \
  B   C
   \ /
    D
```

Check:

```text
prerequisites
dependents
ancestors
descendants
distance
scope
path
```

---

## 40.3 Scope tests

Verify combinations of:

```text
prerequisites
dependents
both

depth 1
depth 2
depth all

single focus
multiple focus
```

---

## 40.4 Display Scope tests

Verify that Relation Scope correctly expands through the Block System.

Example:

```text
Section
└─ Theorem
   ├─ Text
   ├─ Equation
   └─ Proof
```

Expected behavior when Theorem is selected:

```text
Theorem included as relation block
contained blocks included when requested
structural parents included when requested
```

---

## 40.5 Validation tests

Verify detection of:

```text
cycles
duplicate edges
missing blocks
invalid block types
dangling relations
```

---

## 40.6 Persistence tests

Verify:

```text
save
reload
stable relation IDs
stable endpoints
schema migration
corrupted metadata handling
```

---

## 40.7 AI API tests

Verify that AI operations:

```text
use standard relation traversal
cannot bypass validation
create proposals rather than direct mutations
produce valid scopes
reject invalid endpoints
reject cycle-producing proposals
```

---

# 41. Recommended Backend Module Structure

A possible internal structure:

```text
relation/
├─ relation-types.ts
├─ relation-store.ts
├─ relation-service.ts
├─ relation-validator.ts
├─ relation-traversal.ts
├─ relation-scope.ts
├─ relation-filter.ts
├─ relation-persistence.ts
├─ relation-events.ts
├─ relation-ai.ts
└─ __tests__/
```

Responsibilities:

```text
relation-store
    raw relation state and indexes

relation-service
    public mutation/query API

relation-validator
    endpoint and graph validation

relation-traversal
    BFS/DFS/path queries

relation-scope
    logical scope construction

relation-filter
    Relation Scope → Display Scope

relation-persistence
    serialization and migration

relation-ai
    AI-safe read APIs and proposals
```

---

# 42. Core Public API Summary

Recommended minimal public backend API:

```ts
// Validation
canCreateRelation(sourceId, targetId)

// Mutation
createRelation(sourceId, targetId, options?)
deleteRelation(relationId)
reverseRelation(relationId)

// Direct query
getRelation(relationId)
getRelations(blockId)
getPrerequisites(blockId)
getDependents(blockId)

// Traversal
getAncestors(blockId, options?)
getDescendants(blockId, options?)
dependsOn(blockId, prerequisiteId)
findRelationPath(sourceId, targetId)

// Scope
getRelationScope(options)

// Graph
getRelationSubgraph(scope)

// Filtering
getDisplayScope(scope, options)

// Impact
getRelationImpact(blockId)

// Validation
validateRelationGraph()

// AI
getLogicContext(blockId, options?)
proposeRelationCreate(sourceId, targetId)
proposeRelationDelete(relationId)
proposeRelationReverse(relationId)
commitRelationProposal(proposalId)
```

---

# 43. Non-Goals for v0.5.6

The following are explicitly outside the initial Relation backend scope:

```text
multiple semantic edge types
equation-level dependency graph
figure/table relations
automatic source-order validation
automatic AI relation generation during project loading
visual graph layout
graph styling
node coordinates
relation animation
automatic deletion of transitive edges
general-purpose knowledge graphs
```

These features may be added later without changing the core `A → B` dependency model.

---

# 44. Final Architecture

The final backend relationship is:

```text
                Block System v0.5.4
                       │
                       ▼
                Relation Store
                       │
                       ▼
                Relation Service
                       │
       ┌───────────────┼────────────────┐
       ▼               ▼                ▼
   Traversal       Validation       Relation Scope
                                         │
                              ┌──────────┼──────────┐
                              ▼          ▼          ▼
                           Subgraph   Filtering     AI
```

The central principle of v0.5.6 is:

> Relations describe logical dependency between independent document blocks.

And the central intermediate representation is:

> Relation Scope defines the logical region currently being examined.

Everything else, including graph extraction, filtering and AI context selection, should reuse these two concepts instead of implementing separate relation logic.

---

# 45. v0.5.6 Acceptance Criteria

The backend implementation is considered complete when:

1. relation-capable blocks can be connected using a stable directed dependency model;
2. invalid endpoints, duplicates, self-relations and cycles are rejected;
3. direct and transitive dependencies can be queried;
4. arbitrary dependency paths can be searched;
5. Relation Scope supports focus, direction and depth;
6. Relation Scope can be converted into Display Scope through the existing Block System;
7. relation subgraphs can be generated independently of presentation logic;
8. graph validation detects cycles, duplicates, dangling relations and invalid endpoints;
9. relation data persists reliably across project sessions;
10. AI can use the same relation queries and scopes as the rest of TeXWeave;
11. AI relation modifications use validated proposals instead of bypassing the Relation Service;
12. all core functions are covered by automated tests.