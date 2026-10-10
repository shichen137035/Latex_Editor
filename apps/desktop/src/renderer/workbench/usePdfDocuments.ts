import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompileResult, Project, ProjectPdfDocument, ProjectTreeNode, SyncTexPdfPosition } from "@latex-editor/contracts";
import type { PdfViewState, PdfLinkDestination } from "../pdf/PdfViewer.js";
import { pdfFileForSource, projectPdfFile, previewDocumentForSource, projectPdfLink } from "./compileTargets.js";

type DisplayResult = CompileResult & { pdfDataUrl?: string | undefined };
export function usePdfDocuments({ api, project, tree, activePath, follow }: {
  api: Window["latexEditor"]; project: Project; tree: ProjectTreeNode[]; activePath?: string | undefined; follow: boolean;
}) {
  const [documents, setDocuments] = useState<ProjectPdfDocument[]>([]);
  const [selectedId, setSelectedId] = useState(project.mainFile);
  const [pdfDataUrl, setPdfDataUrl] = useState<string>();
  const [pdfOrigin, setPdfOrigin] = useState<"project" | "ai-workspace">("project");
  const [pdfTarget, setPdfTarget] = useState<(SyncTexPdfPosition & { requestId: number })>();
  const [reload, setReload] = useState(0);
  const [pdfLinkDestination, setPdfLinkDestination] = useState<PdfLinkDestination>();
  const selectionRef = useRef(selectedId); selectionRef.current = selectedId;
  const pdfOriginRef = useRef(pdfOrigin); pdfOriginRef.current = pdfOrigin;
  const readSequence = useRef(0), catalogSequence = useRef(0);
  const latestBuilds = useRef(new Map<string, number>());
  const followed = useRef("");
  const viewStates = useRef(new Map<string, { current: PdfViewState | undefined }>());
  const selected = documents.find(doc => doc.id === selectedId);
  const pdfViewState = useMemo(() => {
    const key = `${project.id}:${selectedId}:${pdfOrigin}`;
    let state = viewStates.current.get(key);
    if (!state) { state = { current: undefined }; viewStates.current.set(key, state); }
    return state;
  }, [project.id, selectedId, pdfOrigin]);
  const selectPdf = useCallback((id: string) => {
    readSequence.current++;
    selectionRef.current = id;
    setSelectedId(id); setPdfDataUrl(undefined); setPdfOrigin("project"); setPdfTarget(undefined); setPdfLinkDestination(undefined); setReload(value => value + 1);
  }, []);
  const refresh = useCallback(async () => {
    if (!api) return;
    const sequence = ++catalogSequence.current;
    try {
      const values = await api.compile.outputs(project.id);
      if (sequence === catalogSequence.current) setDocuments(values);
    } catch { /* Keep the last usable catalog when a file tree refresh races a rename. */ }
  }, [api, project.id]);
  useEffect(() => {
    setDocuments([]); latestBuilds.current.clear(); viewStates.current.clear(); followed.current = "";
    selectPdf(project.mainFile ?? "");
    return () => { readSequence.current++; catalogSequence.current++; };
  }, [project.id, project.mainFile, selectPdf]);
  useEffect(() => { void refresh(); }, [refresh, tree, project.mainFile]);
  useEffect(() => {
    if (!documents.length) return;
    const desired = previewDocumentForSource(documents, activePath, project.mainFile, selectedId);
    const token = `${project.id}:${activePath}:${follow}:${desired?.id}`;
    if (followed.current === token) return;
    followed.current = token;
    if (follow && desired && selectionRef.current !== desired.id) selectPdf(desired.id);
    else if (!documents.some(doc => doc.id === selectionRef.current) && desired) selectPdf(desired.id);
  }, [documents, activePath, follow, project.id, project.mainFile, selectedId, selectPdf]);
  useEffect(() => {
    const sequence = ++readSequence.current;
    if (pdfOrigin !== "project") return;
    setPdfTarget(undefined);
    if (!api || !selected?.available) { setPdfDataUrl(undefined); return; }
    void api.files.readPdf(project.id, selected.pdfFile).then(data => {
      if (sequence === readSequence.current) setPdfDataUrl(data);
    }).catch(() => { if (sequence === readSequence.current) setPdfDataUrl(undefined); });
    return () => { readSequence.current++; };
  }, [api, project.id, selected?.id, selected?.pdfFile, selected?.available, reload, pdfOrigin]);
  const adopt = (result: DisplayResult, origin: "project" | "ai-workspace" = "project") => {
    const started = Date.parse(result.startedAt) || 0;
    if (started < (latestBuilds.current.get(result.mainFile) ?? 0)) return false;
    latestBuilds.current.set(result.mainFile, started);
    if (origin === "project" && result.status === "succeeded") {
      const pdfFile = projectPdfFile(project.canonicalPath, result.pdfPath) ?? pdfFileForSource(result.mainFile)!;
      setDocuments(values => {
        const existing = values.find(doc => doc.id === result.mainFile);
        const entry: ProjectPdfDocument = { id: result.mainFile, sourceFile: result.mainFile, sourceFiles: existing?.sourceFiles ?? [result.mainFile], pdfFile, syncFile: pdfFile, available: true };
        return [...values.filter(doc => doc.id !== entry.id), entry];
      });
    }
    if (selectionRef.current !== result.mainFile || result.status !== "succeeded" || !result.pdfDataUrl) return false;
    readSequence.current++; setPdfDataUrl(result.pdfDataUrl); setPdfOrigin(origin); setPdfTarget(undefined);
    return true;
  };
  const recordResults = (results: CompileResult[]) => { for (const result of results) adopt(result); void refresh(); };
  const sourceTarget = previewDocumentForSource(documents, activePath, project.mainFile, selectedId)?.sourceFile;
  const openPdfLink = (href: string) => {
    if (!selected) return false;
    const link = projectPdfLink(documents, selected, href, project.mainFile);
    if (!link) return false;
    if (link.id !== selectedId || pdfOrigin !== "project") selectPdf(link.id);
    if (link.destination) setPdfLinkDestination({ value: link.destination, requestId: Date.now() });
    return true;
  };
  return {
    documents, selectedId, selectPdf, pdfDataUrl, setPdfDataUrl, pdfOrigin, pdfOriginRef, pdfViewState, pdfTarget, setPdfTarget,
    pdfSourceFile: selected?.sourceFile ?? selected?.pdfFile ?? selectedId,
    pdfFile: pdfOrigin === "ai-workspace" ? undefined : selected?.syncFile ?? (selected?.available ? selected.pdfFile : undefined),
    sourceTarget, adopt, recordResults, openPdfLink, pdfLinkDestination,
    onPdfReady: (result: CompileResult) => { adopt(result); return false; }
  };
}
