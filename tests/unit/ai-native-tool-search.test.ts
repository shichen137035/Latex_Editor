import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeTestCapabilities, testCapabilities } from "../capability-fixture.js";
import { functionTool, supportsNativeToolSearch } from "../../apps/desktop/src/main/capabilities/adapters.js";
import { capabilityManifest } from "../../apps/desktop/src/main/capabilities/manifest.js";
import { validateManifest } from "../../apps/desktop/src/main/capabilities/registry.js";
import type { OperationContext } from "../../apps/desktop/src/main/capabilities/types.js";
import type { ResponsesToolOutput, ResponsesRequest } from "../../apps/desktop/src/main/capabilities/responses.js";

const roots: string[] = [];
afterEach(async () => { closeTestCapabilities(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const search = (query: string, call_id = crypto.randomUUID()) => ({ type: "tool_search_call", execution: "client", call_id, arguments: { query } });
const call = (name: string, args: unknown, call_id = crypto.randomUUID()) => ({ type: "function_call", name, call_id, arguments: JSON.stringify(args) });
const data = (items: ResponsesToolOutput[]) => {
  const item = items[0];
  if (item?.type !== "function_call_output") throw new Error("Expected function output");
  return JSON.parse(item.output);
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "texweave-tool-search-")); roots.push(root);
  const f = await testCapabilities(root);
  const context: OperationContext = { origin: "pet", sessionId: "session", alive: () => true, permissionMode: () => "auto", requestApproval: vi.fn(async () => true), handlers: {}, skills: [], readSkill: async () => "" };
  const bind = (ctx = context) => f.service.bindResponses(ctx, { protocol: "responses", clientToolSearch: true });
  return { ...f, context, bind, session: bind() };
}

describe("Native Responses tool search", () => {
  it("requires explicit transport support and preserves fixed bridges for current logins", async () => {
    const f = await fixture();
    expect(supportsNativeToolSearch({ protocol: "responses" })).toBe(false);
    for (const protocol of ["codex-app-server", "copilot-sdk"] as const) {
      expect(() => f.service.bindResponses(f.context, { protocol, clientToolSearch: true })).toThrow("fixed-tool bridge");
    }
    expect(f.service.bind(f.context).dynamicTools).toHaveLength(5);
    expect(f.registry.status().transports).toMatchObject({ nativeToolSearch: false, responses: "client-tool-search-adapter" });
    expect(f.session.tools.map(tool => tool.type)).toEqual(["tool_search", "function"]);
    expect(JSON.stringify(f.session.tools)).not.toContain("tw_settings_fontSize_set");
  });
  it("projects every registered capability automatically, preserving optional argument semantics", async () => {
    const manifest = await capabilityManifest();
    for (const cap of manifest) {
      expect(functionTool(cap)).toMatchObject({ type: "function", name: cap.apiName, parameters: cap.inputSchema, strict: false, defer_loading: true });
    }
    const compile = manifest.find(cap => cap.id === "project.texweave_compile")!;
    expect(functionTool(compile).parameters.required).toEqual([]);
    const projection = functionTool(compile); projection.parameters.required = ["mainFile"];
    expect(compile.inputSchema.required).toEqual([]);
    const future = { ...compile, id: "project.future_query", apiName: "future_query" };
    expect(() => validateManifest([...manifest, future])).not.toThrow();
    expect(() => validateManifest([{ ...future, apiName: "x".repeat(65) }])).toThrow();
    expect(() => validateManifest([{ ...future, apiName: "tw_execute_operation" }])).toThrow();
  });
  it("echoes search call IDs, loads only matching schemas and makes the functions callable", async () => {
    const f = await fixture();
    const [loaded] = await f.session.handleOutput([search("settings.fontSize.get", "find_size")]);
    expect(loaded).toMatchObject({ type: "tool_search_output", execution: "client", call_id: "find_size", status: "completed", tools: expect.arrayContaining([expect.objectContaining({ name: "tw_settings_fontSize_get" })]) });
    expect(data(await f.session.handleOutput([call("tw_settings_fontSize_get", { scope: "global" })])).data).toMatchObject({ value: 15, source: "default" });
    expect(await f.session.handleOutput([search("settings.fontSize.get")])).toMatchObject([{ tools: [] }]);
    expect(await f.session.handleOutput([search("nonexistent-zzzzzzzz")])).toMatchObject([{ tools: [] }]);
  });
  it("plans writes without applying them; apply and Undo still use the real gateway", async () => {
    const f = await fixture();
    await f.session.handleOutput([search("settings.fontSize.set")]);
    const change = call("tw_settings_fontSize_set", { scope: "global", value: 19 });
    const planned = data(await f.session.handleOutput([change]));
    expect(planned.data.status).toBe("proposed"); expect(f.settings.global.fontSize).toBeUndefined();
    expect(data(await f.session.handleOutput([change]))).toEqual(planned);
    const apply = call("tw_execute_operation", { operationId: planned.data.operationId, action: "apply" });
    expect(data(await f.session.handleOutput([apply])).data.status).toBe("verified");
    expect(f.settings.global.fontSize).toBe(19);
    expect(data(await f.session.handleOutput([apply])).data.status).toBe("verified");
    expect(data(await f.session.handleOutput([call("tw_execute_operation", { operationId: planned.data.operationId, action: "undo" })])).data.status).toBe("reverted");
    expect(f.settings.global.fontSize).toBeUndefined();
  });
  it("uses the same adapter for project compilation, including optional non-main targets", async () => {
    const f = await fixture();
    const compile = vi.fn(async () => ({ pdf: "appendix.pdf" }));
    const project = f.bind({ ...f.context, origin: "project", projectId: "A", handlers: { "project.texweave_compile": compile } });
    await project.handleOutput([search("project.texweave_compile")]);
    const plan = data(await project.handleOutput([call("texweave_compile", { mainFile: "appendix.tex" })])).data;
    expect(compile).not.toHaveBeenCalled();
    expect(data(await project.handleOutput([call("tw_execute_operation", { operationId: plan.operationId, action: "apply" })])).data.status).toBe("verified");
    expect(compile).toHaveBeenCalledExactlyOnceWith({ mainFile: "appendix.tex" });
  });
  it("rejects unsearched, malformed, wrong-namespace and cross-session calls", async () => {
    const f = await fixture();
    expect(data(await f.session.handleOutput([call("tw_settings_fontSize_get", { scope: "global" })])).error.code).toBe("PERMISSION_DENIED");
    await f.session.handleOutput([search("settings.fontSize.get")]);
    expect(data(await f.bind().handleOutput([call("tw_settings_fontSize_get", { scope: "global" })])).error.code).toBe("PERMISSION_DENIED");
    expect(data(await f.session.handleOutput([{ ...call("tw_settings_fontSize_get", {}), arguments: "{" }])).error.code).toBe("INVALID_ARGUMENTS");
    expect(data(await f.session.handleOutput([{ ...call("tw_settings_fontSize_get", { scope: "global" }), namespace: "attacker" }])).error.code).toBe("PERMISSION_DENIED");
    expect(data(await f.session.handleOutput([call("tw_settings_fontSize_get", { scope: "global", handler: "arbitrary" })])).error.code).toBe("INVALID_ARGUMENTS");
    await expect(f.session.handleOutput([{ ...search("fontSize"), execution: "server" }])).rejects.toThrow("client tool search");
    await expect(f.session.handleOutput([{ ...search("fontSize"), call_id: "" }])).rejects.toThrow("call_id");
  });
  it("rechecks grants, manual conflicts and project ownership after discovery", async () => {
    const f = await fixture();
    await f.session.handleOutput([search("settings.fontSize.set")]);
    const plan = data(await f.session.handleOutput([call("tw_settings_fontSize_set", { scope: "global", value: 19 })])).data;
    const other = f.bind({ ...f.context, sessionId: "other" });
    expect(data(await other.handleOutput([call("tw_execute_operation", { operationId: plan.operationId, action: "apply" })])).error.code).toBe("PERMISSION_DENIED");
    await f.settings.set("fontSize", 18);
    expect(data(await f.session.handleOutput([call("tw_execute_operation", { operationId: plan.operationId, action: "apply" })])).error.code).toBe("CONFLICT");
    f.context.grantedScopes = () => new Set(["app.read"]);
    expect(data(await f.session.handleOutput([call("tw_settings_fontSize_set", { scope: "global", value: 20 })])).error.code).toBe("UNAVAILABLE");
    expect(await f.bind().handleOutput([search("settings.fontSize.set")])).toMatchObject([{ tools: [] }]);
    expect(await f.bind().handleOutput([search("project.texweave_compile")])).toMatchObject([{ tools: [] }]);
  });
  it.each(["abort", "close"])("does not apply after %s while approval is pending", async action => {
    const f = await fixture(); f.context.permissionMode = () => "ask";
    let approve!: (value: boolean) => void;
    f.context.requestApproval = () => new Promise(resolve => { approve = resolve; });
    await f.session.handleOutput([search("settings.fontSize.set")]);
    const plan = data(await f.session.handleOutput([call("tw_settings_fontSize_set", { scope: "global", value: 19 })])).data;
    const controller = new AbortController();
    const pending = f.session.handleOutput([call("tw_execute_operation", { operationId: plan.operationId, action: "apply" })], controller.signal);
    await vi.waitFor(() => expect(approve).toBeTypeOf("function"));
    if (action === "abort") controller.abort(); else f.session.close();
    approve(true);
    expect(data(await pending).error.code).toBe("UNAVAILABLE");
    expect(f.settings.global.fontSize).toBeUndefined();
  });
  it("fails closed on call-ID reuse and releases native session state with its context", async () => {
    const f = await fixture();
    const item = search("fontSize"); await f.session.handleOutput([item]);
    await expect(f.session.handleOutput([{ ...item, arguments: { query: "wordWrap" } }])).rejects.toThrow("reused");
    f.service.releaseContext(f.context.sessionId);
    await expect(f.session.handleOutput([item])).rejects.toThrow("ended");
  });
  it("round-trips search and function outputs in order using the injected SDK converter", async () => {
    const f = await fixture(); const requests: ResponsesRequest[] = [];
    const replies = [
      { output: [{ type: "reasoning", encrypted_content: "opaque" }, search("settings.fontSize.get", "search_size")] },
      { output: [call("tw_settings_fontSize_get", { scope: "global" }, "get_size")] },
      { output: [{ type: "message", role: "assistant", phase: "final_answer", content: [] }] }
    ];
    const toInputItems = vi.fn(output => structuredClone(output));
    const result = await f.session.run({ create: async request => { requests.push(request); return replies[requests.length - 1]!; }, toInputItems }, { model: "explicit-model", input: [{ role: "user", content: "Read font size" }] });
    expect(result.response).toEqual(replies[2]); expect(toInputItems).toHaveBeenCalledTimes(3);
    expect(requests[1]!.input.map(item => item.type)).toEqual([undefined, "reasoning", "tool_search_call", "tool_search_output"]);
    expect(requests[2]!.input.at(-1)).toMatchObject({ type: "function_call_output", call_id: "get_size" });
    expect(requests.every(request => request.store === false && request.model === "explicit-model" && !request.parallel_tool_calls)).toBe(true);
    expect(result.history.at(-1)).toMatchObject({ type: "message", phase: "final_answer" });
    const followup = vi.fn(async (request: ResponsesRequest) => {
      expect(request.input).toEqual([...result.history, { role: "user", content: "Continue" }]);
      return { output: [{ type: "message", role: "assistant", content: [] }] };
    });
    await f.session.run({ create: followup, toInputItems }, { model: "explicit-model", input: [...result.history, { role: "user", content: "Continue" }] });
    expect(followup).toHaveBeenCalledOnce();
  });
  it("stops incomplete/canceled/budget-limited loops before executing tools", async () => {
    const f = await fixture();
    const create = vi.fn(async () => ({ status: "incomplete", output: [search("fontSize")] }));
    const transport = { create, toInputItems: (output: Record<string, unknown>[]) => output };
    const input = { model: "explicit-model", input: [] };
    await expect(f.session.run(transport, input)).rejects.toThrow("did not complete");
    create.mockResolvedValue({ status: "completed", output: [search("fontSize")] });
    await expect(f.session.run(transport, { ...input, maxRounds: 1 })).rejects.toThrow("round budget");
    const controller = new AbortController(); controller.abort();
    await expect(f.session.run(transport, { ...input, signal: controller.signal })).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(2);
  });
});
