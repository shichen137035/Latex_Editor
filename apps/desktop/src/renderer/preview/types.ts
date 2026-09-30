import type { BlockKind } from "@latex-editor/contracts";

export interface SourceSpan {
  filePath: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface PreviewBaseNode {
  id: string;
  source: SourceSpan;
  parentId?: string;
}

export interface StructuralBlock extends PreviewBaseNode {
  kind: "block";
  semanticKind?: BlockKind;
  body: SourceSpan;
  origin: "latex" | "virtual";
  environmentId: string;
  title?: string;
  latexLabel?: string;
  autoLabel?: boolean;
  children: PreviewNode[];
}

export interface ContentRegion extends PreviewBaseNode {
  kind: "content";
  contentType: "paragraph" | "plain" | "other";
  origin?: "source" | "virtual";
  raw: string;
}

export type PreviewNode = StructuralBlock | ContentRegion;

export type EnvironmentMatchRule =
  | { kind: "latex-environment"; name: string }
  | { kind: "command"; command: string }
  | { kind: "display-math" }
  | { kind: "virtual-block"; type: string }
  | { kind: "custom-pattern"; pattern: string };

export interface EnvironmentStyle {
  accentToken: string;
  fillToken: string;
  labelBackgroundToken: string;
  labelTextToken: string;
  borderToken: string;
  selectedBorderToken: string;
}

export interface EnvironmentBehavior {
  selectable: boolean;
  inlineEditable: boolean;
  allowChildren: boolean;
  showHeader: boolean;
  showLabel: boolean;
  addToOutline: boolean;
}

export interface EnvironmentDefinition {
  id: string;
  enabled: boolean;
  builtIn: boolean;
  match: EnvironmentMatchRule;
  labelKey: string;
  /** User-facing label for custom definitions; built-ins continue to use i18n keys. */
  label?: string;
  family: "section" | "theorem" | "definition" | "proof" | "equation" | "remark" | "example" | "figure" | "table" | "list" | "quote" | "code" | "virtual" | "generic";
  style: EnvironmentStyle;
  behavior: EnvironmentBehavior;
}

export interface PreviewDocument {
  filePath: string;
  nodes: PreviewNode[];
  diagnostics: string[];
  title?: { title?: string; author?: string; date?: string };
}

export interface PreviewInteractionState {
  selectedBlockId?: string;
  editingNodeId?: string;
}
