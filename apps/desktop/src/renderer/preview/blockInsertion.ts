/** Keep generated blocks on separate lines without accumulating blank lines. */
export function separatedBlockInsertion(source: string, start: number, end: number, content: string): { text: string; prefixLength: number } {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const before = source.slice(0, start);
  const after = source.slice(end);
  const trailing = (value: string) => (value.match(/(?:\r?\n[\t ]*)+$/)?.[0].match(/\n/g) ?? []).length;
  const leading = (value: string) => (value.match(/^(?:[\t ]*\r?\n)+/)?.[0].match(/\n/g) ?? []).length;
  const prefix = before.trim() ? newline.repeat(Math.max(0, 2 - trailing(before) - leading(content))) : "";
  const suffix = after.trim() ? newline.repeat(Math.max(0, 2 - trailing(content) - leading(after))) : "";
  return { text: prefix + content + suffix, prefixLength: prefix.length };
}
