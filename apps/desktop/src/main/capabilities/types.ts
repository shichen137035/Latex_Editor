import type { AIPermissionMode, AIOperationReport } from "@latex-editor/contracts" with { "resolution-mode": "import" };

export type Schema = Record<string, unknown>;
export type ToolDefinition = { name: string; description: string; inputSchema: Schema };
export type Capability = {
  id: string; apiName: string; namespace: string; title: string; description: string;
  kind: "query" | "command" | "setting" | "diagnostic";
  inputSchema: Schema; outputSchema?: Schema; handlerKey: string;
  sideEffect: "none" | "reversible" | "external";
  approvalPolicy: "auto" | "confirm" | "restricted";
  scopes: Array<"global" | "project">; permissions: string[];
  aliases: Record<string, string[]>; sinceVersion: string; schemaHash: string;
  settingKey?: string; help?: string; status: "active" | "disabled";
};
export type Availability = { available: boolean; reason?: string };
export type Handler = (args: Record<string, unknown>) => Promise<unknown>;
export type OperationContext = {
  sessionId: string; origin: "pet" | "project"; projectId?: string;
  alive(): boolean; permissionMode(): AIPermissionMode;
  grantedScopes?(): ReadonlySet<string>;
  requestApproval(description: string): Promise<boolean>;
  handlers: Record<string, Handler>;
  skills: { name: string; description: string }[];
  readSkill(name: string): Promise<string>;
  onOperation?(report: AIOperationReport): void;
};
export type OperationStatus = "proposed" | "approved" | "applied" | "verified" | "failed" | "reverted";
export class CapabilityError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export const objectSchema = (properties: Schema, required: string[] = []): Schema => ({ type: "object", properties, required, additionalProperties: false });
