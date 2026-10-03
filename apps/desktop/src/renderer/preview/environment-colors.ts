import type { EnvironmentDefinition } from "./types.js";

const accents: Record<string, string> = {
  chapter: "section", section: "section", subsection: "subsection", subsubsection: "subsubsection", abstract: "section",
  theorem: "theorem", lemma: "lemma", proposition: "proposition", corollary: "corollary",
  definition: "definition", assumption: "assumption", proof: "proof", remark: "remark", example: "example",
  equation: "equation", align: "equation", gather: "equation", multline: "equation", "display-math": "equation",
  figure: "figure", table: "table", tabular: "table", tabularx: "table", longtable: "table",
  algorithm: "code", algorithmic: "code", verbatim: "code", lstlisting: "code",
  itemize: "list", enumerate: "list", description: "list", quote: "quote", quotation: "quote", placeholder: "virtual"
};
const customPalette = ["lemma", "corollary", "definition", "remark", "example", "proposition", "virtual"];
const normalize = (type: string) => type.replace(/^custom:/, "").replace(/(?:-star|\*)$/, "").toLowerCase();

/** Keep colors stable across tree order, graph layout and theme changes. Custom style overrides win. */
export function environmentAccent(type: string, definition?: EnvironmentDefinition): string {
  const key = normalize(type);
  const configured = definition?.style.accentToken;
  if (configured && configured !== `--env-${definition?.family}-accent`) return configured.startsWith("--") ? `var(${configured})` : configured;
  if (accents[key]) return `var(--env-${accents[key]}-accent)`;
  if (definition) return configured?.startsWith("--") ? `var(${configured})` : configured || "var(--env-generic-accent)";
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `var(--env-${customPalette[hash % customPalette.length]}-accent)`;
}

export function environmentDefinition(type: string, definitions: EnvironmentDefinition[]): EnvironmentDefinition | undefined {
  return definitions.find((definition) => definition.id === type || (definition.match.kind === "latex-environment" && definition.match.name === type)
    || (definition.match.kind === "command" && definition.match.command === type) || (definition.match.kind === "virtual-block" && definition.match.type === type));
}
