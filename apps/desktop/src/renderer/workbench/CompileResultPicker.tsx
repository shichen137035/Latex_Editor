import type { CompileResult } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";

export function CompileResultPicker({ results, selected, onSelect }: { results: CompileResult[]; selected?: CompileResult | undefined; onSelect(result: CompileResult): void }) {
  if (results.length < 2) return null;
  return <select className="compile-result-picker" aria-label={t("build.logFile")} value={selected?.mainFile ?? ""} onChange={event => { const result = results.find(item => item.mainFile === event.target.value); if (result) onSelect(result); }}>{results.map(result => <option key={result.mainFile} value={result.mainFile}>{result.status === "succeeded" ? "✓" : "!"} {result.mainFile}</option>)}</select>;
}
