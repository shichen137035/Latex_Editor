import type { DocumentStructure } from "@latex-editor/contracts" with { "resolution-mode": "import" };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, canonical(value)]));
}
function without(value: object, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

/** Only routine snapshot deduplication ignores derived index data; saved objects stay intact. */
export function historyStructureContent(content: string): string | undefined {
  try {
    const structure = JSON.parse(content) as DocumentStructure;
    if (structure?.schemaVersion !== 2 || !structure.blocks || Array.isArray(structure.blocks) || typeof structure.blocks !== "object" || !structure.files || !Array.isArray(structure.roots)) return content;
    const { blocks, dependencies = [], relations = [], unboundBlocks = [] } = structure;
    if (![dependencies, relations, unboundBlocks].every(Array.isArray)) return content;
    const extra = without(structure, ["schemaVersion", "structureRevision", "configurationFingerprint", "numberingFingerprint", "indexDirty", "files", "roots", "blocks", "dependencies", "relations", "relationSchemaVersion", "unboundBlocks"]);
    const significantBlocks = Object.fromEntries(Object.entries(blocks).flatMap(([id, block]) => {
      if (!block || typeof block !== "object") throw new Error("Invalid structure block");
      const metadata = Object.fromEntries(Object.entries(block.metadata ?? {}).filter(([key]) => !["parserFingerprint", "parserParentFingerprint", "parserBindingId", "rangeMappingFailed"].includes(key)));
      const semantic = block.semantic ? {
        ...block.semantic,
        ...(block.semantic.summary ? { summary: without(block.semantic.summary, ["blockRevision"]) } : {}),
        ...(block.semantic.tags ? { tags: without(block.semantic.tags, ["blockRevision"]) } : {})
      } : undefined;
      const annotations = { ...(semantic ? { semantic } : {}), ...(Object.keys(metadata).length ? { metadata } : {}), ...(block.capabilityOverrides ? { capabilityOverrides: block.capabilityOverrides } : {}) };
      if (block.origin === "user") {
        const definition = without(block, ["revision", "identity", "metadata", "semantic"]);
        return [[id, { ...definition, ...annotations }]];
      }
      return Object.keys(annotations).length ? [[id, annotations]] : [];
    }));
    if (!Object.keys(significantBlocks).length && !dependencies.length && !relations.length && !unboundBlocks.length && !Object.keys(extra).length) return undefined;
    return JSON.stringify(canonical({ blocks: significantBlocks, dependencies, relations, unboundBlocks, ...extra }));
  } catch { return content; }
}
