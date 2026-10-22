import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeTestCapabilities, testCapabilities } from "../capability-fixture.js";
import { capabilityManifest, digest } from "../../apps/desktop/src/main/capabilities/manifest.js";
import { buildCapabilityRegistry, validateManifest } from "../../apps/desktop/src/main/capabilities/registry.js";
import { CapabilityService, capabilityToolDefinitions } from "../../apps/desktop/src/main/capabilities/gateway.js";
import { validateSchema } from "../../apps/desktop/src/main/capabilities/schema.js";
import type { OperationContext } from "../../apps/desktop/src/main/capabilities/types.js";

const roots: string[] = [];
afterEach(async () => { closeTestCapabilities(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "texweave-capabilities-")); roots.push(root);
  const f = await testCapabilities(root);
  let live = true, mode: "auto" | "ask" = "auto";
  const requestApproval = vi.fn(async () => true);
  const context: OperationContext = { origin: "pet", sessionId: "session", alive: () => live, permissionMode: () => mode, requestApproval, handlers: {}, skills: [{ name: "guide", description: "Short guide" }], readSkill: async name => `BODY_${name}` };
  const tools = f.service.bind(context).toolHandlers;
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse(await tools[name]!(args));
  const plan = async (id = "settings.fontSize.set", value: unknown = 18, scope = "global", requestId = crypto.randomUUID()) => call("tw_plan_operation", { id, arguments: { scope, value }, requestId });
  return { ...f, root, context, call, plan, requestApproval, stop: () => { live = false; }, ask: () => { mode = "ask"; } };
}

describe("Capability Registry discovery", () => {
  it("builds a read-only, versioned catalog with real schemas and only five native tools", async () => {
    const f = await fixture();
    expect(f.registry.status()).toMatchObject({ available: true, count: (await capabilityManifest()).length });
    expect(capabilityToolDefinitions).toHaveLength(5);
    const search = await f.call("tw_search_capabilities", { query: "fontSize" });
    expect(search.ok).toBe(true);
    expect(search.data.results).toEqual(expect.arrayContaining([expect.objectContaining({ id: "settings.fontSize.set" })]));
    expect(JSON.stringify(search)).not.toContain("inputSchema");
    expect((await f.call("tw_get_capability", { id: "settings.fontSize.set" })).data.inputSchema.properties.value).toEqual({ type: "integer", minimum: 10, maximum: 32 });
    expect((await f.call("tw_get_state", { id: "skills.read", arguments: { name: "guide" } })).data.content).toBe("BODY_guide");
    expect((await f.call("tw_get_state", { id: "skills.read", arguments: { name: "disabled" } })).error.code).toBe("UNAVAILABLE");
  });
  it.each(["编译引擎", "コンパイラ", "xelatex", "tw_settings_engine_set", "settings.engine.set", "字号", "文字サイズ"])('finds real capabilities for "%s"', async query => {
    const f = await fixture();
    const result = f.registry.search(query);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.some(cap => cap.settingKey === (query === "字号" || query === "文字サイズ" ? "fontSize" : "engine"))).toBe(true);
  });
  it("handles short CJK, unknown operations and SQL metacharacters without inventing APIs", async () => {
    const f = await fixture();
    expect(f.registry.search("字号").candidates[0]?.settingKey).toBe("fontSize");
    expect(f.registry.search("nonexistentfrobnicator").candidates).toEqual([]);
    expect((await f.call("tw_get_capability", { id: "__proto__.eval" })).error.code).toBe("CAPABILITY_NOT_FOUND");
    expect(() => f.registry.search("' OR 1=1; DROP TABLE capabilities --")).not.toThrow();
    expect(f.registry.status().count).toBe((await capabilityManifest()).length);
  });
  it("rejects invalid schemas, duplicate ids and handlers not compiled into the application", async () => {
    const manifest = await capabilityManifest();
    expect(() => validateManifest([...manifest, manifest[0]!])).toThrow();
    expect(() => validateManifest([{ ...manifest[0]!, handlerKey: "arbitrary.module" }])).toThrow();
    expect(() => validateManifest([{ ...manifest[0]!, inputSchema: { type: "object", unknown: true }, schemaHash: digest({ type: "object", unknown: true }) }])).toThrow();
    expect(() => validateSchema({ type: "object", properties: {}, additionalProperties: false }, JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow();
  });
  it("falls back to bounded search without FTS and disables writes for a corrupt or stale catalog", async () => {
    const f = await fixture(); f.registry.close();
    const db = new DatabaseSync(f.path);
    db.exec("DROP TABLE capability_fts_trigram; DROP TABLE capability_fts_words"); db.close();
    await f.registry.initialize(f.path);
    expect(f.registry.status()).toMatchObject({ available: true, search: "bounded-scan-and-aliases" });
    expect(f.registry.search("字体大小").candidates.length).toBeGreaterThan(0);
    f.registry.close();
    const damaged = new DatabaseSync(f.path); damaged.prepare("UPDATE capabilities SET descriptor_json=? WHERE id=?").run(JSON.stringify({ id: "settings.fontSize.set" }), "settings.fontSize.set"); damaged.close();
    await f.registry.initialize(f.path); expect(f.registry.status().available).toBe(false);
    await buildCapabilityRegistry(f.path, "0.7.0"); await f.registry.initialize(f.path); expect(f.registry.status().available).toBe(true);
    f.registry.close(); await writeFile(f.path, "corrupt"); await f.registry.initialize(f.path); expect(f.registry.status().available).toBe(false);
    // Other application services remain usable.
    await f.settings.set("fontSize", 16); expect((await f.settings.snapshot()).global.fontSize).toBe(16);
  });
});

describe("Trusted capability operations", () => {
  it("creates the bundled theme recipe, discovers compact metadata, activates it and undoes only activation", async () => {
    const f = await fixture();
    const skill = await readFile("resources/ai/companion/skills/companion-themes/SKILL.md", "utf8");
    const css = /```css\s*([\s\S]*?)```/.exec(skill)![1]!;
    const plan = await f.call("tw_plan_operation", { id: "themes.create", arguments: { name: "Calm recipe", css }, requestId: "theme" });
    expect(plan.ok).toBe(true);
    expect(await readdir(join(f.root, "themes"))).toEqual([]);
    const creation = await f.call("tw_execute_operation", { operationId: plan.data.operationId, action: "apply" });
    expect(creation.data.status).toBe("verified");
    expect(creation.data.canUndo).toBe(false);
    expect(creation.data.result).toMatchObject({ id: expect.stringMatching(/^custom-/), activated: false });
    const id = creation.data.result.id;
    expect(f.settings.global.theme).toBeUndefined();
    const metadata = await f.call("tw_get_state", { id: "themes.list", arguments: { query: "Calm" } });
    expect(metadata.data.themes).toEqual([{ id, name: "Calm recipe", source: "user", hasCss: true }]);
    expect(JSON.stringify(metadata)).not.toContain("--color-bg-panel");
    expect(JSON.stringify(metadata)).not.toContain(f.root);
    const theme = await f.call("tw_get_state", { id: "themes.read", arguments: { id } });
    expect(theme.data.css).toContain(css);
    expect((await f.call("tw_get_state", { id: "themes.read", arguments: { id: "dark" } })).data.css).toBeNull();
    const again = await f.call("tw_execute_operation", { operationId: plan.data.operationId, action: "apply" });
    expect(again.data.duplicate).toBe(true);
    expect(await readdir(join(f.root, "themes"))).toHaveLength(1);
    const setting = await f.plan("settings.theme.set", id);
    expect((await f.call("tw_execute_operation", { operationId: setting.data.operationId, action: "apply" })).data.status).toBe("verified");
    expect(f.settings.global.theme).toBe(id);
    await f.service.undo(setting.data.operationId);
    expect(f.settings.global.theme).toBeUndefined();
    expect((await f.themes.list()).some(theme => theme.id === id)).toBe(true);
    const file = (await f.themes.list()).find(theme => theme.id === id)!.filePath!;
    await writeFile(file, ":root{}changed");
    expect((await f.call("tw_execute_operation", { operationId: plan.data.operationId, action: "verify" })).error.code).toBe("VERIFY_FAILED");
  });
  it("rejects unsupported CSS and unknown theme ids before saving or changing settings", async () => {
    const f = await fixture();
    expect((await f.call("tw_get_state", { id: "themes.create", arguments: { name: "bad", css: ":root{}" } })).error.code).toBe("PERMISSION_DENIED");
    const invalid = await f.call("tw_plan_operation", { id: "themes.create", arguments: { name: "bad", css: '@import "remote.css";' }, requestId: "bad-theme" });
    expect(invalid.error.code).toBe("INVALID_ARGUMENTS");
    expect((await f.plan("settings.theme.set", "invented-theme")).error.code).toBe("INVALID_ARGUMENTS");
    expect((await f.plan("settings.theme.set", "light", "project")).ok).toBe(false);
    expect(await readdir(join(f.root, "themes"))).toEqual([]);
    expect(f.settings.global.theme).toBeUndefined();
  });
  it("rechecks theme access after approval and rejects activation if a generated file was removed", async () => {
    const f = await fixture(); f.ask();
    f.requestApproval.mockImplementation(async () => { f.context.grantedScopes = () => new Set(["app.read"]); return true; });
    const plan = await f.call("tw_plan_operation", { id: "themes.create", arguments: { name: "private", css: ":root{}" }, requestId: "permission" });
    expect((await f.call("tw_execute_operation", { operationId: plan.data.operationId, action: "apply" })).error.code).toBe("UNAVAILABLE");
    expect(await readdir(join(f.root, "themes"))).toEqual([]);
    delete f.context.grantedScopes;
    const theme = await f.themes.create({ name: "temporary", css: ":root{}" });
    const activation = await f.plan("settings.theme.set", theme.id);
    f.requestApproval.mockResolvedValue(true);
    await f.themes.remove(theme.id);
    expect((await f.call("tw_execute_operation", { operationId: activation.data.operationId, action: "apply" })).error.code).toBe("INVALID_ARGUMENTS");
    expect(f.settings.global.theme).toBeUndefined();
  });
  it("updates three real settings through the same settings schema and restores overrides after restart", async () => {
    const f = await fixture();
    const ids: string[] = [];
    for (const [key, value] of [["fontSize", 19], ["wordWrap", false], ["mathPreviewOnHover", false]] as const) {
      const plan = await f.plan(`settings.${key}.set`, value);
      expect((await f.call("tw_execute_operation", { operationId: plan.data.operationId, action: "apply" })).data.status).toBe("verified");
      ids.push(plan.data.operationId);
    }
    expect(f.settings.global).toMatchObject({ fontSize: 19, wordWrap: false, mathPreviewOnHover: false });
    f.service.close(); f.service.initialize();
    for (const id of ids) await f.service.undo(id);
    expect(f.settings.global).toEqual({});
  });
  it("rejects permission revocation while awaiting approval, without writing", async () => {
    const f = await fixture(); f.ask();
    f.requestApproval.mockImplementation(async () => { f.context.grantedScopes = () => new Set(["settings.read", "app.read"]); return true; });
    const plan = await f.plan();
    expect((await f.call("tw_execute_operation", { operationId: plan.data.operationId, action: "apply" })).error.code).toBe("UNAVAILABLE");
    expect(f.settings.global.fontSize).toBeUndefined();
  });
  it("binds project scope to the originating project and detects changes to inherited values", async () => {
    const f = await fixture(); f.context.origin = "project"; f.context.projectId = "project-A";
    await f.settings.set("fontSize", 16);
    const plan = await f.plan("settings.fontSize.set", 18, "project");
    const another = f.service.bind({ ...f.context, projectId: "project-B" }).toolHandlers;
    expect(JSON.parse(await another.tw_execute_operation!({ operationId: plan.data.operationId, action: "apply" })).error.code).toBe("PERMISSION_DENIED");
    await f.settings.set("fontSize", 17);
    expect((await f.call("tw_execute_operation", { operationId: plan.data.operationId, action: "apply" })).error.code).toBe("CONFLICT");
    expect((await f.settings.snapshot("project-A")).project.fontSize).toBeUndefined();
  });
  it("does not allow a writable project's plan to execute after the project becomes read-only", async () => {
    const f = await fixture(); let writable = true;
    const service = new CapabilityService(f.registry, { settings: f.settings, journalPath: join(f.root, "readonly-test.sqlite"), projectState: () => ({ writable }) });
    service.initialize();
    try {
      const tools = service.bind({ ...f.context, origin: "project", projectId: "project-A" }).toolHandlers;
      const plan = JSON.parse(await tools.tw_plan_operation!({ id: "settings.fontSize.set", arguments: { scope: "project", value: 18 }, requestId: "read-only" }));
      writable = false;
      expect(JSON.parse(await tools.tw_execute_operation!({ operationId: plan.data.operationId, action: "apply" })).error.code).toBe("PERMISSION_DENIED");
      expect((await f.settings.snapshot("project-A")).project.fontSize).toBeUndefined();
    } finally { service.close(); }
  });
  it("previews effective values, applies idempotently, verifies, and undoes through the settings repository", async () => {
    const f = await fixture();
    const proposed = await f.plan();
    expect(proposed.data).toMatchObject({ before: 15, after: 18, status: "proposed" });
    expect(f.settings.global.fontSize).toBeUndefined();
    const operationId = proposed.data.operationId;
    const result = await f.call("tw_execute_operation", { operationId, action: "apply" });
    expect(result.data.status).toBe("verified"); expect(f.settings.global.fontSize).toBe(18);
    expect((await f.call("tw_execute_operation", { operationId, action: "apply" })).data.duplicate).toBe(true);
    expect((await f.call("tw_execute_operation", { operationId, action: "verify" })).ok).toBe(true);
    await f.service.undo(operationId); expect(f.settings.global.fontSize).toBeUndefined();
    expect(f.service.operationReports([operationId])[0]?.status).toBe("reverted");
  });
  it("requires current policy approval and refuses writes through the read-only endpoint", async () => {
    const f = await fixture();
    const proposed = await f.plan(); f.ask(); f.requestApproval.mockResolvedValue(false);
    expect((await f.call("tw_execute_operation", { operationId: proposed.data.operationId, action: "apply" })).error.code).toBe("APPROVAL_REQUIRED");
    expect(f.settings.global.fontSize).toBeUndefined();
    expect((await f.call("tw_get_state", { id: "settings.fontSize.set", arguments: { scope: "global", value: 20 } })).error.code).toBe("PERMISSION_DENIED");
  });
  it("validates types and scope, and does not authorize absent engines or project context", async () => {
    const f = await fixture();
    for (const value of ["18", 100, false, null]) expect((await f.plan("settings.fontSize.set", value)).error.code).toBe("INVALID_ARGUMENTS");
    expect((await f.plan("settings.engine.set", "xelatex")).error.code).toBe("UNAVAILABLE");
    expect((await f.plan("settings.fontSize.set", 18, "project")).error.code).toBe("UNAVAILABLE");
    expect((await f.call("tw_get_capability", { id: "project.find_blocks" })).data.available).toBe(false);
  });
  it("detects manual edits, concurrent plans, reused request ids and unauthorized session reuse", async () => {
    const f = await fixture();
    const a = await f.plan("settings.fontSize.set", 18, "global", "retry");
    expect((await f.plan("settings.fontSize.set", 18, "global", "retry")).data.operationId).toBe(a.data.operationId);
    expect((await f.plan("settings.fontSize.set", 19, "global", "retry")).error.code).toBe("CONFLICT");
    const other = f.service.bind({ ...f.context, sessionId: "another" }).toolHandlers;
    expect(JSON.parse(await other.tw_execute_operation!({ operationId: a.data.operationId, action: "apply" })).error.code).toBe("PERMISSION_DENIED");
    await f.settings.set("fontSize", 17);
    expect((await f.call("tw_execute_operation", { operationId: a.data.operationId, action: "apply" })).error.code).toBe("CONFLICT");
    const plans = await Promise.all([f.plan("settings.fontSize.set", 20), f.plan("settings.fontSize.set", 21)]);
    const results = await Promise.all(plans.map(plan => f.call("tw_execute_operation", { operationId: plan.data.operationId, action: "apply" })));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => result.error?.code === "CONFLICT")).toHaveLength(1);
  });
  it("rejects expired/canceled operations and conflict during Undo", async () => {
    const f = await fixture();
    const a = await f.plan();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
    expect((await f.call("tw_execute_operation", { operationId: a.data.operationId, action: "apply" })).error.code).toBe("CONFLICT"); clock.mockRestore();
    const b = await f.plan(); await f.call("tw_execute_operation", { operationId: b.data.operationId, action: "apply" });
    await f.settings.set("fontSize", 22); await expect(f.service.undo(b.data.operationId)).rejects.toThrow("Setting changed");
    f.stop(); expect((await f.call("tw_get_state", { id: "settings.fontSize.get", arguments: { scope: "global" } })).error.code).toBe("UNAVAILABLE");
  });
});
