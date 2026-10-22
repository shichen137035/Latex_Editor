import type { DocumentBlockApi } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import { validateSchema } from "../capabilities/schema.js";

type Schema = Record<string, unknown>;
const string = { type: "string" }, strings = { type: "array", items: string };
const revision = { type: "integer", minimum: 1 };
const object = (properties: Schema, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const parentId = { type: ["string", "null"] };
const kind = { type: "string", enum: ["structural", "content"] };
const limit = { type: "integer", minimum: 1, maximum: 100 };
const offset = { type: "integer", minimum: 0, maximum: 1_000_000 };
const detailOptions = { detail: { type: "string", enum: ["compact", "full"] }, childOffset: offset, childLimit: { type: "integer", minimum: 1, maximum: 50 } };
const descriptions: Record<keyof DocumentBlockApi, { description: string; inputSchema: Schema }> = {
  list_blocks: { description: "Locate blocks with compact metadata, no source. Defaults to 10 cards; use returned page.nextOffset for more. Use filters instead of enumerating the document. Read get_block with detail=full for abbreviated fields.", inputSchema: object({ parentId, fileId: string, kind, types: strings, origin: { type: "string", enum: ["environment", "virtual", "user"] }, recursive: { type: "boolean" }, limit, offset }) },
  find_blocks: { description: "Find blocks by title, label, compiled number, ordinal, tags or query. Defaults to 10 compact cards; use page.nextOffset to paginate. Content is searched only when necessary. Inspect only relevant matches.", inputSchema: object({ query: string, type: { anyOf: [string, strings] }, kind, label: string, number: string, ordinal: { type: "integer", minimum: 1 }, tags: strings, parentId, fileId: string, limit, offset }) },
  get_block: { description: "Inspect revision, location, parent, capabilities and at most 10 children, without source. childOffset/childLimit paginate children; detail=full retrieves unabbreviated metadata. Source and exact labels are never abbreviated.", inputSchema: object({ blockId: string, ...detailOptions }, ["blockId"]) },
  get_blocks: { description: "Inspect up to 20 relevant blocks in one request, no source. Same compact metadata and child pagination as get_block. Batch known IDs instead of repeated lookups.", inputSchema: object({ blockIds: { ...strings, maxItems: 20 }, ...detailOptions }, ["blockIds"]) },
  get_block_source: { description: "Read only one block's exact source and revision. Environment-backed content includes its complete wrapper. Fetch only blocks necessary for the user's task.", inputSchema: object({ blockId: string }, ["blockId"]) },
  replace_block_content: { description: "Replace a content block's full returned source. Prefer replace_block_range for small edits to avoid repeating unchanged text. Preserve LaTeX wrappers/labels. Structural blocks must be edited through content children. expectedRevision is required.", inputSchema: object({ blockId: string, expectedRevision: revision, content: string }, ["blockId", "expectedRevision", "content"]) },
  replace_block_range: { description: "Precisely edit part of a content block. Fetch get_block_source first. start/end are zero-based UTF-16 offsets relative to its returned content, end exclusive. expectedText must exactly match the replaced slice; content is only the replacement. Equal start/end inserts text. Preserve wrappers and refetch after STALE_BLOCK or BLOCK_TEXT_MISMATCH.", inputSchema: object({ blockId: string, expectedRevision: revision, start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 0 }, expectedText: string, content: string }, ["blockId", "expectedRevision", "start", "end", "expectedText", "content"]) },
  insert_block: { description: "Insert a typed block into a parent or file root. Prefer structural parents. Pass fileId for root insertions in multi-file projects. Heading title is separate from body content.", inputSchema: object({ parentId, fileId: string, expectedRevision: revision, position: { anyOf: [{ type: "string", enum: ["start", "end"] }, object({ before: string }, ["before"]), object({ after: string }, ["after"])] }, block: object({ type: string, content: string, title: string }, ["type"]) }, ["parentId", "position", "block"]) },
  delete_block: { description: "Delete a block and its entire subtree from source; does not unwrap the environment. Requires a current expectedRevision.", inputSchema: object({ blockId: string, expectedRevision: revision }, ["blockId", "expectedRevision"]) },
  set_block_semantic: { description: "Set optional user/AI summary or separately owned tags for a block at the current revision. Does not change the LaTeX source.", inputSchema: object({ blockId: string, expectedRevision: revision, summary: object({ text: string, source: { type: "string", enum: ["ai", "user"] } }, ["text", "source"]), tags: object({ user: strings, ai: strings }) }, ["blockId", "expectedRevision"]) }
};

export const blockToolDefinitions = (Object.keys(descriptions) as Array<keyof DocumentBlockApi>).map(name => ({ name, ...descriptions[name] }));

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function metadata(value: unknown, input: Record<string, unknown>): unknown {
  if (!record(value)) return value;
  const result = { ...value }, shortened: string[] = [];
  if (input.detail !== "full") {
    for (const [key, max] of [["title", 160], ["summary", 200]] as const) {
      if (typeof result[key] === "string" && result[key].length > max) { result[key] = result[key].slice(0, max) + "…"; shortened.push(key); }
    }
    if (Array.isArray(result.tags) && result.tags.length > 12) { result.tags = result.tags.slice(0, 12); shortened.push("tags"); }
  }
  if (shortened.length) result.abbreviatedFields = shortened;
  if (Array.isArray(result.children)) {
    const offset = Number(input.childOffset ?? 0), limit = Number(input.childLimit ?? 10), total = result.children.length;
    result.children = result.children.slice(offset, offset + limit).map(child => metadata(child, input));
    result.childrenPage = { offset, limit, total, nextOffset: offset + limit < total ? offset + limit : null };
  }
  if (result.parent) result.parent = metadata(result.parent, input);
  return result;
}

/** One schema/dispatch table shared by Codex dynamic tools and Copilot tools. */
export function createBlockTools(api: DocumentBlockApi) {
  const dynamicTools = blockToolDefinitions;
  const toolHandlers = Object.fromEntries(dynamicTools.map(({ name }) => [name, async (input: Record<string, unknown>) => {
    try {
      validateSchema(descriptions[name].inputSchema, input);
      const call = api[name] as (input: Record<string, unknown>) => Promise<unknown>;
      if (name === "list_blocks" || name === "find_blocks") {
        const offset = Number(input.offset ?? 0), limit = Number(input.limit ?? 10);
        const response = await call({ ...input, offset, limit: limit + 1 });
        if (!record(response) || response.ok !== true || !Array.isArray(response.data)) return JSON.stringify(response);
        return JSON.stringify({ ...response, data: response.data.slice(0, limit).map(card => metadata(card, input)), page: { offset, limit, nextOffset: response.data.length > limit ? offset + limit : null } });
      }
      const response = await call(input);
      if (name === "get_block_source" || !record(response) || response.ok !== true) return JSON.stringify(response);
      return JSON.stringify({ ...response, data: Array.isArray(response.data) ? response.data.map(value => metadata(value, input)) : metadata(response.data, input) });
    } catch (error) { return JSON.stringify({ ok: false, error: { code: "INVALID_GRAPH_QUERY", message: error instanceof Error ? error.message : "Invalid tool arguments." } }); }
  }]));
  return { dynamicTools, toolHandlers };
}

export async function createCopilotBlockTools(api: DocumentBlockApi) {
  const { defineTool } = await import("@github/copilot-sdk");
  const { dynamicTools, toolHandlers } = createBlockTools(api);
  return dynamicTools.map(({ name, description, inputSchema }) => defineTool<Record<string, unknown>>(name, { description, parameters: inputSchema, skipPermission: true, handler: toolHandlers[name]! }));
}
