import { useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { PreviewDocument } from "./types.js";
import type { PreviewTextChange } from "./incremental.js";
import { PreviewLocalEditor, type PreviewLocalEditorProps } from "./PreviewLocalEditor.js";
import { unsavedChanges } from "../lifecycle/unsavedChanges.js";
import { t } from "../i18n/index.js";

type EditorServices = Pick<PreviewLocalEditorProps, "api" | "projectId" | "tree" | "currentPath" | "definitions" | "mathContext" | "getOpenDocuments" | "onSpellContextMenu" | "onDetectedLanguage" | "onForwardSync">;

/** The title is one source object, without structural block operations. */
export function DocumentTitleEditor({ title, source, services, children, onOpen, onSourceChange }: {
  title: NonNullable<PreviewDocument["title"]>; source: string; services: EditorServices; children: ReactNode;
  onOpen(offset: number): void; onSourceChange(source: string, changes: PreviewTextChange[]): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ value: string; height: number }>();
  const [notice, setNotice] = useState("");
  const range = title.source;
  const open = () => {
    unsavedChanges.commitDrafts(flushSync);
    onOpen(range.startOffset);
    setNotice("");
    setEditing({ value: source.slice(range.startOffset, range.endOffset), height: Math.ceil(root.current?.getBoundingClientRect().height ?? 0) });
  };
  return <div ref={root} className={`preview-title-object${editing ? " editing" : ""}`} data-preview-field onClick={event => event.stopPropagation()}>
    {editing ? <><div className="preview-title-editor-label">{t("preview.documentTitleSource")}</div><PreviewLocalEditor {...services}
      value={editing.value} sourceStartLine={range.startLine} sourceStartOffset={range.startOffset} initialCursorOffset={0} initialHeight={editing.height}
      onCancel={() => { setEditing(undefined); setNotice(""); }} onApply={value => {
        if (source.slice(range.startOffset, range.endOffset) !== editing.value) { setNotice(t("preview.fieldChanged")); return; }
        if (value !== editing.value) onSourceChange(source.slice(0, range.startOffset) + value + source.slice(range.endOffset), [{ from: range.startOffset, to: range.endOffset, insertedText: value }]);
        setEditing(undefined); setNotice("");
      }}/></> : <div className="preview-title-trigger" role="button" tabIndex={0} aria-label={t("preview.editDocumentTitle")} title={t("preview.editDocumentTitle")}
      onClick={open} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); open(); } }}>{children}</div>}
    {notice && <small role="alert">{notice}</small>}
  </div>;
}
