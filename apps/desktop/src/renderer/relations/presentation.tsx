import type { CSSProperties } from "react";
import type { RelationDirection, SemanticBlock } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { environmentName } from "../i18n/displayNames.js";
import type { EnvironmentDefinition } from "../preview/types.js";
import { environmentColorRoles, environmentDefinition } from "../preview/environment-colors.js";
import { blockRole } from "./model.js";

export function blockColorStyle(block: SemanticBlock, definitions: EnvironmentDefinition[]): CSSProperties {
  const type = blockRole(block);
  const roles = environmentColorRoles(type, environmentDefinition(type, definitions));
  return { "--environment-accent": roles.accent, "--environment-label-bg": roles.labelBackground, "--environment-label-text": roles.labelText, "--environment-border": roles.border } as CSSProperties;
}

export function blockTypeLabel(block: SemanticBlock, definitions: EnvironmentDefinition[]): string {
  const type = blockRole(block), definition = environmentDefinition(type, definitions);
  if (definition) return environmentName(definition);
  const translated = t(`environment.${type}`);
  return translated.startsWith("environment.") ? type : translated;
}

export function EnvironmentBadge({ block, definitions }: { block: SemanticBlock; definitions: EnvironmentDefinition[] }) {
  return <span className="environment-badge" style={blockColorStyle(block, definitions)}>{blockTypeLabel(block, definitions)}</span>;
}

export function EnvironmentDot({ block, definitions }: { block: SemanticBlock; definitions: EnvironmentDefinition[] }) {
  return <i className="environment-dot" style={blockColorStyle(block, definitions)} title={blockTypeLabel(block, definitions)} aria-hidden="true"/>;
}

export function RelationGraphIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m11 6-5 10m7-10 5 10M7 18h10"/><circle cx="12" cy="4" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/></svg>;
}

export function RelationScopeControls({ direction, depth, documentFiltered, segmented = false, onDirection, onDepth, onDocumentFiltered }: {
  direction: RelationDirection; depth: number | "all"; documentFiltered: boolean; segmented?: boolean;
  onDirection(direction: RelationDirection): void; onDepth(depth: number | "all"): void; onDocumentFiltered(enabled: boolean): void;
}) {
  return <div className="relation-scope-controls">
    <div className="relation-scope-field"><span>{t("relation.direction")}</span>{segmented ? <div className="relation-direction" role="group" aria-label={t("relation.direction")}>
      {(["prerequisite", "both", "consequence"] as const).map(value => <button key={value} title={t(`relation.${value}`)} aria-label={t(`relation.${value}`)} aria-pressed={direction === value} className={direction === value ? "active" : ""} onClick={() => onDirection(value)}>{t(`relation.short.${value}`)}</button>)}
    </div> : <select aria-label={t("relation.direction")} value={direction} onChange={event => onDirection(event.target.value as RelationDirection)}>{(["prerequisite", "both", "consequence"] as const).map(value => <option key={value} value={value}>{t(`relation.${value}`)}</option>)}</select>}</div>
    <label className="relation-scope-field"><span>{t("relation.depth")}</span><select aria-label={t("relation.depth")} title={t("relation.depth")} value={String(depth)} onChange={event => onDepth(event.target.value === "all" ? "all" : Number(event.target.value))}>{[1, 2, 3, 4, 5].map(value => <option value={value} key={value}>{value}</option>)}<option value="all">{t("relation.all")}</option></select></label>
    <label className="relation-document-toggle"><input type="checkbox" checked={documentFiltered} onChange={event => onDocumentFiltered(event.target.checked)}/><span className="relation-toggle-track"/><span>{t("relation.filterDocument")}</span></label>
  </div>;
}
