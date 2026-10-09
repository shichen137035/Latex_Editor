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
  /** Original parser identity when the renderer reuses a stable visual identity. */
  parserId?: string;
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
  /** Exact range of this block's own label command, never a child's label. */
  labelSource?: SourceSpan;
  autoLabel?: boolean;
  children: PreviewNode[];
}

export interface ContentRegion extends PreviewBaseNode {
  kind: "content";
  contentType: "paragraph" | "plain" | "other" | "directive" | "spacer";
  directiveId?: string;
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
  /** Header title typography; absent values use the environment catalog defaults. */
  titleFontFamily?: string;
  titleFontSize?: number;
  titleFontWeight?: number;
  titleLineHeight?: number;
  titleLetterSpacing?: number;
  captionFontSize?: number;
  imageMaxHeightVh?: number;
  imageGridMinWidth?: number;
  imageGridGap?: number;
  tableCellMaxHeightEm?: number;
  tableEditorMaxHeight?: number;
  tableExpandedFontSize?: number;
}

export type EnvironmentRenderer = "auto" | "content" | "math" | "code" | "list" | "figure" | "table";

export interface EnvironmentBehavior {
  inlineEditable: boolean;
  allowChildren: boolean;
  showHeader: boolean;
  showLabel: boolean;
  /** Show the source optional argument's brackets in the block heading. */
  showOptionBrackets?: boolean;
  renderer?: EnvironmentRenderer;
  showCaption?: boolean;
  captionEditable?: boolean;
  imageClickAction?: "settings" | "replace" | "source" | "inspect";
  tableToolbar?: "selected" | "always" | "hidden";
  allowExpandedEditor?: boolean;
  expandedToolbar?: boolean;
}

export interface EnvironmentDefinition {
  id: string;
  enabled: boolean;
  builtIn: boolean;
  match: EnvironmentMatchRule;
  labelKey: string;
  /** Names by locale. Blank entries are absent; display resolution belongs to the UI. */
  labels?: Record<string, string>;
  /** Original/default name, also retained as a fallback for existing authored names. */
  label?: string;
  family: "section" | "theorem" | "definition" | "proof" | "equation" | "remark" | "example" | "figure" | "table" | "list" | "quote" | "code" | "virtual" | "generic";
  style: EnvironmentStyle;
  behavior: EnvironmentBehavior;
}

export interface PreviewDocument {
  filePath: string;
  nodes: PreviewNode[];
  diagnostics: string[];
  title?: { title?: string; author?: string; date?: string; source: SourceSpan; bodySource: SourceSpan };
}

export interface PreviewInteractionState {
  selectedBlockId?: string;
  editingNodeId?: string;
}
