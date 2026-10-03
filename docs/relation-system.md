# Relation backend v0.5.6

`sourceId → targetId` always means the target depends logically on the source.
`ProjectRelationService` is the application boundary used by Electron IPC, CLI,
Codex and Copilot. `RelationGraphManager` owns indexed traversal, paths, validation
and logical scopes; the existing Block System supplies identity, classification,
capabilities and hierarchy. The backend has no graph layout or visibility state.

## Endpoint and mutation rules

Only active relation-capable structural blocks can be endpoints. This includes
the structural `placeholder` virtual block, whose source markers are LaTeX
comments and have no effect on PDF output. Content blocks and list containers
cannot be connected, even if a caller supplies a connectable override. Structural
containment and document order impose no extra logical ordering restrictions.

All creation paths, including the compatibility `blockGraph.addDependency`
entry point, reject missing/ineligible endpoints, self-relations, duplicate
ordered pairs and directed cycles. Reverse validates while excluding only the
original edge and preserves its ID and creator. Deletion removes only the edge;
block deletion removes its attached edges through the same project transaction.
Reclassifying or orphaning a block preserves existing edges for explicit
validation/repair rather than silently deleting logical information.

## Persistence and migration

Relation records live in the existing `.texweave/structure.json` metadata:

```json
{
  "relationSchemaVersion": 1,
  "relations": [
    {"id":"rel-1","sourceId":"A","targetId":"B","createdBy":"user","createdAt":1,"updatedAt":1}
  ],
  "dependencies": [{"from":"A","to":"B"}]
}
```

`relations` is authoritative when present; `dependencies` is a generated
compatibility projection for existing renderer and graph consumers. Raw LaTeX
remains separate. Both records and projection are written atomically by the
existing file service, under the Block System's per-project mutation queue, and
participate in its undo/redo history. Source index refreshes preserve relation
records and IDs.

Old `.texweave/block-graph.json`, array snapshots and canonical structures that
only contain `dependencies` migrate deterministically. Existing edges receive
stable legacy IDs, creator `user`, and zero timestamps rather than an invented
creation date. Missing metadata means an empty graph. Loading and queries do not
invent AI relations or discard invalid edges. Malformed records/unsupported
schemas fail explicitly; full validation reports cycles, duplicate endpoints or
IDs, dangling edges and ineligible endpoints, including their relation IDs.

## Queries and scopes

`getPrerequisites`/`getDependents` are direct indexed queries. `getAncestors` and
`getDescendants` return shortest BFS distances with an optional depth limit;
`findRelationPath` returns a shortest path or null. Traversal and validation use
iterative algorithms so deep graphs do not require recursive call stacks.

`getRelationScope({focusIds, direction, depth, includeFocus?})` unions all focuses
and retains minimum distances. Direction is `prerequisites`, `dependents` or
`both`; depth is a non-negative integer or `all`. Focus direction has precedence;
when a block has equal prerequisite/dependent distance from different focuses,
the prerequisite classification is the deterministic tie break. The scope
contains only edges with both endpoints in the returned block set.

Subgraph extraction consumes that scope. Display Scope expands its members using
Block System descendants and/or structural ancestors. `contentBlockIds` contains
the requested contained blocks, including nested proof/structural containers,
without making those members additional logical traversal focuses. The result
is a set of IDs that can be intersected with search/other filters. Internal
relation events invalidate consumers after writes; the engine has no retained
scope caches that could survive deletion, reversal or reclassification.

## Adapters and AI approval

Electron exposes typed `window.latexEditor.relations` methods and `onUpdate`.
Existing relation UI mutations retain their compatibility adapter and share the
same validator and scopes. CLI provides `relation create/delete/reverse/get`,
direct/transitive queries, path, scope, subgraph, display-scope, impact, context
and validate commands; use `npm run cli -- --help` for invocation examples.

Codex and Copilot share the `relation_get_prerequisites`,
`relation_get_dependents`, `relation_get_scope`, `relation_find_path`,
`relation_get_subgraph`, `relation_get_display_scope`,
`relation_get_logic_context` and `relation_validate` tool implementations.
Block source still comes from the ordinary block tools.

AI writes call `relation_propose_create`, `relation_propose_delete` or
`relation_propose_reverse`. A proposal has no persistent graph effect. The user
adapter presents the exact operation/reason through TeXWeave's approval UI even
in full access mode; only explicit approval invokes `commitRelationProposal`.
Commit uses the same transaction and validator as manual writes, checks a
delete/reverse proposal's original record for staleness, and attributes newly
created edges to AI. Pending proposals remain session-local, are project-scoped,
and cannot be reused after successful commit/rejection. Failed commits remain
available for review but never overwrite concurrent graph changes.

Tools query persistent project IDs; newly proposed source blocks need to be
accepted before linking. Relation fields are excluded from AI metadata file
diffs so shell edits cannot bypass approval or replay an old graph snapshot.
Ordinary source and summary/tag edits retain their existing review workflow.
Provider tool schema version 3 refreshes older provider sessions automatically.

Regression coverage is in `tests/unit/relations.test.ts`, the existing block
graph/structure tests, AI context tests and IPC contract tests.
