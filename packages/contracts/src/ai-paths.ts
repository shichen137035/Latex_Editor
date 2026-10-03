/** Ordinary AI file changes stay out of TeXWeave's private metadata. */
export function isAIEditableProjectPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || normalized.includes("\0")) return false;
  const parts = normalized.toLowerCase().split("/");
  return parts.every((part) => part && part !== "." && part !== ".."
    && ![".texweave", ".latex-editor", ".git", "node_modules"].includes(part));
}

/** Structure metadata remains possible as an explicit, manually reviewed edit. */
export function isAIStructureMetadataPath(path: string): boolean {
  return /^\.texweave\/(?:structure|block-graph)\.json$/i.test(path.replaceAll("\\", "/"));
}

export function isAIReviewableProjectPath(path: string): boolean {
  return isAIEditableProjectPath(path) || isAIStructureMetadataPath(path);
}
