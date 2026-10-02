export const projectAvatarPalette = [
  { foreground: "#176ea6", background: "#e2f1fa", hue: 205 },
  { foreground: "#a95c25", background: "#fcebdd", hue: 27 },
  { foreground: "#684aaa", background: "#eee8fb", hue: 270 },
  { foreground: "#167457", background: "#def4e9", hue: 148 },
  { foreground: "#ae4e67", background: "#fbe8ed", hue: 344 },
  { foreground: "#167884", background: "#ddf4f6", hue: 185 },
  { foreground: "#4a5cb3", background: "#e7eafb", hue: 232 },
  { foreground: "#9f448b", background: "#f8e9f4", hue: 315 },
  { foreground: "#946019", background: "#fff1d8", hue: 42 },
  { foreground: "#6d741b", background: "#f0f2dc", hue: 82 }
] as const;

export type ProjectAvatarColor = (typeof projectAvatarPalette)[number]["foreground"];

export function isProjectAvatarColor(value: unknown): value is ProjectAvatarColor {
  return typeof value === "string" && projectAvatarPalette.some((color) => color.foreground === value.toLocaleLowerCase("en-US"));
}

export function projectAvatarLetter(name: string): string {
  const first = Array.from(name.trim())[0];
  const codePoint = first?.codePointAt(0);
  if (!first || codePoint === undefined || codePoint <= 0x1f || codePoint === 0x7f) return "?";
  return Array.from(first.toLocaleUpperCase())[0] ?? "?";
}

function hueDistance(left: number, right: number): number {
  const difference = Math.abs(left - right) % 360;
  return Math.min(difference, 360 - difference);
}

/** Prefer unused hues, then maximize the minimum hue distance from assigned projects. */
export function chooseProjectAvatarColor(usedColors: readonly string[]): ProjectAvatarColor {
  const used = usedColors.flatMap((value) => {
    const color = projectAvatarPalette.find((candidate) => candidate.foreground === value.toLocaleLowerCase("en-US"));
    return color ? [color] : [];
  });
  const usedSet = new Set(used.map((color) => color.foreground));
  const unused = projectAvatarPalette.filter((color) => !usedSet.has(color.foreground));
  const candidates = unused.length ? unused : projectAvatarPalette;
  if (!used.length) return candidates[0]!.foreground;
  return candidates.reduce((best, candidate) => {
    const candidateDistance = Math.min(...used.map((color) => hueDistance(candidate.hue, color.hue)));
    const bestDistance = Math.min(...used.map((color) => hueDistance(best.hue, color.hue)));
    return candidateDistance > bestDistance ? candidate : best;
  }).foreground;
}
