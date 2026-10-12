import { isStandaloneLatexDocument, latexDocumentLinks, latexDocumentPathCandidates, latexHeadingFields, maskLatexComments } from "@latex-editor/editor-core/latex-source";

export interface ReferenceTarget { path: string; offset: number; label: string }
interface ReferenceDocument { path: string; content: string }
interface ParsedFile { content: string; labels: Map<string, ReferenceTarget[]>; includes: string[][]; external: Array<{ path: string; prefix: string }>; standalone: boolean }

export function sourceLabelOffset(source: string, label: string): number | undefined {
  for (const match of maskLatexComments(source).matchAll(/(?<!\\)\\label\s*\{([^{}\r\n]+)\}/g)) if (match[1]?.trim() === label) return match.index;
}

const sourcePath = (path: string) => path.replaceAll("\\", "/").replace(/^\.\//, "");

/** File-aware label namespaces shared by clicks, navigation history and completion. */
export class ProjectReferenceIndex {
  private files = new Map<string, ParsedFile>();
  private namespaces = new Map<string, Map<string, ReferenceTarget[]>>();
  private mainFile: string | undefined;

  update(documents: ReferenceDocument[], mainFile?: string): void {
    const nextMain = mainFile ? sourcePath(mainFile) : undefined;
    let changed = nextMain !== this.mainFile;
    this.mainFile = nextMain;
    const live = new Set<string>();
    for (const document of documents) {
      const path = sourcePath(document.path);
      if (!/\.(?:tex|sty|cls|def|cfg|ltx)$/i.test(path)) continue;
      live.add(path);
      if (this.files.get(path)?.content === document.content) continue;
      const masked = maskLatexComments(document.content), labels = new Map<string, ReferenceTarget[]>();
      for (const match of masked.matchAll(/(?<!\\)\\label\s*\{([^{}\r\n]+)\}/g)) {
        const label = match[1]!.trim();
        if (!label || /[\\#]/.test(label)) continue;
        const targets = labels.get(label) ?? [];
        targets.push({ path, offset: match.index, label }); labels.set(label, targets);
      }
      const links = latexDocumentLinks(document.content);
      const includes = links.filter(link => link.kind === "include").map(link => {
        const extension = /\.(sty|cls|def|cfg|ltx)$/i.exec(link.path)?.[0];
        return extension ? latexDocumentPathCandidates(path, link.path.slice(0, -extension.length)).map(candidate => candidate.slice(0, -4) + extension) : latexDocumentPathCandidates(path, link.path);
      });
      // Local packages and classes can hold \externaldocument declarations too.
      for (const field of latexHeadingFields(document.content, ["usepackage", "RequirePackage", "documentclass", "LoadClass"])) {
        const suffix = field.command === "documentclass" || field.command === "LoadClass" ? ".cls" : ".sty";
        const directory = path.split("/").slice(0, -1).join("/");
        for (const name of field.body.value.split(",")) {
          const value = name.trim().replace(/\.(?:cls|sty)$/i, "") + suffix;
          if (!value || /[\\#{}]|^\//.test(value)) continue;
          includes.push([value, directory ? `${directory}/${value}` : value]);
        }
      }
      this.files.set(path, { content: document.content, labels, includes, external: links.filter(link => link.kind === "external").map(link => ({ path: link.path, prefix: link.prefix ?? "" })), standalone: isStandaloneLatexDocument(document.content) });
      changed = true;
    }
    for (const path of this.files.keys()) if (!live.has(path)) { this.files.delete(path); changed = true; }
    if (changed) this.namespaces.clear();
  }

  private included(root: string): string[] {
    const seen = new Set<string>();
    const visit = (path: string) => {
      if (seen.has(path) || !this.files.has(path)) return;
      seen.add(path);
      const file = this.files.get(path)!;
      // Candidate pairs are root-first, as in the compiler's TEXINPUTS search.
      for (const candidates of file.includes) {
        const target = candidates.find(candidate => this.files.has(candidate));
        if (target) visit(target);
      }
    };
    visit(root); return [...seen];
  }

  documentFiles(path: string): string[] { return this.included(sourcePath(path)); }

  visible(path: string): Map<string, ReferenceTarget[]> {
    path = sourcePath(path);
    const cached = this.namespaces.get(path);
    if (cached) return cached;
    const preferred = this.mainFile && this.included(this.mainFile).includes(path) ? [this.mainFile] : [];
    const owners = preferred.length ? preferred : [...this.files].filter(([root, file]) => file.standalone && this.included(root).includes(path)).map(([root]) => root);
    if (!owners.length) owners.push(path);
    const labels = new Map<string, ReferenceTarget[]>();
    const merge = (file: string, prefix = "") => {
      for (const [key, targets] of this.files.get(file)?.labels ?? []) {
        const all = labels.get(prefix + key) ?? [];
        for (const target of targets) if (!all.some(value => value.path === target.path && value.offset === target.offset)) all.push(target);
        labels.set(prefix + key, all);
      }
    };
    for (const owner of owners) {
      const included = this.included(owner);
      for (const file of included) merge(file);
      for (const file of included) for (const link of this.files.get(file)!.external) {
        const target = latexDocumentPathCandidates(file, link.path).find(candidate => this.files.has(candidate));
        if (target) for (const externalFile of this.included(target)) merge(externalFile, link.prefix);
      }
    }
    this.namespaces.set(path, labels); return labels;
  }

  resolve(path: string, label: string): ReferenceTarget | undefined {
    const targets = this.visible(path).get(label.trim());
    // A duplicate label is ambiguous; never jump to an unrelated arbitrary match.
    return targets?.length === 1 ? targets[0] : undefined;
  }
}
