import type { ImagePreferences } from "@latex-editor/contracts";
import { automaticSubfigureWidth, gridDimension } from "./layout.js";

function stem(path: string): string {
  return path.replaceAll("\\", "/").split("/").at(-1)?.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9:_-]+/g, "-").replace(/^-|-$/g, "") || "image";
}

export function imageInsertion(path: string, preferences: ImagePreferences, type = preferences.defaultInsert.type): { text: string; cursorOffset: number } {
  const width = preferences.defaultInsert.width.trim();
  const graphic = `\\includegraphics${width ? `[width=${width}]` : ""}{${path}}`;
  if (type === "inline") return { text: graphic, cursorOffset: graphic.length };
  const lines = [`\\begin{figure}[${preferences.defaultInsert.placement}]`];
  if (preferences.defaultInsert.alignment === "center") lines.push("  \\centering");
  else if (preferences.defaultInsert.alignment === "left") lines.push("  \\raggedright");
  else lines.push("  \\raggedleft");
  lines.push(`  ${graphic}`);
  let cursorOffset = lines.join("\n").length;
  if (preferences.defaultInsert.addCaption) {
    lines.push("  \\caption{}");
    cursorOffset = lines.join("\n").length - 1;
  }
  if (preferences.defaultInsert.addLabel) lines.push(`  \\label{${preferences.defaultInsert.labelPrefix}:${stem(path)}}`);
  lines.push("\\end{figure}");
  return { text: lines.join("\n"), cursorOffset };
}

/** Creates a valid editable figure shell whose image path can be selected later. */
export function emptyFigureInsertion(preferences: ImagePreferences): { text: string; cursorOffset: number } {
  const insertion = imageInsertion("", { ...preferences, defaultInsert: { ...preferences.defaultInsert, addLabel: false } }, "figure");
  return { ...insertion, cursorOffset: insertion.text.indexOf("{}") + 1 };
}

export function multiImageInsertion(paths: string[], preferences: ImagePreferences): { text: string; cursorOffset: number } {
  if (paths.length <= 1) return imageInsertion(paths[0] ?? "figures/image.png", preferences, "figure");
  const configured = preferences.multiFigure.defaultColumns;
  const columns = configured === "auto" ? Math.min(3, paths.length) : configured;
  const width = preferences.multiFigure.subfigureWidth === "auto" ? automaticSubfigureWidth(columns) : preferences.multiFigure.subfigureWidth;
  const lines = [`\\begin{figure}[${preferences.defaultInsert.placement}]`, "  \\centering"];
  paths.forEach((path, index) => {
    lines.push(`  \\begin{subfigure}{${width}}`, "    \\centering", `    \\includegraphics[width=${preferences.multiFigure.imageWidth}]{${path}}`);
    if (preferences.defaultInsert.addCaption) lines.push("    \\caption{}");
    if (preferences.defaultInsert.addLabel) lines.push(`    \\label{${preferences.defaultInsert.labelPrefix}:${stem(path)}}`);
    lines.push("  \\end{subfigure}");
    if ((index + 1) % columns !== 0 && index < paths.length - 1) lines.push(`  ${preferences.multiFigure.horizontalGap}`);
    else if (index < paths.length - 1) lines.push(`  \\[${preferences.multiFigure.verticalGap}]`);
  });
  lines.push("  \\caption{}", "\\end{figure}");
  const text = lines.join("\n");
  return { text, cursorOffset: text.lastIndexOf("\\caption{") + "\\caption{".length };
}

export function emptyMultiImageInsertion(rows: number, columns: number, preferences: ImagePreferences): { text: string; cursorOffset: number } {
  const safeRows = gridDimension(rows);
  const safeColumns = gridDimension(columns);
  const count = safeRows * safeColumns;
  const width = preferences.multiFigure.subfigureWidth === "auto" ? automaticSubfigureWidth(safeColumns) : preferences.multiFigure.subfigureWidth;
  const lines = [`\\begin{figure}[${preferences.defaultInsert.placement}]`, "  \\centering"];
  for (let index = 0; index < count; index += 1) {
    lines.push(`  \\begin{subfigure}{${width}}`, "    \\centering", `    \\includegraphics[width=${preferences.multiFigure.imageWidth}]{}`, "    \\caption{}", "  \\end{subfigure}");
    if ((index + 1) % safeColumns !== 0 && index < count - 1) lines.push(`  ${preferences.multiFigure.horizontalGap}`);
    else if (index < count - 1) lines.push(`  \\[${preferences.multiFigure.verticalGap}]`);
  }
  lines.push("  \\caption{}", "\\end{figure}");
  const text = lines.join("\n");
  return { text, cursorOffset: text.indexOf("{}") + 1 };
}

/** Makes generated labels deterministic without colliding with the document. */
export function uniqueFigureLabels(insertion: { text: string; cursorOffset: number }, documentSource: string): { text: string; cursorOffset: number } {
  const used = new Set([...documentSource.matchAll(/\\label\{([^{}]+)\}/g)].map((match) => match[1] ?? ""));
  let cursorOffset = insertion.cursorOffset;
  const text = insertion.text.replace(/\\label\{([^{}]+)\}/g, (full, proposed: string, offset: number) => {
    let candidate = proposed;
    let suffix = 2;
    while (used.has(candidate)) { candidate = `${proposed}-${suffix}`; suffix += 1; }
    used.add(candidate);
    const replacement = `\\label{${candidate}}`;
    if (offset < insertion.cursorOffset) cursorOffset += replacement.length - full.length;
    return replacement;
  });
  return { text, cursorOffset };
}
