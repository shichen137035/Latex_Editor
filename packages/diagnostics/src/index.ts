import { isAbsolute, relative, sep } from "node:path";
import type { Diagnostic } from "@latex-editor/contracts";

function projectRelative(file: string, projectRoot?: string): string {
  if (projectRoot === undefined || !isAbsolute(file)) return file.replaceAll("\\", "/");
  const candidate = relative(projectRoot, file);
  if (candidate === ".." || candidate.startsWith(`..${sep}`)) return file;
  return candidate.split(sep).join("/");
}

/** 解析常见 TeX/latexmk 日志；未知行被保留在编译日志中但不会阻塞解析。 */
export function parseLatexDiagnostics(output: string, projectRoot?: string, defaultFile?: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split(/\r?\n/);
  const defaultLocation = defaultFile === undefined ? {} : { file: projectRelative(defaultFile, projectRoot) };
  const inputLine = (value: string): number | undefined => {
    const match = /(?:on input line|at lines?)\s+(\d+)/i.exec(value);
    return match?.[1] === undefined ? undefined : Number(match[1]);
  };
  let pendingTexError: { message: string; rawExcerpt: string } | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fileLine = /^(.*?\.tex):(\d+):(?:(\d+):)?\s*(.+)$/.exec(line);
    if (fileLine !== null) {
      const message = fileLine[4]?.trim() ?? "LaTeX error";
      diagnostics.push({
        severity: "error",
        source: "latex",
        ...(/File [`'][^`']+[`'] not found/.test(message) ? { code: "MISSING_FILE" } : {}),
        message,
        file: projectRelative(fileLine[1] ?? "", projectRoot),
        line: Number(fileLine[2]),
        ...(fileLine[3] === undefined ? {} : { column: Number(fileLine[3]) }),
        rawExcerpt: line
      });
      pendingTexError = undefined;
      continue;
    }

    if (line.startsWith("! ")) {
      pendingTexError = { message: line.slice(2).trim(), rawExcerpt: line };
      continue;
    }
    const texLine = /^l\.(\d+)\s*(.*)$/.exec(line.trimStart());
    if (texLine !== null && pendingTexError !== undefined) {
      diagnostics.push({
        severity: "error", source: "latex", message: pendingTexError.message,
        ...defaultLocation, line: Number(texLine[1]), rawExcerpt: `${pendingTexError.rawExcerpt}\n${line}`
      });
      pendingTexError = undefined;
      continue;
    }

    const missingFile = /LaTeX Error: File [`']([^`']+)[`'] not found/.exec(line);
    if (missingFile !== null) {
      diagnostics.push({ severity: "error", source: "latex", code: "MISSING_FILE", message: `Required file or package not found: ${missingFile[1]}`, rawExcerpt: line });
      continue;
    }
    if (/undefined references?|Reference .* undefined/i.test(line)) {
      const lineNumber = inputLine(line);
      diagnostics.push({ severity: "warning", source: "latex", code: "UNDEFINED_REFERENCE", message: line.trim(), ...defaultLocation, ...(lineNumber === undefined ? {} : { line: lineNumber }), rawExcerpt: line });
      continue;
    }
    if (/undefined citations?|Citation .* undefined/i.test(line)) {
      const lineNumber = inputLine(line);
      diagnostics.push({ severity: "warning", source: "latex", code: "UNDEFINED_CITATION", message: line.trim(), ...defaultLocation, ...(lineNumber === undefined ? {} : { line: lineNumber }), rawExcerpt: line });
      continue;
    }
    if (/^(Over|Under)full \\[hv]box/.test(line)) {
      const lineNumber = inputLine(line);
      diagnostics.push({ severity: "warning", source: "latex", code: "BOX_WARNING", message: line.trim(), ...defaultLocation, ...(lineNumber === undefined ? {} : { line: lineNumber }), rawExcerpt: line });
      continue;
    }
    if (/^Latexmk:.*(?:error|failure)/i.test(line)) {
      diagnostics.push({ severity: "error", source: "latexmk", message: line.trim(), rawExcerpt: line });
    }
  }

  if (pendingTexError !== undefined) {
    diagnostics.push({ severity: "error", source: "latex", message: pendingTexError.message, ...defaultLocation, rawExcerpt: pendingTexError.rawExcerpt });
  }

  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.severity}|${diagnostic.message}|${diagnostic.file ?? ""}|${diagnostic.line ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
