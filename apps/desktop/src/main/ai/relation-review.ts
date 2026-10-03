/** File diffs cannot bypass the explicit relation proposal/commit boundary. */
export function protectAIRelationMetadata(before: string | undefined, proposed: string | undefined): { content: string | undefined; excluded: boolean } {
  if (before === proposed) return { content: proposed, excluded: false };
  try {
    const original = before === undefined ? {} : JSON.parse(before) as Record<string, unknown>;
    if (proposed === undefined) {
      if ((Array.isArray(original.relations) && original.relations.length) || (Array.isArray(original.dependencies) && original.dependencies.length)) return { content: before, excluded: true };
      return { content: proposed, excluded: false };
    }
    const next = JSON.parse(proposed) as Record<string, unknown>;
    if (!original || !next || typeof original !== "object" || typeof next !== "object" || Array.isArray(next)) return { content: before, excluded: true };
    let excluded = false;
    for (const key of ["dependencies", "relations", "relationSchemaVersion"]) {
      if (JSON.stringify(next[key]) === JSON.stringify(original[key])) continue;
      excluded = true;
      if (Object.hasOwn(original, key)) next[key] = original[key]; else delete next[key];
    }
    if (!excluded) return { content: proposed, excluded: false };
    return { content: JSON.stringify(next) === JSON.stringify(original) ? before : `${JSON.stringify(next, null, 2)}\n`, excluded: true };
  } catch { return { content: before, excluded: true }; }
}
