import { assertSupportedSchema } from "./schema.js";
import type { Capability, ToolDefinition } from "./types.js";

/** All projections derive from the same trusted descriptor; optional arguments stay optional. */
export const mcpTool = (cap: Capability) => ({ name: cap.apiName, description: cap.description, inputSchema: cap.inputSchema, ...(cap.outputSchema ? { outputSchema: cap.outputSchema } : {}) });
export const responseFunction = (tool: ToolDefinition, deferred = false) => ({
  type: "function" as const, name: tool.name, description: tool.description,
  parameters: structuredClone(tool.inputSchema), strict: false,
  ...(deferred ? { defer_loading: true } : {})
});
export const functionTool = (cap: Capability) => {
  assertSupportedSchema(cap.inputSchema);
  return responseFunction({ name: cap.apiName, inputSchema: cap.inputSchema, description: cap.description + (cap.sideEffect === "none" ? "" : " This call only prepares a plan. Apply it with tw_execute_operation; planning does not grant approval.") }, true);
};

export type CapabilityTransport = { protocol: "responses" | "codex-app-server" | "copilot-sdk"; clientToolSearch?: boolean };
/** Explicit transport negotiation, never infer support from a model name or Codex login. */
export const supportsNativeToolSearch = (transport: CapabilityTransport) => transport.protocol === "responses" && transport.clientToolSearch === true;
export const capabilityTransportStatus = {
  codex: "fixed-tool-bridge", copilot: "fixed-tool-bridge", nativeToolSearch: false,
  responses: "client-tool-search-adapter", mcp: "projection-only"
} as const;
