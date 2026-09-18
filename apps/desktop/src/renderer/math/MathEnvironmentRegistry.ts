export interface MathEnvironmentDefinition {
  name: string;
  displayMode: boolean;
}

const definitions: MathEnvironmentDefinition[] = [
  "equation", "equation*", "align", "align*", "aligned", "gather", "gather*",
  "multline", "multline*", "split", "cases"
].map((name) => ({ name, displayMode: true }));

/** Central registry used by parsing, Preview editing, and source live preview. */
export const MATH_ENVIRONMENTS = new Map(definitions.map((definition) => [definition.name, definition]));

export function isMathEnvironment(name: string): boolean {
  return MATH_ENVIRONMENTS.has(name);
}
