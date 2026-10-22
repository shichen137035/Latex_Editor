import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeTestCapabilities, testCapabilities } from "../capability-fixture.js";
import type { OperationContext } from "../../apps/desktop/src/main/capabilities/types.js";
import { parsePreview } from "../../packages/editor-core/src/preview/parser.js";
import { includeNewBuiltInDirectives } from "@latex-editor/contracts";

const roots: string[] = [];
afterEach(async () => { closeTestCapabilities(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "texweave-customization-")); roots.push(root);
  const f = await testCapabilities(root);
  const context: OperationContext = { origin: "pet", sessionId: "customization", alive: () => true, permissionMode: () => "auto", handlers: {}, skills: [], readSkill: async () => "", requestApproval: vi.fn(async () => true) };
  const handlers = f.service.bind(context).toolHandlers;
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse(await handlers[name]!(args));
  const read = async (group: string, id: string) => call("tw_get_state", { id: `customization.${group}.read`, arguments: { id, scope: "global" } });
  const plan = async (group: string, args: Record<string, unknown>) => call("tw_plan_operation", { id: `customization.${group}.upsert`, arguments: { scope: "global", ...args }, requestId: crypto.randomUUID() });
  const apply = (id: string) => call("tw_execute_operation", { operationId: id, action: "apply" });
  return { ...f, context, call, read, plan, apply };
}

describe("AI definition customization", () => {
  for (const group of ["blocks", "commands"] as const) {
    const id = group === "blocks" ? "research-note" : "research-break";
    const create = group === "blocks" ? { id, mode: "create", baseId: "remark", patch: { label: "Research note", match: { kind: "latex-environment", name: "researchnote" }, style: { baseColor: "#168895", colorMode: "adaptive" } } } : { id, mode: "create", patch: { label: "Research break", match: { kind: "command", name: "researchbreak" }, display: "divider", color: "#168895", colorMode: "adaptive", placement: "nested" } };
    it(`${group} creates one definition, applies real parser behavior and supports persisted Undo`, async () => {
      const f = await fixture();
      const plan = await f.plan(group, create); expect(plan.ok).toBe(true);
      expect(f.settings.global.environments).toBeUndefined(); expect(f.settings.global.previewDirectives).toBeUndefined();
      const result = await f.apply(plan.data.operationId); expect(result.data.status).toBe("verified");
      expect(result.data.result.definition).toMatchObject({ id, builtIn: false, enabled: true });
      const listing = await f.call("tw_get_state", { id: `customization.${group}.list`, arguments: { scope: "global", query: "research", limit: 1 } });
      expect(listing.data.definitions.map((entry: { id: string }) => entry.id)).toEqual([id]);
      expect(JSON.stringify(listing)).not.toContain('"style"');
      const selected = await f.read(group, id); expect(selected.data.revision).toHaveLength(64);
      if (group === "blocks") {
        const definition = selected.data.definition;
        const parsed = parsePreview("\\begin{researchnote}\nA note.\n\\end{researchnote}", "main.tex", [...f.blockDefinitions, definition]);
        expect(parsed.nodes[0]).toMatchObject({ kind: "block", environmentId: id });
        expect(definition.behavior).toEqual(f.blockDefinitions.find(item => item.id === "remark")!.behavior);
      } else {
        const commands = includeNewBuiltInDirectives(f.settings.global.previewDirectives!);
        const parsed = parsePreview("Before.\n\n\\researchbreak\n\nAfter.", "main.tex", f.blockDefinitions, commands);
        expect(parsed.nodes.some(node => node.kind === "content" && node.directiveId === id)).toBe(true);
      }
      const report = f.service.operationReports([plan.data.operationId])[0]!;
      expect(report.after).toMatchObject({ id }); expect(JSON.stringify(report)).not.toContain('"chapter"');
      f.service.close(); f.service.initialize();
      expect(f.service.operationReports([plan.data.operationId])[0]?.after).toEqual(report.after);
      await f.service.undo(plan.data.operationId);
      expect((await f.read(group, id)).ok).toBe(false);
      expect((await f.read(group, group === "blocks" ? "remark" : "newpage")).ok).toBe(true);
    });

    it(`${group} merges partial updates, rejects stale reads, and preserves unrelated or concurrent changes`, async () => {
      const f = await fixture();
      const creation = await f.plan(group, create); await f.apply(creation.data.operationId);
      const selected = await f.read(group, id);
      const changed = await f.plan(group, { id, mode: "update", expectedRevision: selected.data.revision, patch: { labels: { en: "Named", ja: "名前" } } });
      await f.apply(changed.data.operationId);
      expect((await f.plan(group, { id, mode: "update", expectedRevision: selected.data.revision, patch: { enabled: false } })).error.code).toBe("CONFLICT");
      const latest = await f.read(group, id);
      const update = await f.plan(group, { id, mode: "update", expectedRevision: latest.data.revision, patch: { labels: { en: "Renamed" } } });
      expect((await f.apply(update.data.operationId)).ok).toBe(true);
      const after = await f.read(group, id);
      expect(after.data.definition.labels).toEqual({ en: "Renamed", ja: "名前" });
      expect(after.data.definition.match).toEqual(selected.data.definition.match);
      const conflict = await f.plan(group, { id, mode: "update", expectedRevision: after.data.revision, patch: { enabled: false } });
      const key = group === "blocks" ? "environments" : "previewDirectives";
      await f.settings.set(key, f.settings.global[key]!.map(item => item.id === id ? { ...item, label: "Manual edit" } : item));
      expect((await f.apply(conflict.data.operationId)).error.code).toBe("CONFLICT");
      await expect(f.service.undo(update.data.operationId)).rejects.toThrow("Setting changed");
      expect((await f.read(group, id)).data.definition.label).toBe("Manual edit");
    });

    it(`${group} rejects name collisions, invalid definitions, forged fields and unbound project scope`, async () => {
      const f = await fixture();
      const existing = group === "blocks" ? "remark" : "newpage";
      const read = await f.read(group, existing);
      const renamed = await f.plan(group, { id: existing, mode: "update", expectedRevision: read.data.revision, patch: { match: group === "blocks" ? { kind: "latex-environment", name: "other" } : { kind: "command", name: "other" } } });
      expect(renamed.error.code).toBe("INVALID_ARGUMENTS");
      expect((await f.plan(group, { ...create, patch: { builtIn: true } })).error.code).toBe("INVALID_ARGUMENTS");
      expect((await f.plan(group, { ...create, patch: group === "blocks" ? { style: { baseColor: "url(remote)" }, match: { kind: "latex-environment", name: "researchnote" } } : { match: { kind: "command", name: "bad-name" } } })).error.code).toBe("INVALID_ARGUMENTS");
      expect((await f.plan(group, { ...create, scope: "project" })).error.code).toBe("UNAVAILABLE");
      const creation = await f.plan(group, create); await f.apply(creation.data.operationId);
      expect((await f.plan(group, { ...create, id: "another-id" })).error.code).toBe("CONFLICT");
    });
  }

  it("rechecks approval and binds project configuration to its originating project", async () => {
    const f = await fixture(); f.context.permissionMode = () => "ask";
    f.context.requestApproval = async () => { f.context.alive = () => false; return true; };
    const args = { scope: "global", id: "notice", mode: "create", patch: { match: { kind: "command", name: "notice" } } };
    const denied = await f.plan("commands", args);
    expect((await f.apply(denied.data.operationId)).error.code).toBe("UNAVAILABLE");
    expect(f.settings.global.previewDirectives).toBeUndefined();
    f.context.alive = () => true; f.context.permissionMode = () => "auto"; f.context.origin = "project"; f.context.projectId = "project-a";
    const plan = await f.plan("commands", { ...args, scope: "project" });
    expect((await f.apply(plan.data.operationId)).data.status).toBe("verified");
    expect(f.settings.global.previewDirectives).toBeUndefined();
    expect((await f.settings.snapshot("project-a")).project.previewDirectives?.some(item => item.id === "notice")).toBe(true);
    expect((await f.settings.snapshot("project-b")).project.previewDirectives).toBeUndefined();
    await expect(f.service.undo(plan.data.operationId, "project-b")).rejects.toThrow("Undo is unavailable");
    await f.service.undo(plan.data.operationId, "project-a");
    expect((await f.settings.snapshot("project-a")).project.previewDirectives).toBeUndefined();
  });
});
