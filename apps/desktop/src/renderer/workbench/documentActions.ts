import type { CompileResult, Project, ProjectTreeNode } from "@latex-editor/contracts";
import type { Dispatch, SetStateAction } from "react";
import { t } from "../i18n/index.js";
import { projectFilePaths, type PersistedLayout } from "./layout.js";
export interface CompileGuard { busy: boolean; alive: boolean; }

type BottomTab = "problems" | "output" | "compileLog";
interface DocumentActionsOptions {
  api: Window["latexEditor"];
  project: Project;
  activePath: string | undefined;
  tree: ProjectTreeNode[];
  compileState: "idle" | "running";
  guard?: CompileGuard;
  isCurrent?(mainFile: string): boolean;
  onIdle?(): void;
  onPdfReady?(result: CompileResult): void;
  saveActive(): Promise<void>;
  saveAll(): Promise<void>;
  setCompileState: Dispatch<SetStateAction<"idle" | "running">>;
  setCompileResult: Dispatch<SetStateAction<CompileResult | undefined>>;
  setPdfDataUrl: Dispatch<SetStateAction<string | undefined>>;
  setLayout: Dispatch<SetStateAction<PersistedLayout>>;
  setBottomTab: Dispatch<SetStateAction<BottomTab>>;
  setBottomVisible: Dispatch<SetStateAction<boolean>>;
}

export function createDocumentActions(options: DocumentActionsOptions) {
  const alive = () => options.guard?.alive !== false;
  const current = (mainFile: string) => alive() && options.isCurrent?.(mainFile) !== false;
  const resolveMainTexFile = () => options.project.mainFile
    ?? (options.activePath?.toLocaleLowerCase().endsWith(".tex") ? options.activePath : undefined)
    ?? projectFilePaths(options.tree).find((path) => path.toLocaleLowerCase().endsWith(".tex"));

  const compile = async () => {
    if (!options.api || options.compileState === "running" || options.guard?.busy || options.guard?.alive === false) return;
    const mainFile = resolveMainTexFile();
    if (!mainFile) {
      options.setCompileResult({ compilationId: "ui-error", status: "failed", exitCode: null, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 0, mainFile: "", diagnostics: [{ severity: "error", source: "system", message: "No LaTeX main file is configured." }], stdoutTail: "", stderrTail: "" });
      options.setBottomTab("problems");
      options.setBottomVisible(true);
      return;
    }
    if (options.guard) options.guard.busy = true;
    options.setCompileState("running");
    try {
      await options.saveAll();
      if (!current(mainFile)) return;
      const result = await options.api.compile.run(options.project.id, mainFile);
      if (!current(mainFile)) return;
      options.setCompileResult(result);
      if (result.status === "succeeded" && result.pdfDataUrl) { options.setPdfDataUrl(result.pdfDataUrl); options.onPdfReady?.(result); }
      options.setLayout((value) => ({ ...value, rightPane: "pdf" }));
      options.setBottomTab(result.diagnostics.length ? "problems" : "compileLog");
      options.setBottomVisible(result.status !== "succeeded");
    } catch (reason) {
      if (!current(mainFile)) return;
      options.setCompileResult({ compilationId: "ui-error", status: "failed", exitCode: null, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 0, mainFile, diagnostics: [{ severity: "error", source: "system", message: reason instanceof Error ? reason.message : String(reason) }], stdoutTail: "", stderrTail: "" });
      options.setBottomTab("problems");
      options.setBottomVisible(true);
    } finally {
      if (options.guard) options.guard.busy = false;
      if (alive()) { options.setCompileState("idle"); options.onIdle?.(); }
    }
  };

  const exportSourceArchive = async () => {
    if (!options.api || options.compileState === "running") return;
    try {
      await options.saveAll();
      const path = await options.api.exports.sourceArchive(options.project.id, resolveMainTexFile());
      if (path) window.alert(t("export.saved", { path }));
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };

  const exportMainTex = async () => {
    if (!options.api || options.compileState === "running") return;
    const mainFile = resolveMainTexFile();
    if (!mainFile) { window.alert(t("export.noMainTex")); return; }
    try {
      await options.saveAll();
      const path = await options.api.exports.mainTex(options.project.id, mainFile);
      if (path) window.alert(t("export.saved", { path }));
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };

  const exportPdf = async () => {
    if (!options.api || options.compileState === "running" || options.guard?.busy || options.guard?.alive === false) return;
    const mainFile = resolveMainTexFile();
    if (!mainFile) { window.alert(t("export.noMainTex")); return; }
    if (options.guard) options.guard.busy = true;
    options.setCompileState("running");
    try {
      await options.saveAll();
      const result = await options.api.exports.pdf(options.project.id, mainFile);
      if (!current(mainFile)) return;
      if (result.status === "cancelled") return;
      options.setCompileResult(result.compilation);
      if (result.status === "failed") {
        options.setBottomTab("problems");
        options.setBottomVisible(true);
        const diagnostic = result.compilation.diagnostics.find((item) => item.severity === "error");
        window.alert(diagnostic?.message ?? t("export.pdfFailed"));
        return;
      }
      options.setPdfDataUrl(result.pdfDataUrl);
      options.onPdfReady?.(result.compilation);
      options.setLayout((value) => ({ ...value, rightPane: "pdf" }));
      options.setBottomTab(result.compilation.diagnostics.length ? "problems" : "compileLog");
      options.setBottomVisible(false);
      window.alert(t("export.saved", { path: result.path }));
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
    finally { if (options.guard) options.guard.busy = false; if (alive()) { options.setCompileState("idle"); options.onIdle?.(); } }
  };

  return { compile, resolveMainTexFile, exportSourceArchive, exportMainTex, exportPdf };
}
