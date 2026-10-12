import { basename, extname, posix } from "node:path";

export class ExportDependencyError extends Error {
  constructor(readonly paths: string[], readonly needsCompilation = false) {
    super(needsCompilation ? "Compile the main document before exporting dynamically resolved resources." : `Export dependencies could not be resolved: ${paths.join(", ")}`);
  }
}

const graphics = [".pdf", ".png", ".jpg", ".jpeg", ".eps", ".ps", ".mps", ".svg", ".webp", ".tif", ".tiff", ".bmp", ".gif", ".jbig2", ".jb2"];
const sourceExtension = /\.(?:tex|sty|cls|def|cfg|ltx)$/i;
const sourceCommands = new Set(["input", "include", "subfile", "subfileinclude", "externaldocument", "InputIfFileExists", "IfFileExists"]);
const styleCommands = new Map([ ["documentclass", ".cls"], ["LoadClass", ".cls"], ["LoadClassWithOptions", ".cls"], ["usepackage", ".sty"], ["RequirePackage", ".sty"], ["RequirePackageWithOptions", ".sty"], ["bibliographystyle", ".bst"] ]);
const fileCommands = new Set(["lstinputlisting", "verbatiminput", "VerbatimInput", "pgfplotstableread", "addbibresource", "addglobalbib", "addsectionbib", "bibliography", "includegraphics", "includepdf", "pgfimage", "inputminted", "DTLloaddb", "epsfig"]);
const importCommands = new Set(["import", "subimport", "inputfrom", "subinputfrom", "includefrom", "subincludefrom"]);

/** A conservative static closure, augmented by a current TeX recorder when available. */
export async function relatedProjectPaths(mainFile: string, projectPaths: string[], readSource: (path: string) => Promise<string>, recorderInputs: string[] = []): Promise<string[]> {
  const { latexControlSequences, maskLatexComments, readLatexGroup } = await import("@latex-editor/editor-core/latex-source");
  const paths = new Set(projectPaths);
  const canonical = (value: string): string | undefined => {
    const path = posix.normalize(value.replaceAll("\\", "/"));
    if (!path || path === "." || path === ".." || path.startsWith("../") || posix.isAbsolute(path) || /^[A-Za-z]:/.test(path)) return;
    return path;
  };
  const main = canonical(mainFile);
  if (!main || !paths.has(main) || !/\.tex$/i.test(main)) throw new ExportDependencyError([mainFile]);
  const selected = new Set([main, ...recorderInputs.filter(path => paths.has(path))]);
  const sources = new Map<string, string>();
  const constants = new Map<string, string>([["jobname", basename(main, extname(main))]]);
  const expand = (value: string): string => {
    for (let index = 0; index < 8; index++) {
      const next = value.replace(/\\([A-Za-z@]+)\b\s*/g, (token, name: string) => constants.get(name) ?? token);
      if (next === value) break;
      value = next;
    }
    return value.trim().replace(/^"(.*)"$/, "$1");
  };
  const argumentsAt = (source: string, offset: number, count = 1): string[] => {
    const values: string[] = [];
    let cursor = offset;
    while (values.length < count) {
      while (/\s/.test(source[cursor] ?? "") && cursor < source.length) cursor++;
      if (source[cursor] === "[") {
        const optional = readLatexGroup(source, cursor, "[", "]");
        if (!optional) break;
        cursor = optional.end + 1;
        continue;
      }
      const group = readLatexGroup(source, cursor);
      if (!group) break;
      values.push(group.value); cursor = group.end + 1;
    }
    return values;
  };
  let missing = new Set<string>(), dynamic = new Set<string>();
  // Revisit earlier sources when included preambles define paths or constants.
  let previousSize = -1;
  while (previousSize !== selected.size) {
    previousSize = selected.size;
    for (const path of selected) if (sourceExtension.test(path) && !sources.has(path)) sources.set(path, maskLatexComments(await readSource(path)));
    const graphicDirectories = new Set<string>();
    for (const [path, source] of sources) {
      for (const match of source.matchAll(/\\(?:def|gdef|edef)\s*\\([A-Za-z@]+)\s*\{([^{}]*)\}|\\(?:newcommand|renewcommand|providecommand)\*?\s*(?:\{\\([A-Za-z@]+)\}|\\([A-Za-z@]+))\s*\{([^{}]*)\}/g)) {
        constants.set(match[1] ?? match[3] ?? match[4]!, match[2] ?? match[5]!);
      }
      for (const token of latexControlSequences(source)) if (token.name === "graphicspath") {
        const value = argumentsAt(source, token.end)[0] ?? "";
        for (const match of value.matchAll(/\{([^{}]*)\}/g)) {
          const directory = expand(match[1]!);
          for (const candidate of [directory, posix.join(posix.dirname(path), directory)]) {
            const safe = canonical(candidate);
            if (safe) graphicDirectories.add(safe);
          }
        }
      }
    }
    missing = new Set(); dynamic = new Set();
    const add = (file: string, requested: string, suffixes: string[], system = false, image = false, optional = false) => {
      const value = expand(requested);
      if (!value) return;
      if (/[\\{}#]/.test(value)) { dynamic.add(`${file}: ${requested}`); return; }
      const directories = ["", posix.dirname(file), ...(image ? graphicDirectories : [])];
      for (const directory of directories) {
        for (const suffix of extname(value) ? [""] : ["", ...suffixes]) {
          const candidate = canonical(posix.join(directory, value + suffix));
          if (candidate && paths.has(candidate)) {
            selected.add(candidate);
            return;
          }
        }
      }
      if (!optional && (!system || value.includes("/") || extname(value))) missing.add(`${file}: ${requested}`);
    };
    for (const [file, source] of sources) for (const token of latexControlSequences(source)) {
      const name = token.name;
      if (!sourceCommands.has(name) && !styleCommands.has(name) && !fileCommands.has(name) && !importCommands.has(name)) continue;
      const args = argumentsAt(source, token.end, importCommands.has(name) || name === "inputminted" || name === "DTLloaddb" ? 2 : 1);
      if (name === "input" && !args.length) {
        const bare = /^\s*(\\[A-Za-z@]+|[^\s{}\\]+)/.exec(source.slice(token.end))?.[1];
        if (bare) args.push(bare);
      }
      if (!args.length) continue;
      if (importCommands.has(name)) {
        if (args[1]) {
          const target = posix.join(expand(args[0]!), expand(args[1]));
          add(file, name.startsWith("sub") ? posix.join(posix.dirname(file), target) : target, [".tex"]);
        }
      } else if (sourceCommands.has(name)) {
        add(file, name === "externaldocument" ? args[0]!.replace(/\.aux$/i, ".tex") : args[0]!, [".tex"], false, false, name === "IfFileExists" || name === "InputIfFileExists");
      } else if (styleCommands.has(name)) {
        for (const value of args[0]!.split(",")) add(file, value, [styleCommands.get(name)!], true);
      } else if (name === "bibliography") {
        for (const value of args[0]!.split(",")) add(file, value, [".bib"]);
      } else if (/^add(?:bibresource|globalbib|sectionbib)$/.test(name)) add(file, args[0]!, [".bib"]);
      else if (name === "inputminted" || name === "DTLloaddb") { if (args[1]) add(file, args[1], []); }
      else if (name === "epsfig") {
        const value = /(?:^|,)\s*file\s*=\s*([^,}]+)/.exec(args[0]!)?.[1];
        if (value) add(file, value, graphics, false, true);
      } else add(file, args[0]!, graphics, false, name === "includegraphics" || name === "includepdf" || name === "pgfimage");
    }
  }
  if (missing.size) throw new ExportDependencyError([...missing]);
  if (dynamic.size && !recorderInputs.length) throw new ExportDependencyError([...dynamic], true);
  return [...selected].sort();
}
