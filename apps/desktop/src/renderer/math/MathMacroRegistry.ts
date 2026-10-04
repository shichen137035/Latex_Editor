import type { MathContext, ParsedMacroDefinition } from "./types.js";

export interface ProjectMathSource { path: string; content: string }

function readGroup(source: string, start: number, open = "{", close = "}"): { value: string; end: number } | undefined {
  if (source[start] !== open) return undefined;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") { index += 1; continue; }
    if (character === open) depth += 1;
    else if (character === close && --depth === 0) return { value: source.slice(start + 1, index), end: index + 1 };
  }
  return undefined;
}

function whitespace(source: string, start: number): number {
  let index = start;
  while (/\s/.test(source[index] ?? "")) index += 1;
  return index;
}

/** Conservative parser for the declarative macro forms supported by v0.3.1. */
export function parseMacroDefinitions(source: string, sourceFile: string): ParsedMacroDefinition[] {
  const definitions: ParsedMacroDefinition[] = [];
  const pattern = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator)(\*)?/g;
  for (const match of source.matchAll(pattern)) {
    const declaration = match[1] as ParsedMacroDefinition["declaration"] | undefined;
    if (!declaration) continue;
    const sourceStart = match.index ?? 0;
    let cursor = whitespace(source, sourceStart + match[0].length);
    const nameGroup = readGroup(source, cursor);
    if (!nameGroup || !/^\\[A-Za-z@]+$/.test(nameGroup.value.trim())) continue;
    const name = nameGroup.value.trim();
    cursor = whitespace(source, nameGroup.end);
    let argumentCount = 0;
    if (source[cursor] === "[") {
      const count = readGroup(source, cursor, "[", "]");
      if (!count || !/^\d+$/.test(count.value.trim())) continue;
      argumentCount = Number(count.value.trim());
      cursor = whitespace(source, count.end);
    }
    const replacementGroup = readGroup(source, cursor);
    if (!replacementGroup) continue;
    const replacement = declaration === "DeclareMathOperator"
      ? `\\operatorname${match[2] ? "*" : ""}{${replacementGroup.value}}`
      : replacementGroup.value;
    definitions.push({ name, replacement, argumentCount, sourceFile, sourceStart, sourceEnd: replacementGroup.end, declaration });
  }
  return definitions;
}

function normalizePath(path: string): string {
  const output: string[] = [];
  for (const segment of path.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") output.pop(); else output.push(segment);
  }
  return output.join("/");
}

function resolveReference(from: string, reference: string, extension: string): string {
  const directory = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
  const value = reference.includes(".") ? reference : `${reference}${extension}`;
  return normalizePath(`${directory}${value}`);
}

function hashMacroConfiguration(macros: Record<string, string>, operators: Record<string, string>): number {
  let hash = 2166136261;
  for (const [name, replacement] of [...Object.entries(macros), ...Object.entries(operators)].sort(([a], [b]) => a.localeCompare(b))) {
    const value = `${name}\0${replacement}\0`;
    for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

/** Project-scoped registry; one rebuild serves every formula rendering path. */
export class MathMacroRegistry {
  #context: MathContext = { macros: {}, operators: {}, sourceVersion: 0 };
  #definitions: ParsedMacroDefinition[] = [];

  rebuild(sources: ProjectMathSource[], entryFile?: string): MathContext {
    const sourceMap = new Map(sources.map((source) => [normalizePath(source.path).toLocaleLowerCase(), { ...source, path: normalizePath(source.path) }]));
    const macros: Record<string, string> = {};
    const operators: Record<string, string> = {};
    const definitions: ParsedMacroDefinition[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (requestedPath: string) => {
      const key = normalizePath(requestedPath).toLocaleLowerCase();
      const file = sourceMap.get(key);
      if (!file || visiting.has(key) || visited.has(key)) return;
      visiting.add(key);
      const declarations = parseMacroDefinitions(file.content, file.path);
      const events: Array<{ index: number; definition?: ParsedMacroDefinition; dependency?: string }> = declarations.map((definition) => ({ index: definition.sourceStart, definition }));
      const dependencyPattern = /\\(input|include)\s*\{([^}]+)\}|\\usepackage(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
      for (const match of file.content.matchAll(dependencyPattern)) {
        if (match[2]) events.push({ index: match.index ?? 0, dependency: resolveReference(file.path, match[2].trim(), ".tex") });
        else for (const name of (match[3] ?? "").split(",").map((value) => value.trim()).filter(Boolean)) events.push({ index: match.index ?? 0, dependency: resolveReference(file.path, name, ".sty") });
      }
      events.sort((left, right) => left.index - right.index);
      for (const event of events) {
        if (event.dependency) { visit(event.dependency); continue; }
        const definition = event.definition;
        if (!definition) continue;
        if (definition.declaration === "providecommand" && macros[definition.name] !== undefined) continue;
        macros[definition.name] = definition.replacement;
        if (definition.declaration === "DeclareMathOperator") operators[definition.name] = definition.replacement;
        definitions.push(definition);
      }
      visiting.delete(key);
      visited.add(key);
    };

    if (entryFile) visit(entryFile);
    if (!visited.size) for (const source of [...sources].sort((a, b) => a.path.localeCompare(b.path))) visit(source.path);
    this.#definitions = definitions;
    this.#context = { macros, operators, sourceVersion: hashMacroConfiguration(macros, operators) };
    return this.getContext();
  }

  getContext(): MathContext {
    return { macros: { ...this.#context.macros }, operators: { ...this.#context.operators }, sourceVersion: this.#context.sourceVersion };
  }

  getDefinitions(): ParsedMacroDefinition[] { return this.#definitions.map((definition) => ({ ...definition })); }
  getMacros(): Record<string, string> { return { ...this.#context.macros }; }
  get(name: string): string | undefined { return this.#context.macros[name]; }
  has(name: string): boolean { return this.#context.macros[name] !== undefined; }
}
