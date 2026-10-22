import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIMessage } from "@latex-editor/contracts";
import { closeTestCapabilities, testCapabilities } from "../capability-fixture.js";
import { createWorkspaceBlockApi } from "../../apps/desktop/src/main/ai/workspace-block-api.js";
import { createBlockTools } from "../../apps/desktop/src/main/ai/block-tools.js";
import { contextEfficiencyPolicy, restoredConversationHistory } from "../../apps/desktop/src/main/ai/context-policy.js";
import { capabilityWorkflow } from "../../apps/desktop/src/main/capabilities/gateway.js";
import { capabilityManifest } from "../../apps/desktop/src/main/capabilities/manifest.js";
import { responsesCapabilityWorkflow } from "../../apps/desktop/src/main/capabilities/responses.js";
import type { OperationContext } from "../../apps/desktop/src/main/capabilities/types.js";

const roots: string[] = [];
afterEach(async () => { closeTestCapabilities(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "texweave-context-efficiency-")); roots.push(root);
  const f = await testCapabilities(root);
  const context: OperationContext = { sessionId: "test", origin: "pet", alive: () => true, permissionMode: () => "auto", requestApproval: async () => true, handlers: {}, skills: [{ name: "guide", description: "Workflow" }], readSkill: async () => "body" };
  const bridge = f.service.bind(context).toolHandlers;
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse(await bridge[name]!(args));
  return { ...f, root, context, call };
}

describe("Bounded AI context and queries", () => {
  it("paginates actual block results without missing IDs, preserving the GUI default", async () => {
    const f = await fixture();
    const title = "Long heading ".repeat(50);
    await writeFile(join(f.root, "main.tex"), `\\section{${title}}\n\n` + Array.from({ length: 37 }, (_, i) => `Paragraph ${i}.`).join("\n\n"));
    const api = await createWorkspaceBlockApi({ id: "p", name: "Test", canonicalPath: f.root, writable: true, missing: false, createdAt: "", registeredAt: "" }, f.root);
    const handlers = createBlockTools(api).toolHandlers;
    const call = async (name: string, args: Record<string, unknown>) => JSON.parse(await handlers[name]!(args));
    const all = await api.find_blocks({ type: "paragraph", limit: 100 });
    if (!all.ok) throw new Error(all.error.message);
    expect(all.data).toHaveLength(37);
    const ids: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await call("find_blocks", { type: "paragraph", offset });
      expect(page.data.length).toBeLessThanOrEqual(10);
      ids.push(...page.data.map((card: { id: string }) => card.id)); offset = page.page.nextOffset;
    }
    expect(ids).toEqual(all.data.map(card => card.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect((await api.list_blocks({ offset: -1 })).ok).toBe(false);
    const first = await call("list_blocks", { parentId: null });
    const heading = first.data.find((card: { type: string }) => card.type === "section");
    expect(heading.abbreviatedFields).toContain("title");
    const compact = await call("get_block", { blockId: heading.id });
    expect(compact.data.children).toHaveLength(10); expect(compact.data.childrenPage.nextOffset).toBe(10);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(await api.get_block({ blockId: heading.id })).length * 0.6);
    const full = await call("get_block", { blockId: heading.id, detail: "full", childOffset: 30 });
    expect(full.data.title).toBe(title);
    expect(full.data.children).toHaveLength(7); expect(full.data.childrenPage.nextOffset).toBeNull();
    const source = await call("get_block_source", { blockId: ids[0] });
    const exact = await api.get_block_source({ blockId: ids[0]! });
    if (!exact.ok) throw new Error(exact.error.message);
    expect(source.data.content).toBe(exact.data.content);
    expect((await readFile(join(f.root, "main.tex"), "utf8"))).toContain(title);
  });
  it("returns only public capability fields and conditionally reuses known schemas with fresh availability", async () => {
    const f = await fixture();
    const first = await f.call("tw_get_capability", { id: "settings.fontSize.set" });
    expect(first.data.inputSchema.properties.value).toEqual({ type: "integer", minimum: 10, maximum: 32 });
    for (const key of ["aliases", "handlerKey", "outputSchema", "sinceVersion"]) expect(first.data).not.toHaveProperty(key);
    const definitions = f.registry.metrics.definitionsLoaded;
    f.context.grantedScopes = () => new Set(["app.read"]);
    const same = await f.call("tw_get_capability", { id: first.data.id, knownSchemaHash: first.data.schemaHash });
    expect(same.data).toMatchObject({ unchanged: true, available: false });
    expect(same.data).not.toHaveProperty("inputSchema"); expect(f.registry.metrics.definitionsLoaded).toBe(definitions);
    expect(JSON.stringify(same).length).toBeLessThan(JSON.stringify(first).length);
  });
  it("coalesces simultaneous reads but fetches fresh results on later requests", async () => {
    const f = await fixture(); let release!: (text: string) => void;
    const read = vi.fn(() => new Promise<string>(resolve => { release = resolve; })); f.context.readSkill = read;
    const args = { id: "skills.read", arguments: { name: "guide" } };
    const a = f.call("tw_get_state", args), b = f.call("tw_get_state", args);
    expect(read).toHaveBeenCalledOnce(); release("first");
    const values = await Promise.all([a, b]); expect(values.map(value => value.data.content)).toEqual(["first", "first"]);
    const c = f.call("tw_get_state", args); expect(read).toHaveBeenCalledTimes(2); release("changed");
    expect((await c).data.content).toBe("changed");
  });
  it("rechecks permissions before publishing a coalesced result", async () => {
    const f = await fixture(); let release!: (text: string) => void;
    f.context.readSkill = () => new Promise(resolve => { release = resolve; });
    const pending = f.call("tw_get_state", { id: "skills.read", arguments: { name: "guide" } });
    f.context.grantedScopes = () => new Set(); release("private");
    const result = await pending; expect(result.error.code).toBe("UNAVAILABLE"); expect(result).not.toHaveProperty("data");
  });
  it("does not wrap a failed project query in a misleading successful envelope", async () => {
    const f = await fixture();
    const tools = f.service.bind({ ...f.context, origin: "project", projectId: "p", handlers: { "project.get_block": async () => ({ ok: false, error: { code: "BLOCK_NOT_FOUND", message: "Locate the current block first." } }) } }).toolHandlers;
    const result = JSON.parse(await tools.tw_get_state!({ id: "project.get_block", arguments: { blockId: "stale" } }));
    expect(result).toMatchObject({ ok: false, error: { code: "BLOCK_NOT_FOUND" } });
    expect(result).not.toHaveProperty("data");
  });
  it("invalidates in-flight reuse at writes without letting an older read remove a newer one", async () => {
    const f = await fixture(); const releases: Array<(text: string) => void> = [];
    const read = vi.fn(() => new Promise<string>(resolve => releases.push(resolve))); f.context.readSkill = read;
    const args = { id: "skills.read", arguments: { name: "guide" } };
    const before = f.call("tw_get_state", args);
    const plan = await f.call("tw_plan_operation", { id: "settings.fontSize.set", arguments: { scope: "global", value: 18 }, requestId: "write" });
    await f.call("tw_execute_operation", { operationId: plan.data.operationId, action: "apply" });
    const after = f.call("tw_get_state", args);
    releases[0]!("old"); await before;
    const duplicate = f.call("tw_get_state", args);
    expect(read).toHaveBeenCalledTimes(2); releases[1]!("new");
    expect((await Promise.all([after, duplicate])).map(result => result.data.content)).toEqual(["new", "new"]);
  });
  it("restores bounded, clearly marked excerpts only for a new session", () => {
    const messages: AIMessage[] = Array.from({ length: 20 }, (_, i) => ({ id: String(i), role: i % 2 ? "assistant" : "user", content: `message-${i}:` + "x".repeat(5000), createdAt: i }));
    const history = restoredConversationHistory(messages);
    expect(history.length).toBeLessThanOrEqual(12000); expect(history).toContain("message-19:"); expect(history).not.toContain("message-0:");
    expect(history).toContain("middle omitted"); expect(restoredConversationHistory([])).toBe("");
    const plain = restoredConversationHistory([{ id: "m", role: "user", content: "Keep the label as:exact unchanged.", createdAt: 1 }]);
    expect(plain).toBe("USER: Keep the label as:exact unchanged.");
  });
  it("shares non-polling and exact-edit guidance across both transports", () => {
    expect(capabilityWorkflow).toContain(contextEfficiencyPolicy);
    expect(responsesCapabilityWorkflow).toContain(contextEfficiencyPolicy);
    expect(contextEfficiencyPolicy).toContain("Never abbreviate text used as an exact edit precondition");
    expect(contextEfficiencyPolicy).toContain("Never run short polling loops");
  });
  it("keeps the resource catalog bounded when the old database is still in use", async () => {
    const f = await fixture();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(f.path);
    db.prepare("UPDATE registry_meta SET value='old-build' WHERE key='app_version'").run(); db.close();
    const { buildCapabilityRegistry, CapabilityRegistry } = await import("../../apps/desktop/src/main/capabilities/registry.js");
    await buildCapabilityRegistry(f.path, "0.7.0");
    const fresh = new CapabilityRegistry();
    try { await fresh.initialize(f.path); expect(fresh.status()).toMatchObject({ available: true, count: (await capabilityManifest()).length }); }
    finally { fresh.close(); }
    expect((await readdir(f.root)).filter(name => name.startsWith("capabilities.sqlite") && name.endsWith(".tmp"))).toHaveLength(0);
  });
});
