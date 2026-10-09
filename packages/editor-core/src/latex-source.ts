/** Hide unescaped comments while preserving UTF-16 offsets and line endings. */
export function maskLatexComments(source: string): string {
  return source.replace(/\\[\s\S]|%[^\r\n]*/g, token => token.startsWith("%") ? " ".repeat(token.length) : token);
}
