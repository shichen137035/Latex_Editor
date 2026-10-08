import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AppError, defaultPreviewDirectives, type BlockApiResult, type WorkingDocumentInput, type PreviewDirectiveDefinition } from "@latex-editor/contracts";
import { createProjectBlockServices } from "../../packages/application/src/project-block-services.js";
import { ProjectWorkingDocumentService, WorkingDocumentFiles } from "../../packages/application/src/working-documents.js";
import type { DocumentStructureFilePort } from "../../packages/application/src/document-structure-service.js";
import { environmentsFromCatalog, type EnvironmentCatalog } from "../../packages/editor-core/src/preview/catalog.js";
import { parsePreview } from "../../packages/editor-core/src/preview/parser.js";
import { previewBlocksForReconciliation } from "../../packages/editor-core/src/preview/reconciliation.js";

const definitions = environmentsFromCatalog(JSON.parse(readFileSync("resources/environments/preview-environments.json", "utf8")) as EnvironmentCatalog);
const saved = "\\section{Saved}\\label{sec:one}\nOriginal text.\n";
const edited = "\\section{Working}\\label{sec:one}\nA much longer unsaved paragraph.\n";
function data<T>(result: BlockApiResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data;
}
function setup(extra: Record<string, string> = {}, configured = definitions, directives = defaultPreviewDirectives) {
  const disk = new Map(Object.entries({ "main.tex": saved, ...extra }));
  const port: DocumentStructureFilePort = {
    async readText(_id, path) {
      const content = disk.get(path);
      if (content === undefined) throw new AppError("FILE_NOT_FOUND", path);
      return { content };
    },
    async writeText(_id, path, content) { disk.set(path, content); },
    async listTree() { return [...disk.keys()].map(relativePath => ({ kind: "file" as const, name: relativePath, relativePath })); }
  };
  let id = 0;
  const ids = { next: () => `block-${++id}` };
  const files = new WorkingDocumentFiles(port);
  const services = createProjectBlockServices({ files, ids, definitions: async () => configured, directives: async () => directives });
  const documents = new ProjectWorkingDocumentService(files, services.blockGraph, ids, async () => configured, async () => directives, services.cacheReclamation);
  const input = (revision: number, content = edited, sessionId = "editor-1"): WorkingDocumentInput => ({
    sessionId, revision, files: [{ fileId: "main.tex", content, savedContent: saved }]
  });
  return { disk, port, files, documents, input, ...services, api: services.structure.api("project") };
}

describe("versioned document working set", () => {
  it("keeps visually disabled environments in the canonical working structure", async () => {
    const source = "\\section{Main}\n\\begin{theorem}\nClaim.\n\\end{theorem}";
    const configured = definitions.map(definition => definition.id === "theorem" ? { ...definition, enabled: false } : definition);
    const app = setup({ "main.tex": source }, configured);
    const result = await app.documents.sync("project", { sessionId: "editor-1", revision: 1, files: [{ fileId: "main.tex", content: source + "\n", savedContent: source }] });
    expect(previewBlocksForReconciliation(parsePreview(source, "main.tex", configured), source).blocks.some(block => block.role === "theorem")).toBe(false);
    expect(result.snapshot.blocks.some(block => block.type === "theorem")).toBe(true);
    expect(data(await app.api.find_blocks({ type: "theorem" }))).toHaveLength(1);
  });

  it("uses the configured command ownership in both working and saved read views", async () => {
    const source = "\\section{Main}\nText.\n\\appendix\nMore.";
    const directives: PreviewDirectiveDefinition[] = defaultPreviewDirectives.map(rule => rule.id === "appendix" ? { ...rule, placement: "nested" } : rule);
    const app = setup({ "main.tex": source }, definitions, directives);
    const result = await app.documents.sync("project", { sessionId: "editor-1", revision: 1, files: [{ fileId: "main.tex", content: source + "\n", savedContent: source }] });
    const section = result.snapshot.blocks.find(block => block.type === "section")!;
    expect(section.range?.end).toBe(source.length + 1);
    expect(data(await app.api.get_block_source({ blockId: section.id })).content).toBe(source + "\n");
    await app.documents.save("project", "main.tex", source + "\n");
    expect(data(await app.api.get_block_source({ blockId: section.id })).textVersion?.kind).toBe("saved");
  });
  it("reads unsaved source and ranges from one view without changing saved structure or disk-only consumers", async () => {
    const app = setup();
    const original = data(await app.structure.snapshot("project"));
    const baseline = app.disk.get(".texweave/structure.json");
    const result = await app.documents.sync("project", app.input(1));
    const sectionId = Object.values(original.blocks).find(block => block.type === "section")!.id;
    expect(result.snapshot.blocks.find(block => block.id === sectionId)?.title).toBe("Working");
    for (let i = 0; i < 3; i++) {
      expect(data(await app.api.get_block_source({ blockId: sectionId })).content).toBe(edited);
      const view = data(await app.structure.snapshot("project"));
      expect(view.files["main.tex"]?.textVersion).toMatchObject({ kind: "working", sessionId: "editor-1", revision: 1 });
      expect(view.blocks[sectionId]?.source.range.end).toBe(edited.length);
      expect(app.disk.get(".texweave/structure.json")).toBe(baseline);
    }
    const isolated = createProjectBlockServices({ files: app.port, ids: { next: () => "isolated" }, definitions: async () => definitions });
    expect(data(await isolated.structure.api("project").get_block_source({ blockId: sectionId })).content).toBe(saved);
    expect(app.disk.get("main.tex")).toBe(saved);
  });

  it("rejects old, competing and retired sessions before they change the graph", async () => {
    const app = setup();
    await app.documents.sync("project", app.input(2));
    await expect(app.documents.sync("project", app.input(1, saved))).rejects.toMatchObject({ code: "DOCUMENT_VERSION_CONFLICT" });
    await expect(app.documents.sync("project", app.input(3, saved, "other-editor"))).rejects.toMatchObject({ code: "DOCUMENT_VERSION_CONFLICT" });
    expect(data(await app.api.find_blocks({ query: "Working" }))).toHaveLength(1);
    await app.documents.close("project", "editor-1");
    await expect(app.documents.sync("project", app.input(4))).rejects.toMatchObject({ code: "DOCUMENT_VERSION_CONFLICT" });
    await app.documents.sync("project", app.input(1, saved, "editor-2"));
    expect(data(await app.api.find_blocks({ query: "Saved" }))).toHaveLength(1);
  });

  it("promotes a multi-file working graph only after all dirty files are saved", async () => {
    const app = setup({ "other.tex": "\\section{Other}\nText." });
    data(await app.structure.snapshot("project"));
    const baseline = app.disk.get(".texweave/structure.json");
    const input = app.input(1);
    input.files.push({ fileId: "other.tex", savedContent: app.disk.get("other.tex")!, content: "\\section{Other edited}\nUpdated text." });
    const working = await app.documents.sync("project", input);
    data(await app.structure.snapshot("project"));
    await app.documents.save("project", "main.tex", edited);
    expect(app.disk.get("main.tex")).toBe(edited);
    expect(app.disk.get(".texweave/structure.json")).toBe(baseline);
    await app.documents.save("project", "other.tex", input.files[1]!.content);
    expect(Object.values(JSON.parse(app.disk.get(".texweave/structure.json")!).files as Record<string, { textVersion?: { kind: string } }>).every(file => file.textVersion?.kind === "saved")).toBe(true);
    const committed = data(await app.structure.snapshot("project"));
    expect(Object.values(committed.files).every(file => file.textVersion?.kind === "saved")).toBe(true);
    expect(app.disk.get(".texweave/structure.json")).not.toBe(baseline);
    expect((await app.blockGraph.snapshot("project")).blocks.map(block => block.id)).toEqual(working.snapshot.blocks.map(block => block.id));
    await app.documents.close("project", "editor-1");
    expect(data(await app.api.find_blocks({ query: "Working" }))).toHaveLength(1);
  });

  it("discarding buffers restores saved IDs, ranges, query results and semantic metadata", async () => {
    const app = setup();
    const original = data(await app.structure.snapshot("project"));
    const sectionId = Object.values(original.blocks).find(block => block.type === "section")!.id;
    await app.documents.sync("project", app.input(1));
    const block = data(await app.api.get_block({ blockId: sectionId }));
    data(await app.api.set_block_semantic({ blockId: sectionId, expectedRevision: block.revision, summary: { text: "Draft summary", source: "user" } }));
    expect(data(await app.api.find_blocks({ query: "Working" }))).toHaveLength(1);
    await app.documents.sync("project", app.input(2, saved));
    expect(JSON.parse(app.disk.get(".texweave/structure.json")!).files["main.tex"].textVersion.kind).toBe("saved");
    expect(data(await app.api.find_blocks({ query: "Working" }))).toHaveLength(0);
    expect(data(await app.api.get_block_source({ blockId: sectionId })).content).toBe(saved);
    expect(data(await app.api.get_block({ blockId: sectionId })).summary).toBeUndefined();
    expect(data(await app.structure.snapshot("project")).files["main.tex"]?.textVersion?.kind).toBe("saved");
  });

  it("rejects source API writes and unversioned range updates into dirty files", async () => {
    const app = setup();
    await app.documents.sync("project", app.input(1));
    const section = data(await app.api.find_blocks({ type: "section" }))[0]!;
    const detail = data(await app.api.get_block({ blockId: section.id }));
    const child = data(await app.api.get_block({ blockId: detail.children[0]!.id }));
    expect(await app.api.replace_block_content({ blockId: child.id, expectedRevision: child.revision, content: "Replacement." })).toMatchObject({ ok: false, error: { code: "UNSAVED_DOCUMENT" } });
    await expect(app.blockGraph.mapUserBlockRanges("project", { fileId: "main.tex", transactions: [[{ start: 0, end: 0, newLength: 5 }]] })).rejects.toMatchObject({ code: "DOCUMENT_VERSION_CONFLICT" });
    await expect(app.blockGraph.reconcileParsedBlocks("project", { fileId: "main.tex", blocks: [] })).rejects.toMatchObject({ code: "DOCUMENT_VERSION_CONFLICT" });
    expect(app.disk.get("main.tex")).toBe(saved);
  });

  it("maps custom ranges once, atomically with their corresponding source version", async () => {
    const app = setup();
    data(await app.structure.snapshot("project"));
    const start = saved.indexOf("Original"), end = start + 8;
    const custom = await app.blockGraph.createUserBlock("project", { fileId: "main.tex", range: { start, end }, role: "custom" });
    const content = `% prefix\n${saved}`;
    await app.documents.sync("project", app.input(1, content));
    expect((await app.blockGraph.snapshot("project")).blocks.find(block => block.id === custom.id)?.range).toEqual({ start: start + 9, end: end + 9 });
    data(await app.structure.snapshot("project"));
    await app.documents.sync("project", app.input(2, content));
    expect((await app.blockGraph.snapshot("project")).blocks.find(block => block.id === custom.id)?.range).toEqual({ start: start + 9, end: end + 9 });
    await app.documents.sync("project", app.input(3, saved));
    expect((await app.blockGraph.snapshot("project")).blocks.find(block => block.id === custom.id)?.range).toEqual({ start, end });
  });

  it("refuses external source or metadata conflicts and keeps the prior working snapshot", async () => {
    const app = setup();
    await app.documents.sync("project", app.input(1));
    app.disk.set("main.tex", "% external\n" + saved);
    await expect(app.documents.sync("project", app.input(2))).rejects.toMatchObject({ code: "DOCUMENT_VERSION_CONFLICT" });
    await expect(app.documents.save("project", "main.tex", edited)).rejects.toMatchObject({ code: "DOCUMENT_VERSION_CONFLICT" });
    expect(app.files.sessions.get("project")?.revision).toBe(1);
    app.disk.set("main.tex", saved);
    app.disk.set(".texweave/structure.json", '{"version":2,"blocks":[],"dependencies":[],"structuralParents":[]}');
    await expect(app.documents.save("project", "main.tex", edited)).rejects.toMatchObject({ code: "DOCUMENT_VERSION_CONFLICT" });
    expect(app.disk.get("main.tex")).toBe(saved);
  });

  it("does not save an obsolete buffer while a newer version is being edited", async () => {
    const app = setup();
    await app.documents.sync("project", app.input(1));
    await app.documents.sync("project", app.input(2, edited + "More text."));
    await expect(app.documents.save("project", "main.tex", edited)).rejects.toMatchObject({ code: "DOCUMENT_VERSION_CONFLICT" });
    expect(app.disk.get("main.tex")).toBe(saved);
  });

  it("validates every file before installing an editor snapshot", async () => {
    const app = setup();
    await app.documents.sync("project", app.input(1));
    const invalid = app.input(2, saved);
    invalid.files.push({ fileId: "../escape.tex", content: "", savedContent: "" });
    await expect(app.documents.sync("project", invalid)).rejects.toMatchObject({ code: "DOCUMENT_VERSION_CONFLICT" });
    expect(app.files.sessions.get("project")?.revision).toBe(1);
    expect(data(await app.api.find_blocks({ query: "Working" }))).toHaveLength(1);
  });

  it("preserves current parser IDs across incremental text edits and shifted siblings", async () => {
    const app = setup({ "main.tex": saved + "\\section{Second}\nAnother paragraph." });
    const base = app.disk.get("main.tex")!;
    await app.documents.sync("project", { sessionId: "editor-1", revision: 1, files: [{ fileId: "main.tex", content: base, savedContent: base }] });
    const next = base.replace("Original", "Expanded original");
    const updated = await app.documents.sync("project", { sessionId: "editor-1", revision: 2, files: [{ fileId: "main.tex", content: next, savedContent: base }] });
    const expected = previewBlocksForReconciliation(parsePreview(next, "main.tex", definitions), next);
    expect(Object.keys(updated.semanticIds["main.tex"]!).sort()).toEqual(expected.blocks.map(block => block.transientId).sort());
    for (const block of expected.blocks) {
      const id = updated.semanticIds["main.tex"]![block.transientId];
      expect(updated.snapshot.blocks.find(item => item.id === id)?.range).toEqual(block.range);
    }
  });

  it("serializes snapshots without mixing source and ranges", async () => {
    const app = setup();
    const results = await Promise.all([app.documents.sync("project", app.input(1)), app.documents.sync("project", app.input(2, edited + "More text."))]);
    expect(results.map(result => result.revision)).toEqual([1, 2]);
    const section = data(await app.api.find_blocks({ type: "section" }))[0]!;
    const source = data(await app.api.get_block_source({ blockId: section.id }));
    expect(source.content).toBe(edited + "More text.");
    expect(source.textVersion).toMatchObject({ kind: "working", revision: 2 });
  });

  it("retains a recoverable working graph when saving text succeeds but saving metadata fails", async () => {
    const app = setup();
    data(await app.structure.snapshot("project"));
    await app.documents.sync("project", app.input(1));
    const write = app.port.writeText;
    let fail = true;
    app.port.writeText = async (projectId, path, content) => {
      if (path === ".texweave/structure.json" && fail) throw new Error("metadata disk failure");
      return write(projectId, path, content);
    };
    await expect(app.documents.save("project", "main.tex", edited)).rejects.toThrow("metadata disk failure");
    expect(app.disk.get("main.tex")).toBe(edited);
    expect(app.files.sessions.get("project")?.files.has("main.tex")).toBe(true);
    fail = false;
    await app.documents.save("project", "main.tex", edited);
    expect(data(await app.structure.snapshot("project")).files["main.tex"]?.textVersion?.kind).toBe("saved");
  });

  it("releases dirty source even if another process corrupts the saved metadata", async () => {
    const app = setup();
    await app.documents.sync("project", app.input(1));
    app.disk.set(".texweave/structure.json", "invalid metadata");
    await app.documents.close("project", "editor-1");
    expect(app.files.sessions.has("project")).toBe(false);
    expect(app.disk.get(".texweave/structure.json")).toBe("invalid metadata");
  });

  it("prevents file and folder mutations from invalidating dirty source bindings", async () => {
    const app = setup();
    await app.documents.sync("project", app.input(1));
    let moved = false;
    await expect(app.documents.mutateEntries("project", ["main.tex"], async () => { moved = true; })).rejects.toMatchObject({ code: "UNSAVED_DOCUMENT" });
    expect(moved).toBe(false);
    expect(app.disk.get("main.tex")).toBe(saved);
  });

  it("discarding one file preserves other files' working ranges and pending semantics", async () => {
    const app = setup({ "other.tex": "\\section{Other}\\label{sec:other}\nSecond text." });
    data(await app.structure.snapshot("project"));
    const otherSaved = app.disk.get("other.tex")!, otherEdited = `% prefix\n${otherSaved}`;
    const input = app.input(1);
    input.files.push({ fileId: "other.tex", content: otherEdited, savedContent: otherSaved });
    await app.documents.sync("project", input);
    const other = data(await app.api.find_blocks({ label: "sec:other" }))[0]!;
    const detail = data(await app.api.get_block({ blockId: other.id }));
    data(await app.api.set_block_semantic({ blockId: other.id, expectedRevision: detail.revision, summary: { text: "Preserve this pending summary", source: "user" } }));
    await app.documents.sync("project", { ...input, revision: 2, files: [{ fileId: "main.tex", content: saved, savedContent: saved }, input.files[1]!] });
    expect(data(await app.api.get_block({ blockId: other.id })).summary).toBe("Preserve this pending summary");
    const result = data(await app.api.get_block_source({ blockId: other.id }));
    expect(result.content).toBe(otherSaved);
    expect(result.textVersion?.kind).toBe("working");
    expect(data(await app.structure.snapshot("project")).blocks[other.id]!.source.range.start).toBe(9);
  });

  it("reads committed metadata after save so subsequent semantic edits accumulate", async () => {
    const app = setup();
    data(await app.structure.snapshot("project"));
    await app.documents.sync("project", app.input(1));
    const section = data(await app.api.find_blocks({ type: "section" }))[0]!;
    await app.documents.save("project", "main.tex", edited);
    const detail = data(await app.api.get_block({ blockId: section.id }));
    data(await app.api.set_block_semantic({ blockId: section.id, expectedRevision: detail.revision, summary: { text: "Saved summary", source: "user" } }));
    data(await app.api.set_block_semantic({ blockId: section.id, expectedRevision: detail.revision, tags: { user: ["saved-tag"] } }));
    expect(data(await app.api.get_block({ blockId: section.id }))).toMatchObject({ summary: "Saved summary", tags: ["saved-tag"] });
    await app.documents.close("project", "editor-1");
    expect(data(await app.api.get_block({ blockId: section.id }))).toMatchObject({ summary: "Saved summary", tags: ["saved-tag"] });
  });

  it("preserves an unchanged custom range between disjoint edits and skips accepted batches", async () => {
    const app = setup();
    data(await app.structure.snapshot("project"));
    const start = saved.indexOf("Original"), end = start + 8;
    const custom = await app.blockGraph.createUserBlock("project", { fileId: "main.tex", range: { start, end }, role: "custom" });
    const prefix = "% prefix\n", prefixed = prefix + saved;
    const first = { from: 0, to: 0, insertedText: prefix };
    const second = { from: prefixed.length, to: prefixed.length, insertedText: "\nExtra text." };
    await app.documents.sync("project", { sessionId: "editor-1", revision: 1, files: [{ fileId: "main.tex", content: prefixed, savedContent: saved, rangeChanges: { beforeContent: saved, transactions: [[first]] } }] });
    await app.documents.sync("project", { sessionId: "editor-1", revision: 2, files: [{ fileId: "main.tex", content: prefixed + second.insertedText, savedContent: saved, rangeChanges: { beforeContent: saved, transactions: [[first], [second]] } }] });
    expect((await app.blockGraph.snapshot("project")).blocks.find(block => block.id === custom.id)).toMatchObject({ state: "active", range: { start: start + prefix.length, end: end + prefix.length } });
    const invalid = app.input(3, prefixed + second.insertedText + "!");
    invalid.files[0]!.rangeChanges = { beforeContent: prefixed, transactions: [[{ from: 0, to: 0, insertedText: "wrong" }]] };
    await expect(app.documents.sync("project", invalid)).rejects.toMatchObject({ code: "DOCUMENT_VERSION_CONFLICT" });
    expect(app.files.sessions.get("project")?.revision).toBe(2);
  });
});
