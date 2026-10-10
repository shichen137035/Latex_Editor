import type { ProjectTreeNode } from "@latex-editor/contracts";
import { settings } from "../settings/service.js";

export type PaneType = "source" | "preview" | "pdf";
export interface PersistedLayout {
  sidebarWidth: number;
  fileTreeHeight: number;
  splitRatio: number;
  bottomPanelHeight: number;
  sidebarVisible: boolean;
  filesCollapsed?: boolean;
  outlineCollapsed?: boolean;
  mode: "single" | "split";
  singlePane: PaneType;
  leftPane: "source" | "preview";
  rightPane: "preview" | "pdf";
}

export const defaultLayout: PersistedLayout = {
  sidebarWidth: 280, fileTreeHeight: 330, splitRatio: 52, bottomPanelHeight: 220,
  sidebarVisible: true, filesCollapsed: false, outlineCollapsed: false, mode: "split", singlePane: "source", leftPane: "source", rightPane: "pdf"
};

export function restoreLayout(): PersistedLayout {
  const stored = settings.get("layout");
  const number = (value: unknown, fallback: number, minimum: number, maximum: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
  return {
    sidebarWidth: number(stored.sidebarWidth, defaultLayout.sidebarWidth, 210, 480),
    fileTreeHeight: number(stored.fileTreeHeight, defaultLayout.fileTreeHeight, 150, 560),
    splitRatio: number(stored.splitRatio, defaultLayout.splitRatio, 28, 72),
    bottomPanelHeight: number(stored.bottomPanelHeight, defaultLayout.bottomPanelHeight, 120, 420),
    sidebarVisible: typeof stored.sidebarVisible === "boolean" ? stored.sidebarVisible : defaultLayout.sidebarVisible,
    filesCollapsed: typeof stored.filesCollapsed === "boolean" ? stored.filesCollapsed : false,
    outlineCollapsed: typeof stored.outlineCollapsed === "boolean" ? stored.outlineCollapsed : false,
    mode: stored.mode === "single" || stored.mode === "split" ? stored.mode : defaultLayout.mode,
    singlePane: stored.singlePane === "source" || stored.singlePane === "preview" || stored.singlePane === "pdf" ? stored.singlePane : defaultLayout.singlePane,
    leftPane: stored.leftPane === "source" || stored.leftPane === "preview" ? stored.leftPane : defaultLayout.leftPane,
    rightPane: stored.rightPane === "preview" || stored.rightPane === "pdf" ? stored.rightPane : defaultLayout.rightPane
  };
}

export function sourcePositionAtOffset(source: string, offset: number): { lineNumber: number; column: number } {
  const lines = source.slice(0, Math.min(Math.max(0, offset), source.length)).split(/\r\n|\r|\n/);
  return { lineNumber: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

export function sourceOffsetAtLine(source: string, line: number, column = 1): number {
  const expression = /\r\n|\r|\n/g;
  let start = 0;
  for (let index = 1; index < line; index += 1) {
    const newline = expression.exec(source);
    if (!newline) return source.length;
    start = expression.lastIndex;
  }
  const end = source.slice(start).search(/\r\n|\r|\n/);
  return Math.min(start + Math.max(0, column - 1), end < 0 ? source.length : start + end);
}

export function relativeAssetPath(filePath: string, assetPath: string): string {
  const from = filePath.replaceAll("\\", "/").split("/").slice(0, -1);
  const to = assetPath.replaceAll("\\", "/").split("/");
  while (from.length && to.length && from[0]?.toLocaleLowerCase() === to[0]?.toLocaleLowerCase()) { from.shift(); to.shift(); }
  return [...from.map(() => ".."), ...to].join("/");
}

export function projectFilePaths(nodes: ProjectTreeNode[]): string[] {
  return nodes.flatMap((node) => node.kind === "file" ? [node.relativePath] : node.children ? projectFilePaths(node.children) : []);
}
