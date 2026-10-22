import type { PreviewDocument, SourceSpan } from "./types.js";

export function PreviewDiagnostics({ document, heading, onLocate }: {
  document: PreviewDocument;
  heading: string;
  onLocate?: ((source: SourceSpan) => void) | undefined;
}) {
  if (!document.diagnostics.length) return null;
  return <aside className="preview-diagnostics" aria-label={heading}>
    <strong>{heading}</strong>
    {document.diagnostics.map((message, index) => {
      const detail = document.diagnosticDetails?.[index];
      const source = detail?.message === message ? detail.source : undefined;
      const location = source ? `${source.filePath}:${source.startLine}:${source.startColumn}` : undefined;
      return <p key={index}>{source && onLocate
        ? <button type="button" className="preview-diagnostic-link" title={location} onClick={() => onLocate(source)}><span>{message}</span><span className="preview-diagnostic-location">{location}</span></button>
        : <>{message}{location && <span className="preview-diagnostic-location">{location}</span>}</>}</p>;
    })}
  </aside>;
}
