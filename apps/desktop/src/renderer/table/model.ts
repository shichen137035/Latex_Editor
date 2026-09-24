export interface TableSourceRange { start: number; end: number }
export type TableEditableLevel = "full" | "partial" | "source-only";
export type TableStylePreset = "booktabs-three-line" | "grid" | "horizontal" | "plain" | "header-bottom" | "custom";

export interface TableColumn {
  id: string;
  index: number;
  alignment: "left" | "center" | "right" | "paragraph" | "middle" | "bottom" | "custom";
  width?: string;
  rawSpec: string;
}

export interface TableCell {
  id: string;
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  content: string;
  alignment?: string;
  sourceRange: TableSourceRange;
}

export interface TableRow {
  id: string;
  index: number;
  role: "header" | "body";
  sourceRange: TableSourceRange;
  cells: TableCell[];
}

export interface TableBorder {
  id: string;
  orientation: "horizontal" | "vertical";
  position: number;
  start: number;
  end: number;
  semanticRole: "top" | "header-separator" | "body" | "bottom" | "custom";
  preferredSyntax: "booktabs" | "hline" | "cline" | "custom";
  command: string;
  sourceRange?: TableSourceRange;
}

export interface TabularObject {
  id: string;
  environment: "tabular" | "tabular*" | "tabularx" | "longtable" | "array" | "custom";
  columnSpec: string;
  columnSpecRange: TableSourceRange;
  columns: TableColumn[];
  rows: TableRow[];
  cells: TableCell[];
  borders: TableBorder[];
  style: TableStylePreset;
  sourceRange: TableSourceRange;
  bodyRange: TableSourceRange;
  editableLevel: TableEditableLevel;
  diagnostics: string[];
}

export interface TableObject {
  id: string;
  environment: "table" | "table*" | "none";
  placement?: string;
  alignment: "left" | "center" | "right" | "custom";
  caption?: string;
  label?: string;
  sourceRange: TableSourceRange;
  tabular: TabularObject;
}

export type TableSelection = {
  fileId: string;
  start: number;
  end: number;
  source: string;
  kind: "table" | "cell" | "row" | "column";
  row?: number;
  column?: number;
};

export interface TablePatch {
  caption?: string;
  label?: string;
  placement?: string;
  alignment?: TableObject["alignment"];
  cell?: { row: number; column: number; content: string };
}
