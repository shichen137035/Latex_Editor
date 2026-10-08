import { isAbsolute, relative, sep } from "node:path";
import type { Diagnostic } from "@latex-editor/contracts";

type DiagnosticSource = Diagnostic["source"];
type DiagnosticCategory = NonNullable<Diagnostic["category"]>;
type PendingError = { message: string; raw: string; source: DiagnosticSource; category: DiagnosticCategory; severity: Diagnostic["severity"] };

function projectRelative(file: string, projectRoot?: string): string {
  if (projectRoot === undefined || !isAbsolute(file)) return file.replaceAll("\\", "/");
  const candidate = relative(projectRoot, file);
  if (candidate === ".." || candidate.startsWith(`..${sep}`)) return file;
  return candidate.split(sep).join("/");
}

function categoryFor(message: string): DiagnosticCategory {
  if (/citation|cite(?:key)?/i.test(message)) return "citation";
  if (/reference|label|\bref(?:erence)?s?\b/i.test(message)) return "reference";
  if (/bibliograph|bibtex|biber|\.bib\b|\.bst\b/i.test(message)) return "bibliography";
  if (/font|\bOT1\/|\bT1\/|\bTU\//i.test(message)) return "font";
  if (/encoding|inputenc|unicode character/i.test(message)) return "encoding";
  if (/environment|\\begin|\\end/i.test(message)) return "environment";
  if (/package|class|\.sty\b|\.cls\b/i.test(message)) return "package";
  if (/file|not found|cannot open|couldn't open/i.test(message)) return "file";
  if (/overfull|underfull|box|float|too wide|too high/i.test(message)) return "layout";
  if (/undefined control sequence|unknown command|command/i.test(message)) return "command";
  if (/fatal|emergency stop|engine/i.test(message)) return "engine";
  if (/latexmk|build|compile|rerun/i.test(message)) return "build";
  return "syntax";
}

function sourceForFile(file: string | undefined, current: DiagnosticSource): DiagnosticSource {
  const extension = /\.([^.\\/]+)$/.exec(file ?? "")?.[1]?.toLowerCase();
  if (extension === "sty") return "package";
  if (extension === "cls") return "class";
  if (extension === "bib" || extension === "bst" || extension === "blg") return "bibtex";
  return current;
}

function identifyTool(line: string, previous: DiagnosticSource): DiagnosticSource {
  if (/\bThis is BibTeX\b|\bBibTeX, Version\b/i.test(line)) return "bibtex";
  if (/\bThis is Biber\b|\bINFO - This is Biber\b/i.test(line)) return "biber";
  if (/\bThis is (?:pdfTeX|LuaHBTeX|XeTeX|LuaTeX)\b/i.test(line)) return "engine";
  if (/^Latexmk:/i.test(line)) return "latexmk";
  return previous;
}

function isSummaryLine(line: string): boolean {
  return /There were undefined (?:references|citations)|Rerun to get|Please \(re\)run|Output written on|Transcript written on/i.test(line);
}

/** Parse tool output as multi-line TeX messages, preserving excerpts for review. */
export function parseLatexDiagnostics(output: string, projectRoot?: string, defaultFile?: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split(/\r?\n/);
  const defaultLocation = defaultFile === undefined ? {} : { file: projectRelative(defaultFile, projectRoot) };
  const inputLine = (value: string): number | undefined => {
    const match = /(?:on input line|at lines?)\s+(\d+)/i.exec(value);
    return match?.[1] === undefined ? undefined : Number(match[1]);
  };
  let activeSource: DiagnosticSource = "latex";
  let pending: PendingError | undefined;
  let pendingLocationDiagnostic: Diagnostic | undefined;

  const flushPending = (lineNumber?: number, continuation?: string) => {
    if (!pending) return;
    const rawExcerpt = [pending.raw, continuation].filter(Boolean).join("\n");
    const wrappedMissingFile = /LaTeX Error:\s*File\s+[`'"]([^`'"]+)[`'"]\s+not\s+fou\s*nd/i.exec(rawExcerpt);
    if (wrappedMissingFile) {
      const missingFile = wrappedMissingFile[1] ?? "unknown";
      diagnostics.push({
        severity: "error",
        source: "latex",
        category: /\.sty|\.cls/i.test(missingFile) ? "package" : "file",
        code: "MISSING_FILE",
        message: `Required file or package not found: ${missingFile}`,
        ...defaultLocation,
        ...(lineNumber === undefined ? {} : { line: lineNumber }),
        rawExcerpt
      });
      pending = undefined;
      return;
    }
    diagnostics.push({
      severity: pending.severity,
      source: pending.source,
      category: pending.category,
      message: pending.message,
      ...defaultLocation,
      ...(lineNumber === undefined ? {} : { line: lineNumber }),
      rawExcerpt
    });
    pending = undefined;
  };

  for (const originalLine of lines) {
    const line = originalLine.trimEnd();
    const detectedSource = identifyTool(line, activeSource);
    if (detectedSource !== activeSource) activeSource = detectedSource;

    const fileLine = /^(?:\.?\/)?(.+?\.(?:tex|sty|cls|ltx|bib|bst)):(\d+):(?:(\d+):)?\s*(.+)$/i.exec(line);
    if (fileLine) {
      flushPending();
      const file = projectRelative(fileLine[1] ?? "", projectRoot);
      const message = fileLine[4]?.trim() || "LaTeX error";
      diagnostics.push({
        severity: /fatal|emergency stop/i.test(message) ? "fatal" : "error",
        source: sourceForFile(file, activeSource),
        category: categoryFor(message),
        ...(/File [`'][^`']+[`'] not found/i.test(message) ? { code: "MISSING_FILE" } : {}),
        message,
        file,
        line: Number(fileLine[2]),
        ...(fileLine[3] === undefined ? {} : { column: Number(fileLine[3]) }),
        rawExcerpt: line
      });
      continue;
    }

    if (line.startsWith("! ") && /LaTeX Error: File [`'][^`']+[`'] not found/i.test(line)) {
      flushPending();
      const missingFile = /LaTeX Error: File [`']([^`']+)[`'] not found/i.exec(line);
      pendingLocationDiagnostic = { severity: "error", source: "latex", category: /\.sty|\.cls/i.test(missingFile?.[1] ?? "") ? "package" : "file", code: "MISSING_FILE", message: `Required file or package not found: ${missingFile?.[1] ?? "unknown"}`, ...defaultLocation, rawExcerpt: line };
      diagnostics.push(pendingLocationDiagnostic);
      continue;
    }

    if (line.startsWith("! ")) {
      flushPending();
      const message = line.slice(2).trim();
      pending = {
        message,
        raw: line,
        source: activeSource === "latex" ? "latex" : activeSource,
        category: categoryFor(message),
        severity: /fatal|emergency stop/i.test(message) ? "fatal" : "error"
      };
      continue;
    }

    const texLine = /^\s*l\.(\d+)\s*(.*)$/.exec(line);
    if (texLine && pendingLocationDiagnostic) {
      pendingLocationDiagnostic.line = Number(texLine[1]);
      pendingLocationDiagnostic.rawExcerpt = `${pendingLocationDiagnostic.rawExcerpt ?? ""}\n${line}`;
      pendingLocationDiagnostic = undefined;
      continue;
    }
    if (texLine && pending) {
      flushPending(Number(texLine[1]), line);
      continue;
    }
    if (pending && line.trim() && !/^\s*(?:\?|\*|! )/.test(line)) pending.raw += `\n${line}`;

    const packageMessage = /^(?:Package\s+([^\s]+)|Class\s+([^\s]+))\s+(Warning|Error):\s*(.*)$/i.exec(line.trim());
    if (packageMessage) {
      const isClass = Boolean(packageMessage[2]);
      const kind = packageMessage[3]?.toLowerCase();
      const message = packageMessage[4]?.trim() ?? line.trim();
      const locationLine = inputLine(line);
      diagnostics.push({
        severity: kind === "error" ? "error" : "warning",
        source: isClass ? "class" : "package",
        category: categoryFor(message),
        message,
        ...defaultLocation,
        ...(locationLine === undefined ? {} : { line: locationLine }),
        rawExcerpt: line
      });
      continue;
    }

    const bibtexMissingDatabase = /I couldn't open database file\s+(.+?)(?:\s|$)/i.exec(line);
    if (bibtexMissingDatabase) diagnostics.push({ severity: "error", source: "bibtex", category: "bibliography", code: "BIB_DATABASE_NOT_FOUND", message: `BibTeX could not open database file ${bibtexMissingDatabase[1]}`, rawExcerpt: line });
    const bibtexMissingStyle = /I couldn't open style file\s+(.+?)(?:\s|$)/i.exec(line);
    if (bibtexMissingStyle) diagnostics.push({ severity: "error", source: "bibtex", category: "bibliography", code: "BIB_STYLE_NOT_FOUND", message: `BibTeX could not open style file ${bibtexMissingStyle[1]}`, rawExcerpt: line });
    const missingEntry = /Warning--I didn't find a database entry for ["'](.+?)["']/i.exec(line);
    if (missingEntry) diagnostics.push({ severity: "warning", source: "bibtex", category: "citation", code: "MISSING_CITATION_KEY", message: `No bibliography entry found for ${missingEntry[1]}`, rawExcerpt: line });

    const biberError = /^\s*ERROR\s*-\s*(.+)$/i.exec(line);
    if (biberError) diagnostics.push({ severity: "error", source: "biber", category: /\.bib|\.bcf|\.biblatex/i.test(line) ? "bibliography" : "build", message: biberError[1]?.trim() || line.trim(), rawExcerpt: line });
    const biberWarning = /^\s*WARN\s*-\s*(.+)$/i.exec(line);
    if (biberWarning) diagnostics.push({ severity: "warning", source: "biber", category: "bibliography", message: biberWarning[1]?.trim() || line.trim(), rawExcerpt: line });

    if (/LaTeX Error: File [`'][^`']+[`'] not found/i.test(line)) {
      const missingFile = /LaTeX Error: File [`']([^`']+)[`'] not found/i.exec(line);
      diagnostics.push({ severity: "error", source: "latex", category: /\.sty|\.cls/i.test(missingFile?.[1] ?? "") ? "package" : "file", code: "MISSING_FILE", message: `Required file or package not found: ${missingFile?.[1] ?? "unknown"}`, rawExcerpt: line });
      continue;
    }
    if (/undefined references?|Reference .* undefined/i.test(line) && !isSummaryLine(line)) {
      const lineNumber = inputLine(line);
      diagnostics.push({ severity: "warning", source: activeSource === "latex" ? "latex" : activeSource, category: "reference", code: "UNDEFINED_REFERENCE", message: line.trim(), ...defaultLocation, ...(lineNumber === undefined ? {} : { line: lineNumber }), rawExcerpt: line });
      continue;
    }
    if (/undefined citations?|Citation .* undefined/i.test(line) && !isSummaryLine(line)) {
      const lineNumber = inputLine(line);
      diagnostics.push({ severity: "warning", source: activeSource === "latex" ? "latex" : activeSource, category: "citation", code: "UNDEFINED_CITATION", message: line.trim(), ...defaultLocation, ...(lineNumber === undefined ? {} : { line: lineNumber }), rawExcerpt: line });
      continue;
    }
    if (/^(Over|Under)full \\[hv]box/.test(line.trim())) {
      const lineNumber = inputLine(line);
      diagnostics.push({ severity: "warning", source: "latex", category: "layout", code: "BOX_WARNING", message: line.trim(), ...defaultLocation, ...(lineNumber === undefined ? {} : { line: lineNumber }), rawExcerpt: line });
      continue;
    }
    if (/^Latexmk:.*(?:error|failure|failed)/i.test(line)) diagnostics.push({ severity: "error", source: "latexmk", category: "build", message: line.trim(), rawExcerpt: line });
    if (/^Emergency stop\./i.test(line.trim())) diagnostics.push({ severity: "fatal", source: activeSource, category: "engine", code: "EMERGENCY_STOP", message: "LaTeX stopped after a fatal error", ...defaultLocation, rawExcerpt: line });
  }
  flushPending();

  const hasSpecificError = diagnostics.some((item) => item.severity === "error" || item.severity === "fatal");
  const withoutCascade = diagnostics.filter((item) => !(hasSpecificError && item.code === "EMERGENCY_STOP"));
  const hasReferenceDetails = withoutCascade.some((item) => item.code === "UNDEFINED_REFERENCE");
  const hasCitationDetails = withoutCascade.some((item) => item.code === "UNDEFINED_CITATION" || item.code === "MISSING_CITATION_KEY");
  const filteredSummaries = withoutCascade.filter((item) => {
    if (hasReferenceDetails && /There were undefined references/i.test(item.message)) return false;
    if (hasCitationDetails && /There were undefined citations/i.test(item.message)) return false;
    return true;
  });

  const merged = new Map<string, Diagnostic>();
  for (const item of filteredSummaries) {
    const key = `${item.severity}|${item.source}|${item.code ?? ""}|${item.message}|${item.file ?? ""}|${item.line ?? ""}`;
    const existing = merged.get(key);
    if (existing && item.code === "BOX_WARNING") existing.occurrences = (existing.occurrences ?? 1) + 1;
    else if (!existing) merged.set(key, item);
  }
  return [...merged.values()];
}
