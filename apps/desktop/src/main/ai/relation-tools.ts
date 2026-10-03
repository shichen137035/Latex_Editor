import type { RelationAIAPI, RelationProposal } from "@latex-editor/contracts" with { "resolution-mode": "import" };

type Schema = Record<string, unknown>;
const string = { type: "string" }, strings = { type: "array", items: string, minItems: 1, maxItems: 100 };
const object = (properties: Schema, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const direction = { type: "string", enum: ["prerequisites", "dependents", "both"] };
const depth = { anyOf: [{ type: "integer", minimum: 0 }, { const: "all" }] };
const scope = { focusIds: strings, direction, depth, includeFocus: { type: "boolean" } };
const descriptions: Record<keyof RelationAIAPI, { description: string; inputSchema: Schema }> = {
  get_prerequisites: { description: "Get direct logical prerequisites of a persistent structural block. source → target means target depends on source.", inputSchema: object({ blockId: string }, ["blockId"]) },
  get_dependents: { description: "Get direct logical dependents of a persistent structural block.", inputSchema: object({ blockId: string }, ["blockId"]) },
  get_scope: { description: "Get the shared logical Relation Scope, with distances, direction, multiple focus blocks and bounded or complete depth. Prefer this for selecting relevant context.", inputSchema: object(scope, ["focusIds", "direction", "depth"]) },
  find_path: { description: "Find a shortest logical dependency path, or null when disconnected.", inputSchema: object({ sourceId: string, targetId: string }, ["sourceId", "targetId"]) },
  get_subgraph: { description: "Extract a presentation-independent dependency subgraph from the shared Relation Scope.", inputSchema: object(scope, ["focusIds", "direction", "depth"]) },
  get_display_scope: { description: "Expand logical scope through Block System containment and structural parents. Read source only for required returned block IDs.", inputSchema: object({ ...scope, includeContent: { type: "boolean" }, includeStructuralParents: { type: "boolean" } }, ["focusIds", "direction", "depth", "includeContent", "includeStructuralParents"]) },
  get_logic_context: { description: "Get compact metadata and current summaries for logically related blocks. Actual source remains available via get_block_source.", inputSchema: object({ blockId: string, direction, depth }, ["blockId"]) },
  validate: { description: "Validate persistent relations for cycles, duplicates, invalid endpoints and dangling relations.", inputSchema: object({}) },
  propose_create: { description: "Propose source → target. Only relation-capable structural blocks are eligible; content blocks, duplicates, self-relations and cycles are rejected. Explicit user approval is required to commit.", inputSchema: object({ sourceId: string, targetId: string, reason: string }, ["sourceId", "targetId"]) },
  propose_delete: { description: "Propose deleting a relation by stable relation ID. Does not delete its blocks. Explicit user approval is required to commit.", inputSchema: object({ relationId: string, reason: string }, ["relationId"]) },
  propose_reverse: { description: "Propose reversing a relation atomically, preserving its stable ID. The reversed graph must pass validation and explicit user approval.", inputSchema: object({ relationId: string, reason: string }, ["relationId"]) }
};

/** Providers share schemas and dispatch; approval/commit is a separate user adapter. */
export function createRelationTools(api: RelationAIAPI, review?: (proposal: RelationProposal) => Promise<unknown>) {
  const dynamicTools = (Object.keys(descriptions) as Array<keyof RelationAIAPI>).map(method => ({ name: `relation_${method}`, ...descriptions[method] }));
  const toolHandlers = Object.fromEntries(dynamicTools.map(({ name }) => [name, async (input: Record<string, unknown>) => {
    try {
      const method = name.slice("relation_".length) as keyof RelationAIAPI;
      const result = await (api[method] as (input: Record<string, unknown>) => Promise<unknown>)(input);
      const reviewed = method.startsWith("propose_") && review ? await review(result as RelationProposal) : result;
      return JSON.stringify({ ok: true, data: reviewed });
    } catch (error) {
      const failure = error as { code?: string; details?: Record<string, unknown> };
      return JSON.stringify({ ok: false, error: { code: failure.code ?? "INVALID_GRAPH_STATE", message: error instanceof Error ? error.message : "Invalid relation request.", ...(failure.details ? { details: failure.details } : {}) } });
    }
  }]));
  return { dynamicTools, toolHandlers };
}

export async function createCopilotRelationTools(api: RelationAIAPI, review?: (proposal: RelationProposal) => Promise<unknown>) {
  const { defineTool } = await import("@github/copilot-sdk");
  const { dynamicTools, toolHandlers } = createRelationTools(api, review);
  return dynamicTools.map(({ name, description, inputSchema }) => defineTool<Record<string, unknown>>(name, { description, parameters: inputSchema, skipPermission: true, handler: toolHandlers[name]! }));
}
