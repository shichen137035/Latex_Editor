import type { DocumentBlock, DocumentStructure } from "@latex-editor/contracts";

/** Metadata postings keep exact lookups independent of the size of the paper. */
export class BlockQueryIndex {
  readonly blocks: DocumentBlock[];
  readonly #postings = new Map<string, Set<string>>();
  readonly #byId: Record<string, DocumentBlock>;
  constructor(structure: DocumentStructure) {
    this.#byId = structure.blocks;
    this.blocks = Object.values(structure.blocks).filter((block) => block.state === "active");
    const add = (key: string, id: string) => { const bucket = this.#postings.get(key) ?? new Set(); bucket.add(id); this.#postings.set(key, bucket); };
    for (const block of this.blocks) {
      for (const [key, value] of [["type", block.type], ["kind", block.kind], ["origin", block.origin], ["file", block.source.fileId], ["label", block.label], ["number", block.numbering?.display], ["ordinal", block.numbering?.ordinal?.toString()]]) if (value !== undefined) add(`${key}:${value}`, block.id);
      for (const tag of [...(block.semantic?.tags?.user ?? []), ...(block.semantic?.tags?.ai ?? [])]) add(`tag:${tag}`, block.id);
    }
  }
  select(filters: { type?: string[]; kind?: string; origin?: string; file?: string; label?: string; number?: string; ordinal?: number; tags?: string[] }): DocumentBlock[] {
    const buckets: Set<string>[] = [];
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined) continue;
      if (key === "tags") { for (const tag of value as string[]) buckets.push(this.#postings.get(`tag:${tag}`) ?? new Set()); }
      else if (Array.isArray(value)) {
        const union = new Set<string>();
        for (const entry of value) for (const id of this.#postings.get(`${key}:${entry}`) ?? []) union.add(id);
        buckets.push(union);
      } else buckets.push(this.#postings.get(`${key}:${value}`) ?? new Set());
    }
    if (!buckets.length) return this.blocks;
    buckets.sort((a, b) => a.size - b.size);
    return [...buckets[0]!].filter((id) => buckets.every((bucket) => bucket.has(id))).map((id) => this.#byId[id]!);
  }
}
