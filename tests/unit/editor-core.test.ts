import { describe, expect, it } from "vitest";
import { AppError, type TextFileContent } from "@latex-editor/contracts";
import { DocumentService, EditorIntelligenceService, scanLatex, type DocumentFilePort } from "../../packages/editor-core/src/index.js";
import { hashText } from "../../packages/filesystem-node/src/index.js";

class MemoryFiles implements DocumentFilePort {
  content = "\\documentclass{article}\n";

  async readText(projectId: string, relativePath: string): Promise<TextFileContent> {
    return { projectId, relativePath, content: this.content, encoding: "utf8", hash: hashText(this.content), modifiedAt: "2026-01-01T00:00:00.000Z" };
  }

  async writeText(projectId: string, relativePath: string, content: string) {
    this.content = content;
    return { projectId, relativePath, hash: hashText(content), modifiedAt: "2026-01-01T00:00:00.000Z" };
  }
}

const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };

describe("Editor Core", () => {
  it("ED-001 ED-002 ED-003 opens, edits, and saves a UTF-8 document", async () => {
    const files = new MemoryFiles();
    const service = new DocumentService(files, clock);
    const opened = await service.open({ projectId: "p1", relativePath: "main.tex" });
    expect(opened).toMatchObject({ revision: 1, status: "clean", encoding: "utf8" });
    const changed = await service.applyChanges({
      projectId: "p1", relativePath: "main.tex", expectedRevision: 1,
      changes: [{ text: "\\begin{document}\nHello\n\\end{document}\n" }]
    });
    expect(changed).toMatchObject({ revision: 2, status: "dirty" });
    const saved = await service.save({ projectId: "p1", relativePath: "main.tex" });
    expect(saved.document.status).toBe("clean");
    expect(files.content).toContain("Hello");
  });

  it("ED-004 ED-005 refuses external overwrite unless force is explicit", async () => {
    const files = new MemoryFiles();
    const service = new DocumentService(files, clock);
    await service.open({ projectId: "p1", relativePath: "main.tex" });
    await service.applyChanges({ projectId: "p1", relativePath: "main.tex", expectedRevision: 1, changes: [{ text: "editor" }] });
    files.content = "external";
    await expect(service.save({ projectId: "p1", relativePath: "main.tex" })).rejects.toMatchObject({ code: "EXTERNAL_MODIFICATION_CONFLICT" });
    expect(files.content).toBe("external");
    const forced = await service.save({ projectId: "p1", relativePath: "main.tex", force: true });
    expect(forced.conflictOverridden).toBe(true);
    expect(files.content).toBe("editor");
  });

  it("ED-006 ED-007 parses references while ignoring comments and tolerating incomplete commands", () => {
    const references = scanLatex([
      "% \\label{ignored}",
      "Text \\% literal \\label{sec:real}",
      "\\ref{sec:real} \\cite{book} \\input{chapter}",
      "\\incomplete"
    ].join("\n"));
    expect(references).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "label", value: "sec:real", line: 2 }),
      expect.objectContaining({ kind: "ref", value: "sec:real", line: 3 }),
      expect.objectContaining({ kind: "cite", value: "book", line: 3 }),
      expect.objectContaining({ kind: "input", value: "chapter", line: 3 })
    ]));
    expect(references.some((item) => item.value === "ignored")).toBe(false);
  });

  it("ED-009 keeps a dirty buffer when close is not confirmed", async () => {
    const service = new DocumentService(new MemoryFiles(), clock);
    await service.open({ projectId: "p1", relativePath: "main.tex" });
    await service.applyChanges({ projectId: "p1", relativePath: "main.tex", expectedRevision: 1, changes: [{ text: "dirty" }] });
    await expect(service.close({ projectId: "p1", relativePath: "main.tex" })).rejects.toBeInstanceOf(AppError);
    expect(await service.listOpen("p1")).toHaveLength(1);
  });

  it("ED-008 obtains completions from an injected resource catalog", () => {
    const intelligence = new EditorIntelligenceService({
      searchCommands: (query) => query === "sec" ? [{ id: "custom.section", name: "section", insertText: "\\section{${1:title}}", detail: "external", category: "structure" }] : [],
      searchEnvironments: () => []
    });
    expect(intelligence.getCompletions("sec")).toEqual([
      { kind: "command", id: "custom.section", label: "section", insertText: "\\section{${1:title}}", detail: "external" }
    ]);
  });
});
