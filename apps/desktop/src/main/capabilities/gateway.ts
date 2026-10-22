import { contextEfficiencyPolicy } from "../ai/context-policy.js";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PreferenceKey, SettingsSnapshot, AIOperationReport } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import type { SettingsRepository } from "../settings.js";
import { validateGeneratedTheme, type ThemeRepository } from "../themes.js";
import type { CapabilityRegistry } from "./registry.js";
import { validateSchema } from "./schema.js";
import { supportsNativeToolSearch, type CapabilityTransport } from "./adapters.js";
import { ResponsesCapabilitySession } from "./responses.js";
import { CapabilityError, objectSchema, type Availability, type Capability, type OperationContext, type OperationStatus, type ToolDefinition } from "./types.js";
import { definitionResult, effectiveDefinitions, prepareDefinition, type DefinitionKey } from "./customization.js";
import type { EnvironmentDefinition } from "@latex-editor/editor-core/preview/types" with { "resolution-mode": "import" };

type Plan = { id: string; capability: Capability; args: Record<string, unknown>; context: OperationContext; before?: unknown; beforeEffective?: unknown; settingValue?: unknown; summary?: { before: unknown; after: unknown }; expires: number; status: OperationStatus; result?: unknown; pending?: Promise<unknown> };
const settingWrite = (cap: Capability) => ["settings.write", "customization.write"].includes(cap.handlerKey);
const settingValue = (plan: Plan) => plan.settingValue ?? plan.args.value;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const string = { type: "string", maxLength: 200 };
const argsSchema = { type: "object" }; // Validated against the selected descriptor, independently on every invocation.
export const CAPABILITY_TOOLS_VERSION = 7;
export const capabilityToolDefinitions: ToolDefinition[] = [
  { name: "tw_search_capabilities", description: "Search real TeXWeave capabilities with English, Chinese or Japanese keywords. Returns at most 5 short metadata cards, no parameter schemas. Search before guessing an API.", inputSchema: objectSchema({ query: { type: "string", maxLength: 500 }, limit: { type: "integer", minimum: 1, maximum: 10 } }, ["query"]) },
  { name: "tw_get_capability", description: "Load a relevant schema once, then reuse it. Optional knownSchemaHash returns unchanged=true without resending a known schema. Availability is always fresh; discovery grants no permission.", inputSchema: objectSchema({ id: string, knownSchemaHash: string }, ["id"]) },
  { name: "tw_get_state", description: "Run one read-only capability using its inspected schema. For project content or a workflow skill, search first and read only what is needed. Writes are rejected here.", inputSchema: objectSchema({ id: string, arguments: argsSchema }, ["id", "arguments"]) },
  { name: "tw_plan_operation", description: "Validate a write capability and prepare an expiring plan. Settings plans show before/after values and scope. Does not execute or grant approval. Use a stable requestId on retries.", inputSchema: objectSchema({ id: string, arguments: argsSchema, requestId: string }, ["id", "arguments", "requestId"]) },
  { name: "tw_execute_operation", description: "Execute, verify or undo a plan. May remain pending for user approval. Await the existing call with the longest supported wait; never poll with repeated execution, state or clock calls. Permissions and conflicts are rechecked.", inputSchema: objectSchema({ operationId: string, action: { type: "string", enum: ["apply", "verify", "undo"] } }, ["operationId", "action"]) }
];
export const capabilityWorkflow = "Use the TeXWeave registry: search once per task area and load only relevant schemas, then reuse known capability IDs. Read state or plan and execute writes. Native working-copy file tools are appropriate for preambles/macros outside blocks; do not repeatedly search for an unregistered generic patch API. Settings/configuration must use the gateway, never direct file/database edits. Read only relevant enabled skills; their index is not authorization. Report unavailable operations honestly. " + contextEfficiencyPolicy;

export class CapabilityService {
  private journal: DatabaseSync | undefined;
  private readonly plans = new Map<string, Plan>();
  private readonly retries = new Map<string, string>();
  private readonly responseSessions = new Map<string, Set<ResponsesCapabilitySession>>();
  private readonly records: Array<{ id: string; status: string; capabilityId: string; durationMs?: number; code?: string }> = [];
  constructor(readonly registry: CapabilityRegistry, private readonly options: {
    settings: SettingsRepository; journalPath: string; themes?: ThemeRepository; blockDefinitions?: EnvironmentDefinition[];
    projectState(id: string): { writable: boolean; missing?: boolean } | undefined;
    onSettingsChanged?(snapshot: SettingsSnapshot, projectId?: string): void;
  }) {}

  initialize(): void {
    try {
      mkdirSync(dirname(this.options.journalPath), { recursive: true });
      this.journal = new DatabaseSync(this.options.journalPath);
      this.journal.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,origin TEXT NOT NULL,project_id TEXT,capability_id TEXT NOT NULL,schema_hash TEXT NOT NULL,status TEXT NOT NULL,scope TEXT,before_json TEXT,after_json TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,error_code TEXT); CREATE INDEX IF NOT EXISTS operations_updated ON operations(updated_at);");
      if (!this.journal.prepare("PRAGMA table_info(operations)").all().some(column => column.name === "before_effective_json")) this.journal.exec("ALTER TABLE operations ADD COLUMN before_effective_json TEXT");
      if (!this.journal.prepare("PRAGMA table_info(operations)").all().some(column => column.name === "summary_json")) this.journal.exec("ALTER TABLE operations ADD COLUMN summary_json TEXT");
      // Interrupted writes are not silently considered successful after a crash.
      this.journal.prepare("UPDATE operations SET status='failed',error_code='INTERRUPTED' WHERE status IN ('proposed','approved','applied')").run();
      this.journal.prepare("DELETE FROM operations WHERE updated_at < ?").run(Date.now() - 90 * 86400_000);
      this.journal.exec("DELETE FROM operations WHERE id NOT IN (SELECT id FROM operations ORDER BY updated_at DESC LIMIT 10000)");
    } catch { this.journal?.close(); this.journal = undefined; console.warn("Capability writes disabled: operation journal unavailable."); }
  }
  get metrics() { return this.records.slice(-100); }
  operationReports(ids: string[]): AIOperationReport[] {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== "string" || id.length > 64)) throw new CapabilityError("INVALID_ARGUMENTS", "Invalid operation ids");
    return ids.flatMap(id => {
      const row = this.journal?.prepare("SELECT * FROM operations WHERE id=?").get(id);
      if (!row || row.scope === null) return [];
      const cap = this.descriptor(String(row.capability_id));
      const summary = row.summary_json ? JSON.parse(String(row.summary_json)) as { before: unknown; after: unknown } : undefined;
      return [{ operationId: id, capabilityId: cap.id, title: cap.title, status: row.status as AIOperationReport["status"], scope: String(row.scope), before: summary ? summary.before : JSON.parse(String(row.before_effective_json ?? row.before_json)), after: summary ? summary.after : JSON.parse(String(row.after_json)), ...(row.project_id ? { projectId: String(row.project_id) } : {}) }];
    });
  }
  private record(plan: Plan, status: OperationStatus, code?: string): void {
    plan.status = status;
    this.journal?.prepare("UPDATE operations SET status=?,updated_at=?,error_code=? WHERE id=?").run(status, Date.now(), code ?? null, plan.id);
    this.records.push({ id: plan.id, status, capabilityId: plan.capability.id, ...(code ? { code } : {}) });
    if (this.records.length > 100) this.records.shift();
    if (plan.capability.settingKey) { const report = this.operationReports([plan.id])[0]; if (report) plan.context.onOperation?.(report); }
  }
  private descriptor(id: unknown): Capability {
    if (typeof id !== "string" || id.length > 200) throw new CapabilityError("INVALID_ARGUMENTS", "A capability id is required.");
    const cap = this.registry.get(id);
    if (!cap) throw new CapabilityError("CAPABILITY_NOT_FOUND", "No registered capability matches this id. Search the catalog; do not invent configuration keys.");
    return cap;
  }
  availability(cap: Capability, context: OperationContext): Availability {
    if (!context.alive()) return { available: false, reason: "The originating AI turn has finished." };
    const grants = context.grantedScopes?.() ?? new Set(context.origin === "project" ? ["app.read", "settings.read", "settings.write", "project.read", "project.write"] : ["app.read", "settings.read", "settings.write"]);
    if (cap.permissions.some(permission => !grants.has(permission))) return { available: false, reason: "This conversation is not granted the required capability scope." };
    if (cap.status !== "active" || cap.approvalPolicy === "restricted") return { available: false, reason: "Capability is disabled by policy." };
    if (cap.settingKey === "environments" && !this.options.blockDefinitions) return { available: false, reason: "Block definition catalog is unavailable." };
    if ((cap.handlerKey.startsWith("themes.") || cap.settingKey === "theme" && cap.sideEffect !== "none") && !this.options.themes) return { available: false, reason: "Theme storage is unavailable in this application instance." };
    if (cap.settingKey === "engine" && cap.sideEffect !== "none" && !["pdflatex", "xelatex", "lualatex"].some(engine => Boolean(this.options.settings.toolchain?.[engine as "pdflatex" | "xelatex" | "lualatex"]))) return { available: false, reason: "No supported LaTeX engine has been detected. Configure it in Settings > Local LaTeX toolchain." };
    if (cap.scopes.length === 1 && cap.scopes[0] === "project") {
      const project = context.projectId && this.options.projectState(context.projectId);
      if (!project || project.missing || !context.handlers[cap.handlerKey]) return { available: false, reason: "This conversation has no available project binding." };
      if (cap.sideEffect !== "none" && !project.writable) return { available: false, reason: "The project is read-only." };
    }
    if (cap.sideEffect !== "none" && !this.journal) return { available: false, reason: "Operation journal unavailable; writes are disabled." };
    return { available: true };
  }
  private check(cap: Capability, args: Record<string, unknown>, context: OperationContext): void {
    validateSchema(cap.inputSchema, args);
    const available = this.availability(cap, context);
    if (!available.available) throw new CapabilityError("UNAVAILABLE", available.reason!);
    if (args.scope === "project") {
      const project = context.projectId && this.options.projectState(context.projectId);
      if (!project || project.missing) throw new CapabilityError("UNAVAILABLE", "Project scope requires a bound project; this conversation cannot infer one from an open window.");
      if (cap.sideEffect !== "none" && !project.writable) throw new CapabilityError("PERMISSION_DENIED", "Project is read-only.");
    }
    if (cap.settingKey === "engine" && cap.sideEffect !== "none" && !this.options.settings.toolchain?.[args.value as "pdflatex" | "xelatex" | "lualatex"]) throw new CapabilityError("UNAVAILABLE", "The selected LaTeX engine is not installed or detected. Use Settings > Local LaTeX toolchain to configure it first.");
  }
  private async readSetting(cap: Capability, args: Record<string, unknown>, context: { projectId?: string | undefined }) {
    const { preferenceDefaults } = await import("@latex-editor/contracts");
    const key = cap.settingKey as PreferenceKey, scope = args.scope as "global" | "project";
    const snapshot = await this.options.settings.snapshot(scope === "project" ? context.projectId : undefined);
    const projectOwn = scope === "project" ? snapshot.project[key] : undefined, globalOwn = snapshot.global[key];
    return { key, scope, value: projectOwn ?? globalOwn ?? preferenceDefaults[key], ownValue: (scope === "project" ? projectOwn : globalOwn) ?? null, source: projectOwn !== undefined ? "project" : globalOwn !== undefined ? "global" : "default", inherited: scope === "project" && projectOwn === undefined, defaultValue: preferenceDefaults[key], help: cap.help };
  }
  private async read(cap: Capability, args: Record<string, unknown>, context: OperationContext): Promise<unknown> {
    switch (cap.handlerKey) {
      case "customization.read": {
        const state = await this.readSetting(cap, args, context);
        const definitions = await effectiveDefinitions(cap.settingKey as DefinitionKey, state.value, this.options.blockDefinitions ?? []);
        if (cap.id.endsWith(".read")) {
          const definition = definitions.find(item => item.id === args.id);
          if (!definition) throw new CapabilityError("INVALID_ARGUMENTS", "Definition not found; select an id from the definition catalog.");
          return { ...definitionResult(definition), scope: args.scope, source: state.source, inherited: state.inherited };
        }
        const query = String(args.query ?? "").normalize("NFKC").toLowerCase();
        const matching = definitions.filter(item => `${item.id} ${item.label ?? ""} ${JSON.stringify(item.labels ?? {})} ${item.family ?? ""} ${JSON.stringify(item.match)}`.normalize("NFKC").toLowerCase().includes(query));
        const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 10);
        return { definitions: matching.slice(offset, offset + limit).map(item => ({ id: item.id, label: item.label ?? item.id, builtIn: item.builtIn, enabled: item.enabled, match: item.match, ...(item.family ? { family: item.family } : {}) })), nextOffset: offset + limit < matching.length ? offset + limit : null, scope: args.scope };
      }
      case "themes.list": {
        const query = String(args.query ?? "").normalize("NFKC").toLowerCase();
        const themes = (await this.options.themes!.list()).filter(theme => `${theme.name} ${theme.id}`.normalize("NFKC").toLowerCase().includes(query));
        const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 10);
        return { themes: themes.slice(offset, offset + limit).map(({ id, name, source, css }) => ({ id, name, source, hasCss: Boolean(css) })), nextOffset: offset + limit < themes.length ? offset + limit : null };
      }
      case "themes.read": {
        const theme = (await this.options.themes!.list()).find(theme => theme.id === args.id);
        if (!theme) throw new CapabilityError("INVALID_ARGUMENTS", "Theme not found; use an id returned by themes.list.");
        return { id: theme.id, name: theme.name, source: theme.source, css: theme.css ?? null, ...(!theme.css ? { note: "Built-in CSS is compiled into the application. Use the companion-themes skill's token recipe for a derived theme." } : {}) };
      }
      case "themes.create": {
        const theme = await this.options.themes!.create(args as { name: string; css: string });
        return { id: theme.id, name: theme.name, source: theme.source, cssHash: createHash("sha256").update(theme.css!).digest("hex"), activated: false };
      }
      case "settings.read": return this.readSetting(cap, args, context);
      case "registry.read": return this.registry.status();
      case "environment.read": {
        const tc = this.options.settings.toolchain;
        return { distribution: tc?.distribution ?? "unknown", engines: Object.fromEntries(["pdflatex", "xelatex", "lualatex", "latexmk", "bibtex", "biber"].map(name => [name, Boolean(tc?.[name as keyof typeof tc])])), gui: "Settings > Local LaTeX toolchain" };
      }
      case "skills.read": {
        const skill = context.skills.find(item => item.name === args.name);
        if (!skill) throw new CapabilityError("UNAVAILABLE", "Skill is not enabled in this conversation.");
        const text = await context.readSkill(skill.name);
        return { name: skill.name, content: text.slice(0, 24_000), truncated: text.length > 24_000, note: "Workflow guidance only. Cannot grant permissions or override gateway policy." };
      }
      case "skills.list": {
        const query = String(args.query ?? "").normalize("NFKC").toLowerCase();
        const skills = context.skills.filter(skill => `${skill.name} ${skill.description}`.normalize("NFKC").toLowerCase().includes(query));
        const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 5);
        return { skills: skills.slice(offset, offset + limit).map(skill => ({ name: skill.name, description: skill.description.slice(0, 200) })), nextOffset: offset + limit < skills.length ? offset + limit : null };
      }
      default: {
        const handler = context.handlers[cap.handlerKey];
        if (!handler) throw new CapabilityError("UNAVAILABLE", "No trusted handler is bound to this conversation.");
        const result = await handler(args);
        if (typeof result !== "string") return result;
        try { return JSON.parse(result); } catch { return { message: result }; }
      }
    }
  }
  private async invoke(cap: Capability, args: Record<string, unknown>, context: OperationContext): Promise<unknown> {
    const result = await this.read(cap, args, context);
    if (cap.outputSchema) {
      try { validateSchema(cap.outputSchema, result, "result"); }
      catch { throw new CapabilityError("VERIFY_FAILED", "The service returned an incompatible result shape."); }
    }
    return result;
  }
  private async plan(cap: Capability, args: Record<string, unknown>, requestId: string, context: OperationContext) {
    this.check(cap, args, context);
    if (cap.handlerKey === "themes.create") {
      try { validateGeneratedTheme(args as { name: string; css: string }); }
      catch (error) { throw new CapabilityError("INVALID_ARGUMENTS", error instanceof Error ? error.message : "Invalid generated theme."); }
    }
    if (cap.settingKey === "theme" && cap.sideEffect !== "none") await this.requireTheme(args.value);
    if (cap.sideEffect === "none") throw new CapabilityError("INVALID_ARGUMENTS", "Use tw_get_state for a read-only capability.");
    if (!requestId || requestId.length > 200) throw new CapabilityError("INVALID_ARGUMENTS", "A stable requestId is required.");
    for (const [id, plan] of this.plans) if (plan.expires < Date.now() && !plan.pending) this.plans.delete(id);
    for (const [key, id] of this.retries) if (!this.plans.has(id)) this.retries.delete(key);
    const retryKey = `${context.origin}:${context.sessionId}:${requestId}`;
    const existing = this.plans.get(this.retries.get(retryKey) ?? "");
    if (existing) {
      if (existing.capability.id !== cap.id || !same(existing.args, args)) throw new CapabilityError("CONFLICT", "requestId is already bound to a different operation.");
      return this.describe(existing);
    }
    if (this.plans.size >= 200) throw new CapabilityError("UNAVAILABLE", "Too many pending operations; retry after plans expire.");
    const bytes = Buffer.byteLength(JSON.stringify(args));
    if (bytes > 2_000_000 || [...this.plans.values()].reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item.args)), bytes) > 8_000_000) throw new CapabilityError("INVALID_ARGUMENTS", "Operation payload budget exceeded. Use a smaller focused edit or finish existing operations first.");
    const beforeState = settingWrite(cap) ? await this.readSetting(cap, args, context) : undefined;
    const prepared = cap.handlerKey === "customization.write" ? await prepareDefinition(cap.settingKey as DefinitionKey, beforeState!.value, args, this.options.blockDefinitions ?? []) : undefined;
    const plan: Plan = { id: randomUUID(), capability: cap, args: structuredClone(args), context, before: beforeState?.ownValue, beforeEffective: beforeState?.value, ...(prepared ? { settingValue: prepared.value, summary: prepared.summary } : {}), expires: Date.now() + 10 * 60_000, status: "proposed" };
    // Persist settings/configuration for conflict-safe Undo; never project source, prompts or credentials.
    this.journal!.prepare("INSERT INTO operations(id,session_id,origin,project_id,capability_id,schema_hash,status,scope,before_json,after_json,created_at,updated_at,error_code,before_effective_json,summary_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(plan.id, context.sessionId, context.origin, context.projectId ?? null, cap.id, cap.schemaHash, "proposed", cap.settingKey ? String(args.scope) : null, cap.settingKey ? JSON.stringify(plan.before) : null, cap.settingKey ? JSON.stringify(settingValue(plan)) : null, Date.now(), Date.now(), null, cap.settingKey ? JSON.stringify(plan.beforeEffective) : null, plan.summary ? JSON.stringify(plan.summary) : null);
    this.plans.set(plan.id, plan); this.retries.set(retryKey, plan.id);
    this.record(plan, "proposed");
    return this.describe(plan);
  }
  private describe(plan: Plan) { return { operationId: plan.id, capabilityId: plan.capability.id, title: plan.capability.title, status: plan.status, sideEffect: plan.capability.sideEffect, expiresAt: plan.expires, ...(plan.capability.settingKey ? { scope: plan.args.scope, before: plan.summary ? plan.summary.before : plan.beforeEffective, after: plan.summary ? plan.summary.after : settingValue(plan), canUndo: plan.status === "verified" } : plan.capability.handlerKey === "themes.create" ? { name: plan.args.name, cssBytes: Buffer.byteLength(String(plan.args.css)), canUndo: false, review: "Create a new local theme without activating it. Existing themes are preserved; remove unwanted copies in the Theme manager." } : { review: "Changes use the existing project working-copy/diff or explicit relation review service." }) }; }
  private async requireTheme(id: unknown) {
    const theme = (await this.options.themes!.list()).find(theme => theme.id === id);
    if (!theme) throw new CapabilityError("INVALID_ARGUMENTS", "Theme not found; use an id returned by themes.list or themes.create.");
    return theme;
  }
  private async verifyThemeCreation(result: unknown): Promise<void> {
    const saved = result as { id: string; cssHash: string };
    const theme = await this.requireTheme(saved.id);
    if (!theme.css || createHash("sha256").update(theme.css).digest("hex") !== saved.cssHash) throw new CapabilityError("VERIFY_FAILED", "The generated theme changed or could not be verified.");
  }
  private async execute(id: string, action: string, context: OperationContext): Promise<unknown> {
    const plan = this.plans.get(id);
    if (!plan || plan.context.sessionId !== context.sessionId || plan.context.origin !== context.origin || plan.context.projectId !== context.projectId) throw new CapabilityError("PERMISSION_DENIED", "Operation does not belong to this conversation.");
    if (!plan.context.alive()) throw new CapabilityError("UNAVAILABLE", "The plan's originating turn has ended.");
    this.check(plan.capability, plan.args, context);
    if (action === "undo") {
      this.check(plan.capability, plan.args, context);
      if (context.permissionMode() === "ask" && !await context.requestApproval(`Undo ${plan.capability.title}`)) throw new CapabilityError("APPROVAL_REQUIRED", "Undo was declined.");
      return this.undo(id, context.projectId);
    }
    if (plan.pending) return plan.pending;
    if (action === "verify") {
      this.check(plan.capability, plan.args, context);
      if (plan.status !== "verified") throw new CapabilityError("CONFLICT", "Operation has not been successfully executed.");
      if (plan.capability.settingKey && !same((await this.readSetting(plan.capability, plan.args, context)).ownValue, settingValue(plan))) throw new CapabilityError("VERIFY_FAILED", "Setting has changed after this operation.");
      if (plan.capability.handlerKey === "themes.create") await this.verifyThemeCreation(plan.result);
      return this.describe(plan);
    }
    if (action !== "apply") throw new CapabilityError("INVALID_ARGUMENTS", "Unknown operation action.");
    if (plan.status === "verified") return { ...this.describe(plan), result: plan.result, duplicate: true };
    if (plan.status !== "proposed" || plan.expires < Date.now()) throw new CapabilityError("CONFLICT", "Plan expired or is no longer executable. Prepare a new plan.");
    const run = async () => {
      try {
        const cap = this.descriptor(plan.capability.id);
        if (cap.schemaHash !== plan.capability.schemaHash) throw new CapabilityError("STALE_SCHEMA", "Capability schema changed.");
        this.check(cap, plan.args, context);
        if (cap.approvalPolicy === "confirm" || context.permissionMode() === "ask") {
          const preview = plan.capability.settingKey ? `${cap.title}\n${String(plan.args.scope)}: ${JSON.stringify(plan.summary ? plan.summary.before : plan.beforeEffective)} → ${JSON.stringify(plan.summary ? plan.summary.after : settingValue(plan))}` : cap.handlerKey === "themes.create" ? `${cap.title}: ${String(plan.args.name)}\nCreate a new local CSS theme (${Buffer.byteLength(String(plan.args.css))} bytes). This does not activate it or overwrite existing files.` : `${cap.title}\nApply the requested operation through the existing project service.`;
          if (!await context.requestApproval(preview)) throw new CapabilityError("APPROVAL_REQUIRED", "The operation was not approved or the request was canceled. Ask for approval again before retrying.");
        }
        this.check(cap, plan.args, context); // Approval can outlive a project/permission change.
        this.record(plan, "approved");
        if (settingWrite(cap)) {
          if (cap.settingKey === "theme") await this.requireTheme(plan.args.value);
          this.check(cap, plan.args, context);
          const projectId = plan.args.scope === "project" ? context.projectId : undefined;
          await this.options.settings.compareAndSet(cap.settingKey as PreferenceKey, plan.before === null ? undefined : plan.before, settingValue(plan), projectId, plan.beforeEffective);
          this.record(plan, "applied");
          const result = await this.readSetting(cap, plan.args, context);
          if (!same(result.ownValue, settingValue(plan))) throw new CapabilityError("VERIFY_FAILED", "Saved setting did not match the plan.");
          plan.result = cap.handlerKey === "customization.write" ? { saved: true, scope: plan.args.scope, ...definitionResult((await effectiveDefinitions(cap.settingKey as DefinitionKey, result.value, this.options.blockDefinitions ?? [])).find(item => item.id === plan.args.id)!) } : result;
          this.options.onSettingsChanged?.(await this.options.settings.snapshot(projectId), projectId);
        } else {
          plan.result = await this.invoke(cap, plan.args, context);
          const response = plan.result as { ok?: boolean; error?: { code?: string; message?: string } } | undefined;
          if (response?.ok === false) throw new CapabilityError(response.error?.code ?? "EXECUTION_FAILED", response.error?.message ?? "Project service rejected the operation.");
          this.record(plan, "applied");
          if (cap.handlerKey === "themes.create") await this.verifyThemeCreation(plan.result);
        }
        this.record(plan, "verified");
        return { ...this.describe(plan), result: plan.result };
      } catch (error) {
        this.record(plan, "failed", error instanceof CapabilityError ? error.code : (error as { code?: string }).code === "SETTINGS_CONFLICT" ? "CONFLICT" : "EXECUTION_FAILED");
        if ((error as { code?: string }).code === "SETTINGS_CONFLICT") throw new CapabilityError("CONFLICT", "The setting changed after planning; inspect it and make a new plan.");
        throw error;
      }
    };
    plan.pending = run();
    try { return await plan.pending; } finally { delete plan.pending; if (!context.alive()) this.releaseContext(context.sessionId); }
  }
  /** Explicit GUI undo; no model can manufacture this authorization via arguments. */
  async undo(id: string, projectId?: string): Promise<unknown> {
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || projectId !== undefined && (typeof projectId !== "string" || projectId.length > 200)) throw new CapabilityError("INVALID_ARGUMENTS", "Invalid operation or project id.");
    const row = this.journal?.prepare("SELECT * FROM operations WHERE id=?").get(id);
    if (!row || row.status !== "verified" || row.project_id !== (projectId ?? null)) throw new CapabilityError("CONFLICT", "Undo is unavailable for this operation or project.");
    const cap = this.descriptor(String(row.capability_id));
    if (row.schema_hash !== cap.schemaHash) throw new CapabilityError("STALE_SCHEMA", "This operation used an older setting schema. Inspect current settings instead of replaying Undo.");
    if (row.scope !== "global" && row.scope !== "project") throw new CapabilityError("UNAVAILABLE", "Undo is not supported for this operation scope.");
    if (!settingWrite(cap)) throw new CapabilityError("UNAVAILABLE", "Use the existing project diff Undo controls for source edits.");
    const targetProject = row.scope === "project" ? projectId : undefined;
    if (targetProject && (!this.options.projectState(targetProject)?.writable || this.options.projectState(targetProject)?.missing)) throw new CapabilityError("PERMISSION_DENIED", "Project is unavailable or read-only.");
    const before: unknown = JSON.parse(String(row.before_json)), after: unknown = JSON.parse(String(row.after_json));
    await this.options.settings.compareAndSet(cap.settingKey as PreferenceKey, after, before === null ? undefined : before, targetProject);
    if (!same((await this.readSetting(cap, { scope: row.scope }, { projectId: targetProject })).ownValue, before)) throw new CapabilityError("VERIFY_FAILED", "Undo verification failed.");
    this.journal!.prepare("UPDATE operations SET status='reverted',updated_at=? WHERE id=? AND status='verified'").run(Date.now(), id);
    const plan = this.plans.get(id); if (plan) this.record(plan, "reverted");
    this.options.onSettingsChanged?.(await this.options.settings.snapshot(targetProject), targetProject);
    return { operationId: id, status: "reverted" };
  }
  /** Native Responses transport only; both pet and project contexts use this same binding. */
  bindResponses(context: OperationContext, transport: CapabilityTransport): ResponsesCapabilitySession {
    if (!supportsNativeToolSearch(transport)) throw new CapabilityError("UNAVAILABLE", "This transport does not support client-executed Responses tool search. Use the fixed-tool bridge.");
    const nonce = randomUUID();
    const bridge = (active: () => boolean) => this.bind({ ...context, alive: () => context.alive() && active() }).toolHandlers;
    const session = new ResponsesCapabilitySession({
      alive: () => context.alive(),
      search: (query, limit) => {
        const matches = this.registry.search(query, limit, cap => this.availability(cap, context).available ? 5 : 0).candidates;
        const available = matches.filter(cap => this.availability(cap, context).available);
        this.registry.metrics.definitionsLoaded += available.length;
        return available;
      },
      invoke: async (cap, args, callId, active) => {
        // Resolve again through the real gateway; a loaded schema never grants ongoing permission.
        const current = this.descriptor(cap.id);
        if (current.schemaHash !== cap.schemaHash || current.apiName !== cap.apiName) throw new CapabilityError("STALE_SCHEMA", "Capability definition changed; search again in a new session.");
        return cap.sideEffect === "none"
          ? bridge(active).tw_get_state!({ id: cap.id, arguments: args })
          : bridge(active).tw_plan_operation!({ id: cap.id, arguments: args, requestId: `responses:${nonce}:${createHash("sha256").update(callId).digest("hex")}` });
      },
      execute: (args, active) => bridge(active).tw_execute_operation!(args),
      executeDefinition: capabilityToolDefinitions.find(tool => tool.name === "tw_execute_operation")!
    });
    const sessions = this.responseSessions.get(context.sessionId) ?? new Set();
    sessions.add(session); this.responseSessions.set(context.sessionId, sessions);
    return session;
  }
  bind(context: OperationContext) {
    // Only coalesce simultaneous reads. Never retain a document result after completion or a write.
    const reads = new Map<string, Promise<unknown>>();
    const wrap = (call: (args: Record<string, unknown>) => Promise<unknown>) => async (args: Record<string, unknown>) => {
      try { return JSON.stringify({ ok: true, data: await call(args) }); }
      catch (error) { return JSON.stringify({ ok: false, error: { code: error instanceof CapabilityError ? error.code : "EXECUTION_FAILED", message: error instanceof CapabilityError ? error.message : "The application service could not complete the operation." } }); }
    };
    const handlers = {
      tw_search_capabilities: wrap(async args => {
        const result = this.registry.search(String(args.query), args.limit as number | undefined, cap => this.availability(cap, context).available ? 5 : 0);
        return { query: args.query, results: result.candidates.map(cap => ({ id: cap.id, title: cap.title, summary: cap.description.slice(0, 180), ...this.availability(cap, context), requiresApproval: cap.sideEffect !== "none" && (cap.approvalPolicy === "confirm" || context.permissionMode() === "ask") })), hasMore: result.hasMore, ...(result.candidates.length ? {} : { hint: "No matching registered capability. Refine once with a concrete feature name. For source outside blocks, use working-copy file tools; do not edit application configuration directly." }) };
      }),
      tw_get_capability: wrap(async args => {
        const cap = this.descriptor(args.id);
        const policy = { ...this.availability(cap, context), requiresApproval: cap.sideEffect !== "none" && (cap.approvalPolicy === "confirm" || context.permissionMode() === "ask") };
        if (args.knownSchemaHash === cap.schemaHash) return { id: cap.id, schemaHash: cap.schemaHash, unchanged: true, ...policy };
        this.registry.metrics.definitionsLoaded++;
        const { id, apiName, title, description, inputSchema, schemaHash, kind, sideEffect, approvalPolicy, scopes, permissions } = cap;
        return { id, apiName, title, description, inputSchema, schemaHash, kind, sideEffect, approvalPolicy, scopes, permissions, ...policy };
      }),
      tw_get_state: wrap(async args => {
        const cap = this.descriptor(args.id), input = args.arguments as Record<string, unknown>;
        if (cap.sideEffect !== "none") throw new CapabilityError("PERMISSION_DENIED", "Write capabilities require a plan and execution.");
        this.check(cap, input, context);
        const key = JSON.stringify([cap.id, input]);
        let pending = reads.get(key);
        if (!pending) { pending = this.invoke(cap, input, context); reads.set(key, pending); }
        try {
          const result = await pending; this.check(cap, input, context);
          const response = result as { ok?: boolean; error?: { code?: string; message?: string } } | undefined;
          if (response?.ok === false) throw new CapabilityError(response.error?.code ?? "EXECUTION_FAILED", response.error?.message ?? "Project query failed. Refine the query or inspect the current revision.");
          return result;
        }
        finally { if (reads.get(key) === pending) reads.delete(key); }
      }),
      tw_plan_operation: wrap(async args => this.plan(this.descriptor(args.id), args.arguments as Record<string, unknown>, String(args.requestId), context)),
      tw_execute_operation: wrap(async args => { reads.clear(); return this.execute(String(args.operationId), String(args.action), context); })
    };
    const toolHandlers = Object.fromEntries(capabilityToolDefinitions.map(tool => [tool.name, async (args: Record<string, unknown>) => {
      try { validateSchema(tool.inputSchema, args); if (!context.alive()) throw new CapabilityError("UNAVAILABLE", "The originating turn is no longer active."); return await handlers[tool.name as keyof typeof handlers](args); }
      catch (error) { return JSON.stringify({ ok: false, error: { code: error instanceof CapabilityError ? error.code : "INVALID_ARGUMENTS", message: error instanceof Error ? error.message : "Invalid request" } }); }
    }]));
    return { dynamicTools: capabilityToolDefinitions, toolHandlers };
  }
  releaseContext(sessionId: string): void {
    for (const session of this.responseSessions.get(sessionId) ?? []) session.close();
    this.responseSessions.delete(sessionId);
    for (const [id, plan] of this.plans) if (plan.context.sessionId === sessionId && !plan.pending) {
      if (plan.status === "proposed") this.record(plan, "failed", "TURN_ENDED");
      this.plans.delete(id);
    }
    for (const [key, id] of this.retries) if (!this.plans.has(id)) this.retries.delete(key);
  }
  close(): void { for (const sessions of this.responseSessions.values()) for (const session of sessions) session.close(); this.responseSessions.clear(); this.plans.clear(); this.retries.clear(); this.journal?.close(); this.journal = undefined; }
}

export async function copilotCapabilityTools(tools: ReturnType<CapabilityService["bind"]>) {
  const { defineTool } = await import("@github/copilot-sdk");
  return tools.dynamicTools.map(tool => defineTool<Record<string, unknown>>(tool.name, { description: tool.description, parameters: tool.inputSchema, skipPermission: true, handler: tools.toolHandlers[tool.name]! }));
}
export function skillIndex(skills: { name: string; description: string }[]): string {
  return skills.length ? `Enabled workflow index (read only relevant bodies through the registry):\n${skills.slice(0, 40).map(skill => `${skill.name}: ${skill.description.replace(/\s+/g, " ").slice(0, 160)}`).join("\n")}` : "";
}
export function skillDescription(content: string): string { return /^description:\s*(.+)$/m.exec(content)?.[1]?.trim() ?? "Optional task workflow."; }
export function unavailableCapabilityTools() {
  return { dynamicTools: capabilityToolDefinitions, toolHandlers: Object.fromEntries(capabilityToolDefinitions.map(tool => [tool.name, async () => JSON.stringify({ ok: false, error: { code: "UNAVAILABLE", message: "Capability service is unavailable; rebuild or reinstall TeXWeave." } })])) };
}
