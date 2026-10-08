import { extname, posix } from "node:path";
import type { AIContextSnapshotFile } from "@latex-editor/contracts" with { "resolution-mode": "import" };

const GRAPHIC_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".eps", ".ps", ".mps", ".svg", ".webp", ".tif", ".tiff", ".bmp", ".gif", ".jbig2", ".jb2"];
const GRAPHIC_COMMANDS = /\\(?:includegraphics|includepdf|pgfimage)\*?\s*(?:\[[^\]]*\]\s*)?\{([^{}]*)\}|\\epsfig\s*\{([^{}]*)\}/g;

export interface GraphicDependencySet {
  resolved: string[];
  unresolved: string[];
}

/** Resolve statically declared project graphics while preserving their TeX-relative paths. */
export function collectGraphicDependencies(files: AIContextSnapshotFile[], projectPaths: string[]): GraphicDependencySet {
  const pathByKey = new Map(projectPaths.map((path) => [normalize(path).toLowerCase(), normalize(path)]));
  const resolved = new Set<string>();
  const unresolved = new Set<string>();
  // A preamble's graphicspath also applies to included chapter files.
  const projectGraphicPaths = files.flatMap(file => readGraphicPaths(stripComments(file.content)).flatMap(path => [safeJoin(posix.dirname(normalize(file.path)), path), safeJoin("", path)]));

  for (const file of files) {
    if (!/\.(?:tex|sty|cls|def|cfg|ltx)$/i.test(file.path)) continue;
    const source = stripComments(file.content);
    const sourceDirectory = posix.dirname(normalize(file.path));
    const searchDirectories = [sourceDirectory, "", ...projectGraphicPaths];
    const graphicPaths = readGraphicPaths(source);
    for (const graphicPath of graphicPaths) {
      searchDirectories.unshift(safeJoin(sourceDirectory, graphicPath), safeJoin("", graphicPath));
    }

    for (const match of source.matchAll(GRAPHIC_COMMANDS)) {
      const raw = (match[1] ?? match[2] ?? "").trim();
      const reference = match[2] === undefined ? raw : (/(?:^|,)\s*file\s*=\s*([^,}]+)/i.exec(raw)?.[1] ?? "").trim();
      if (!reference || reference.includes("\\") || isAbsoluteProjectPath(reference)) continue;
      const candidates = resolveGraphicReference(reference, searchDirectories, pathByKey);
      if (candidates.length) for (const candidate of candidates) resolved.add(candidate);
      else unresolved.add(reference);
    }
  }

  return { resolved: [...resolved].sort(), unresolved: [...unresolved].sort() };
}

function stripComments(source: string): string {
  return source.split(/\r?\n/).map((line) => {
    for (let index = 0; index < line.length; index++) {
      if (line[index] !== "%") continue;
      let backslashes = 0;
      for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor--) backslashes++;
      if (backslashes % 2 === 0) return line.slice(0, index);
    }
    return line;
  }).join("\n");
}

function readGraphicPaths(source: string): string[] {
  const paths: string[] = [];
  const pattern = /\\graphicspath\s*\{((?:\s*\{[^{}]*\}\s*)+)\}/g;
  for (const match of source.matchAll(pattern)) {
    for (const inner of (match[1] ?? "").matchAll(/\{([^{}]*)\}/g)) {
      const value = inner[1]?.trim();
      if (value) paths.push(value);
    }
  }
  return paths;
}

function resolveGraphicReference(reference: string, directories: string[], files: Map<string, string>): string[] {
  const normalizedReference = normalize(reference);
  if (!normalizedReference || normalizedReference === ".") return [];
  const extension = extname(normalizedReference);
  const candidates = new Set<string>();
  for (const directory of directories) {
    const base = safeJoin(directory, normalizedReference);
    if (!base || base.startsWith("../")) continue;
    if (extension) {
      const file = files.get(base.toLowerCase());
      if (file) candidates.add(file);
      continue;
    }
    for (const graphicExtension of GRAPHIC_EXTENSIONS) {
      const file = files.get(`${base}${graphicExtension}`.toLowerCase());
      if (file) candidates.add(file);
    }
  }
  return [...candidates];
}

function normalize(path: string): string { return path.replaceAll("\\", "/").replace(/^\.\//, ""); }
function safeJoin(directory: string, path: string): string { return normalize(posix.join(directory, path)); }
function isAbsoluteProjectPath(path: string): boolean { return path.startsWith("/") || /^[a-z]:/i.test(path); }
