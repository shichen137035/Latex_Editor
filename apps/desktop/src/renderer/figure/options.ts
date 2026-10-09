import type { GraphicOption } from "./model.js";

function optionRanges(raw: string) {
  const ranges: Array<{ start: number; end: number; segmentStart: number; segmentEnd: number; key: string }> = [];
  let start = 0, braces = 0;
  for (let index = 0; index <= raw.length; index++) {
    const character = raw[index];
    if (character === "\\") { index++; continue; }
    if (character === "{") braces++;
    if (character === "}") braces = Math.max(0, braces - 1);
    if (index < raw.length && (character !== "," || braces > 0)) continue;
    const segment = raw.slice(start, index), trimmed = segment.trim();
    if (trimmed) {
      const offset = start + segment.length - segment.trimStart().length;
      ranges.push({ start: offset, end: offset + trimmed.length, segmentStart: start, segmentEnd: index, key: trimmed.split("=", 1)[0]!.trim().toLowerCase() });
    }
    start = index + 1;
  }
  return ranges;
}

export function parseGraphicOptions(raw: string): GraphicOption[] {
  return optionRanges(raw).map(range => {
    const entry = raw.slice(range.start, range.end), equals = entry.indexOf("=");
    return equals < 0 ? { key: entry, raw: entry } : { key: entry.slice(0, equals).trim(), value: entry.slice(equals + 1).trim(), raw: entry };
  });
}

export function patchGraphicOption(raw: string, key: string, value: string | boolean | undefined): string {
  if (value === undefined) return raw;
  const ranges = optionRanges(raw), index = ranges.findIndex(range => range.key === key.toLowerCase()), existing = ranges[index];
  if (value === false || value === "") {
    if (!existing) return raw;
    if (index < ranges.length - 1) return raw.slice(0, existing.segmentStart) + raw.slice(ranges[index + 1]!.segmentStart);
    return index > 0 ? raw.slice(0, ranges[index - 1]!.segmentEnd) : "";
  }
  const replacement = value === true ? key : `${key}=${value}`;
  if (existing) return raw.slice(0, existing.start) + replacement + raw.slice(existing.end);
  return raw ? `${raw}${raw.trimEnd().endsWith(",") ? "" : ","}${replacement}` : replacement;
}
