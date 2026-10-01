import type { DocumentBlockApi } from "@latex-editor/contracts" with { "resolution-mode": "import" };

type Schema = Record<string, unknown>;
const string = { type: "string" }, strings = { type: "array", items: string };
const revision = { type: "integer", minimum: 1 };
const object = (properties: Schema, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const parentId = { type: ["string", "null"] };
const kind = { type: "string", enum: ["structural", "content"] };
const limit = { type: "integer", minimum: 1, maximum: 500 };
const descriptions: Record<keyof DocumentBlockApi, { description: string; inputSchema: Schema }> = {
  list_blocks: { description: "Locate document blocks using lightweight metadata cards, without reading source. Start here before reading complete files.", inputSchema: object({ parentId, fileId: string, kind, types: strings, origin: { type: "string", enum: ["environment", "virtual", "user"] }, recursive: { type: "boolean" }, limit }) },
  find_blocks: { description: "Find blocks by title, label, actual compiled number, ordinal, tags or query. Metadata is searched first; content is searched only when necessary.", inputSchema: object({ query: string, type: { anyOf: [string, strings] }, kind, label: string, number: string, ordinal: { type: "integer", minimum: 1 }, tags: strings, parentId, fileId: string, limit }) },
  get_block: { description: "Inspect a block, its parent and child cards, location, capabilities and current revision. Does not read the body.", inputSchema: object({ blockId: string }, ["blockId"]) },
  get_blocks: { description: "Inspect up to 100 blocks in a single request, without reading their source.", inputSchema: object({ blockIds: { ...strings, maxItems: 100 } }, ["blockIds"]) },
  get_block_source: { description: "Read only one block's exact source and revision. Environment-backed content includes its complete wrapper. Fetch only blocks necessary for the user's task.", inputSchema: object({ blockId: string }, ["blockId"]) },
  replace_block_content: { description: "Replace a content block's exact returned source, preserving any LaTeX wrapper/labels yourself. Structural blocks must be edited through their content children. expectedRevision is required; STALE_BLOCK requires refetching.", inputSchema: object({ blockId: string, expectedRevision: revision, content: string }, ["blockId", "expectedRevision", "content"]) },
  insert_block: { description: "Insert a typed block into a parent or file root. Prefer structural parents. Pass fileId for root insertions in multi-file projects. Heading title is separate from body content.", inputSchema: object({ parentId, fileId: string, expectedRevision: revision, position: { anyOf: [{ type: "string", enum: ["start", "end"] }, object({ before: string }, ["before"]), object({ after: string }, ["after"])] }, block: object({ type: string, content: string, title: string }, ["type"]) }, ["parentId", "position", "block"]) },
  delete_block: { description: "Delete a block and its entire subtree from source; does not unwrap the environment. Requires a current expectedRevision.", inputSchema: object({ blockId: string, expectedRevision: revision }, ["blockId", "expectedRevision"]) },
  set_block_semantic: { description: "Set optional user/AI summary or separately owned tags for a block at the current revision. Does not change the LaTeX source.", inputSchema: object({ blockId: string, expectedRevision: revision, summary: object({ text: string, source: { type: "string", enum: ["ai", "user"] } }, ["text", "source"]), tags: object({ user: strings, ai: strings }) }, ["blockId", "expectedRevision"]) }
};

/** One schema/dispatch table shared by Codex dynamic tools and Copilot tools. */
export function createBlockTools(api: DocumentBlockApi) {
  const dynamicTools = (Object.keys(descriptions) as Array<keyof DocumentBlockApi>).map((name) => ({ name, ...descriptions[name] }));
  const toolHandlers = Object.fromEntries(dynamicTools.map(({ name }) => [name, async (input: Record<string, unknown>) => {
    try {
      const call = api[name] as (input: Record<string, unknown>) => Promise<unknown>;
      return JSON.stringify(await call(input));
    } catch (error) { return JSON.stringify({ ok: false, error: { code: "INVALID_GRAPH_QUERY", message: error instanceof Error ? error.message : "Invalid tool arguments." } }); }
  }]));
  return { dynamicTools, toolHandlers };
}

export async function createCopilotBlockTools(api: DocumentBlockApi) {
  const { defineTool } = await import("@github/copilot-sdk");
  const { dynamicTools, toolHandlers } = createBlockTools(api);
  return dynamicTools.map(({ name, description, inputSchema }) => defineTool<Record<string, unknown>>(name, { description, parameters: inputSchema, skipPermission: true, handler: toolHandlers[name]! }));
}
