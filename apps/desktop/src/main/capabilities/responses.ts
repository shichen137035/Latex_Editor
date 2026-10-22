import { contextEfficiencyPolicy } from "../ai/context-policy.js";
import { createHash } from "node:crypto";
import { functionTool, responseFunction } from "./adapters.js";
import { validateSchema } from "./schema.js";
import { CapabilityError, objectSchema, type Capability, type ToolDefinition } from "./types.js";

type Item = Record<string, unknown>;
type FunctionDefinition = ReturnType<typeof functionTool>;
type SearchOutput = { type: "tool_search_output"; execution: "client"; call_id: string; status: "completed"; tools: FunctionDefinition[] };
type FunctionOutput = { type: "function_call_output"; call_id: string; output: string };
export type ResponsesToolOutput = SearchOutput | FunctionOutput;
export type ResponsesResult = { output: Item[]; status?: string };
export type ResponsesRunResult = { response: ResponsesResult; history: Item[] };
export type ResponsesRequest = { model: string; input: Item[]; tools: Array<ReturnType<typeof responseFunction> | typeof searchTool>; instructions: string; parallel_tool_calls: false; store: false };
export type ResponsesTransport = {
  create(request: ResponsesRequest, signal?: AbortSignal): Promise<ResponsesResult>;
  /** Use the SDK's toResponseInputItems here; preserve reasoning, phase and loading order. */
  toInputItems(output: Item[]): Item[];
};
type Bindings = {
  alive(): boolean;
  search(query: string, limit: number): Capability[];
  invoke(capability: Capability, args: Record<string, unknown>, callId: string, active: () => boolean): Promise<string>;
  execute(args: Record<string, unknown>, active: () => boolean): Promise<string>;
  executeDefinition: ToolDefinition;
};

const searchTool = {
  type: "tool_search" as const, execution: "client" as const,
  description: "Find available TeXWeave tools for the task. Search with identifiers or English, Chinese or Japanese keywords. Load only the relevant tools; discovery grants no permission.",
  parameters: objectSchema({ query: { type: "string", minLength: 1, maxLength: 500 }, limit: { type: "integer", minimum: 1, maximum: 10 } }, ["query"])
};
export const responsesCapabilityWorkflow = "Use tool_search to discover only relevant TeXWeave functions. Call loaded read functions directly. Write functions return a plan without applying it; call tw_execute_operation to apply, verify or undo the plan. All application changes must use these trusted tools, never direct configuration or database edits. Tool discovery does not grant permissions. Read relevant enabled workflow skills only when needed. Report unavailable capabilities honestly. " + contextEfficiencyPolicy;

/** One local conversation/turn binding. Never share loaded tools across projects or users.
 * This adapter does not own credentials or guess app-server RPC extensions.
 */
export class ResponsesCapabilitySession {
  private readonly loaded = new Map<string, Capability>();
  private readonly calls = new Map<string, { signature: string; result: Promise<ResponsesToolOutput> }>();
  private closed = false;
  private running = false;
  private cachedBytes = 0;
  constructor(private readonly bindings: Bindings) {}

  get tools(): ResponsesRequest["tools"] { return [structuredClone(searchTool), responseFunction(this.bindings.executeDefinition)]; }
  private check(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.closed || !this.bindings.alive()) throw new CapabilityError("UNAVAILABLE", "The originating AI turn has ended.");
  }
  /** Process complete response items, never streaming argument fragments. Calls execute in order. */
  async handleOutput(output: Item[], signal?: AbortSignal): Promise<ResponsesToolOutput[]> {
    this.check(signal);
    if (output.length > 100) throw new CapabilityError("INVALID_ARGUMENTS", "Response item budget exceeded.");
    const results: ResponsesToolOutput[] = [];
    for (const item of output) {
      if (item.type !== "tool_search_call" && item.type !== "function_call") continue;
      this.check(signal);
      if (typeof item.call_id !== "string" || !item.call_id || item.call_id.length > 160) throw new CapabilityError("INVALID_ARGUMENTS", "A valid tool call_id is required.");
      const signature = createHash("sha256").update(JSON.stringify(item)).digest("hex"), previous = this.calls.get(item.call_id);
      if (previous && previous.signature !== signature) throw new CapabilityError("CONFLICT", "Tool call_id was reused with different content.");
      if (!previous && (this.calls.size >= 200 || this.cachedBytes >= 8_000_000)) throw new CapabilityError("UNAVAILABLE", "Tool call budget exceeded; start a new turn.");
      const result = previous?.result ?? this.handleCall(item, item.call_id, signal).then(value => { this.cachedBytes += Buffer.byteLength(JSON.stringify(value)); return value; });
      if (!previous) this.calls.set(item.call_id, { signature, result });
      results.push(structuredClone(await result));
    }
    return results;
  }
  private async handleCall(item: Item, callId: string, signal?: AbortSignal): Promise<ResponsesToolOutput> {
    this.check(signal);
    if (item.type === "tool_search_call") {
      if (item.execution !== "client") throw new CapabilityError("INVALID_ARGUMENTS", "Only client tool search is supported by this session.");
      const args = this.arguments(item.arguments);
      validateSchema(searchTool.parameters, args);
      const candidates = this.bindings.search(String(args.query), Number(args.limit ?? 5));
      const fresh: Capability[] = [];
      for (const cap of candidates) {
        if (cap.apiName === this.bindings.executeDefinition.name) throw new CapabilityError("INVALID_ARGUMENTS", "Reserved tool name in capability catalog.");
        const existing = this.loaded.get(cap.apiName);
        if (existing && (existing.id !== cap.id || existing.schemaHash !== cap.schemaHash)) throw new CapabilityError("STALE_SCHEMA", "Loaded tool definition changed; start a new session.");
        if (!existing && !fresh.some(candidate => candidate.apiName === cap.apiName)) fresh.push(cap);
      }
      if (this.loaded.size + fresh.length > 100) throw new CapabilityError("UNAVAILABLE", "Loaded tool budget exceeded; start a new turn.");
      const tools = fresh.slice(0, 10).map(functionTool);
      this.check(signal);
      for (const cap of fresh.slice(0, 10)) this.loaded.set(cap.apiName, structuredClone(cap));
      return { type: "tool_search_output", execution: "client", call_id: callId, status: "completed", tools };
    }
    try {
      // Definitions are top-level functions. Reject an unrelated namespace rather than routing by name alone.
      if (item.namespace !== undefined && item.namespace !== null && item.namespace !== item.name) throw new CapabilityError("PERMISSION_DENIED", "Unknown tool namespace.");
      const args = this.arguments(item.arguments);
      let output: string;
      if (item.name === this.bindings.executeDefinition.name) {
        validateSchema(this.bindings.executeDefinition.inputSchema, args);
        output = await this.bindings.execute(args, () => !this.closed && !signal?.aborted);
      } else {
        const cap = typeof item.name === "string" ? this.loaded.get(item.name) : undefined;
        if (!cap) throw new CapabilityError("PERMISSION_DENIED", "Tool has not been loaded by this session's search. Search before calling it.");
        validateSchema(cap.inputSchema, args);
        output = await this.bindings.invoke(cap, args, callId, () => !this.closed && !signal?.aborted);
      }
      return { type: "function_call_output", call_id: callId, output };
    } catch (error) {
      return { type: "function_call_output", call_id: callId, output: JSON.stringify({ ok: false, error: { code: error instanceof CapabilityError ? error.code : "EXECUTION_FAILED", message: error instanceof CapabilityError ? error.message : "The tool request could not be completed." } }) };
    }
  }
  private arguments(value: unknown): Record<string, unknown> {
    if (typeof value === "string") {
      if (value.length > 2_000_000) throw new CapabilityError("INVALID_ARGUMENTS", "Tool argument budget exceeded.");
      try { value = JSON.parse(value); } catch { throw new CapabilityError("INVALID_ARGUMENTS", "Tool arguments must be valid JSON."); }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new CapabilityError("INVALID_ARGUMENTS", "Tool arguments must be an object.");
    return value as Record<string, unknown>;
  }
  /** SDK-independent Responses loop; the authenticated transport and SDK conversion are injected.
   * No automatic fallback/retry after a write: that could repeat an operation.
   */
  async run(transport: ResponsesTransport, input: { model: string; input: Item[]; signal?: AbortSignal; maxRounds?: number; onResponse?(response: ResponsesResult): void }): Promise<ResponsesRunResult> {
    if (this.running) throw new CapabilityError("CONFLICT", "A Responses loop is already running for this session.");
    const maxRounds = input.maxRounds ?? 20;
    if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 50) throw new CapabilityError("INVALID_ARGUMENTS", "Invalid round budget.");
    const history = structuredClone(input.input);
    this.running = true;
    try {
      for (let round = 0; round < maxRounds; round++) {
        this.check(input.signal);
        const response = await transport.create({ model: input.model, input: structuredClone(history), tools: this.tools, instructions: responsesCapabilityWorkflow, parallel_tool_calls: false, store: false }, input.signal);
        this.check(input.signal);
        if (response.status && response.status !== "completed") throw new CapabilityError("UNAVAILABLE", "The Responses request did not complete; tools were not executed.");
        input.onResponse?.(response);
        const hasCalls = response.output.some(item => item.type === "tool_search_call" || item.type === "function_call");
        if (!hasCalls) return { response, history: [...history, ...transport.toInputItems(response.output)] };
        // Do not execute work on the last round with no chance to report its result.
        if (round + 1 === maxRounds) throw new CapabilityError("UNAVAILABLE", "Responses tool round budget exceeded.");
        const converted = transport.toInputItems(response.output);
        const results = await this.handleOutput(response.output, input.signal);
        this.check(input.signal);
        history.push(...converted, ...results);
      }
      throw new CapabilityError("UNAVAILABLE", "Responses tool round budget exceeded.");
    } finally { this.running = false; }
  }
  close(): void { this.closed = true; this.loaded.clear(); this.calls.clear(); this.cachedBytes = 0; }
}
