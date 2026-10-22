import { t } from "../i18n/index.js";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { BlockGraphSnapshot, BlockTextEdit, WorkingDocumentInput } from "@latex-editor/contracts";
import type { EditorTab } from "./fileActions.js";

interface Options {
  api: Window["latexEditor"];
  projectId: string;
  tabs: EditorTab[];
  tabsRef: MutableRefObject<EditorTab[]>;
  savedContents: MutableRefObject<Map<string, string>>;
  activePath: string | undefined;
  configuration: unknown;
  directives: unknown;
  onSnapshot(snapshot: BlockGraphSnapshot): void;
  onSemanticIds(ids: Record<string, string>): void;
  onError(message: string): void;
}

export function useWorkingDocuments(options: Options) {
  const current = useRef(options);
  current.current = options;
  const client = useMemo(() => {
    const sessionId = crypto.randomUUID();
    let revision = 0, closed = false;
    const mappings = new Map<string, NonNullable<WorkingDocumentInput["files"][number]["rangeChanges"]>>();
    return {
      resetFile(path: string) { mappings.delete(path); },
      recordChange(path: string, before: string, after: string, edits: BlockTextEdit[]) {
        if (!/\.tex$/i.test(path)) return;
        let delta = 0;
        const changes = [...edits].sort((a, b) => a.start - b.start).map(edit => {
          const insertedText = after.slice(edit.start + delta, edit.start + delta + edit.newLength);
          delta += edit.newLength - (edit.end - edit.start);
          return { from: edit.start, to: edit.end, insertedText };
        });
        const pending = mappings.get(path) ?? { beforeContent: before, transactions: [] };
        pending.transactions.push(changes);
        mappings.set(path, pending);
      },
      async sync() {
        if (closed || !options.api) return;
        const state = current.current;
        const files: WorkingDocumentInput["files"] = state.tabsRef.current.filter(tab => /\.tex$/i.test(tab.path)).map(tab => {
          const savedContent = state.savedContents.current.get(tab.path);
          if (savedContent === undefined) throw new Error(t("ui.workingDocuments.the_saved_document_baseline_is_unavailable", { value1: tab.path }));
          const pending = mappings.get(tab.path);
          return { fileId: tab.path, content: tab.content, savedContent,
            ...(pending ? { rangeChanges: { beforeContent: pending.beforeContent, transactions: [...pending.transactions] } } : {}) };
        });
        const requested = ++revision;
        const result = await options.api.documents.sync(options.projectId, { sessionId, revision: requested, files }).catch(error => {
          if (closed || requested !== revision) return undefined;
          throw error;
        });
        if (!result) return;
        for (const file of files) {
          if (current.current.tabsRef.current.find(tab => tab.path === file.fileId)?.content === file.content) mappings.delete(file.fileId);
        }
        if (closed || requested !== revision) return;
        current.current.onSnapshot(result.snapshot);
        current.current.onSemanticIds(result.semanticIds[current.current.activePath ?? ""] ?? {});
      },
      async close() {
        if (closed || !options.api) return;
        closed = true;
        mappings.clear();
        await options.api.documents.close(options.projectId, sessionId);
      }
    };
  }, [options.api, options.projectId]);
  useEffect(() => {
    void client.sync().catch(error => current.current.onError(error instanceof Error ? error.message : String(error)));
  }, [client, options.tabs, options.activePath, options.configuration, options.directives]);
  // React StrictMode replays effects. Release only a genuinely unmounted session.
  const pendingClose = useRef(new Map<typeof client, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    clearTimeout(pendingClose.current.get(client));
    pendingClose.current.delete(client);
    const timers = pendingClose.current;
    return () => { timers.set(client, setTimeout(() => {
      timers.delete(client);
      void client.close().catch(error => console.warn("Unable to close editor documents", error));
    }, 0)); };
  }, [client]);
  return client;
}
