import { latexDocumentLinks, latexDocumentPathCandidates } from "@latex-editor/editor-core/latex-source";

/** Build xr/xr-hyper dependencies before their consumers, including links in input files. */
export async function externalDocumentPlan(target: string, readSource: (path: string) => Promise<string | undefined>): Promise<string[]> {
  const sources = new Map<string, string | undefined>();
  const read = async (path: string) => {
    if (!sources.has(path)) sources.set(path, await readSource(path));
    return sources.get(path);
  };
  const external = async (file: string, included = new Set<string>()): Promise<string[]> => {
    if (included.has(file)) return [];
    included.add(file);
    const source = await read(file);
    if (source === undefined) return [];
    const dependencies: string[] = [];
    for (const link of latexDocumentLinks(source)) {
      for (const path of latexDocumentPathCandidates(file, link.path)) {
        if (await read(path) === undefined) continue;
        if (link.kind === "external") dependencies.push(path);
        else dependencies.push(...await external(path, included));
        break;
      }
    }
    return [...new Set(dependencies)];
  };
  const ordered: string[] = [], visited = new Set<string>(), visiting = new Set<string>();
  let cyclic = false;
  const visit = async (file: string) => {
    if (visiting.has(file)) { cyclic = true; return; }
    if (visited.has(file)) return;
    visiting.add(file);
    for (const dependency of await external(file)) await visit(dependency);
    visiting.delete(file); visited.add(file); ordered.push(file);
  };
  await visit(target);
  // A fresh mutual reference needs auxiliary labels from both documents first.
  return cyclic ? [...ordered, ...ordered] : ordered;
}
