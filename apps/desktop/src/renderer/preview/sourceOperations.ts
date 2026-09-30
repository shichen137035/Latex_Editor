/** Remove a LaTeX environment wrapper while preserving its entire body. */
export function unwrapLatexEnvironment(source: string, environmentName: string): string | undefined {
  const token = /\\(begin|end)\s*\{([^}]+)\}/g;
  let depth = 0;
  let openingStart = -1;
  let openingEnd = -1;
  let match: RegExpExecArray | null;
  while ((match = token.exec(source))) {
    if (match[2] !== environmentName) continue;
    if (match[1] === "begin") {
      depth += 1;
      if (depth === 1) { openingStart = match.index; openingEnd = token.lastIndex; }
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(0, openingStart) + source.slice(openingEnd, match.index) + source.slice(token.lastIndex);
      }
    }
  }
  return undefined;
}
