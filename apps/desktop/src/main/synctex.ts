import { execFile } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SyncTexPdfPosition, SyncTexSourcePosition } from "@latex-editor/contracts" with { "resolution-mode": "import" };

type ToolOptions = { root: string; pdfPath: string; mainFile?: string | undefined; compilerArguments?: string[]; binDirectory?: string; latexmk?: string };
const noMatch = () => new Error("SYNCTEX_NO_MATCH: No corresponding document position was found.");

/** Keep repeated results separate; lower-case h/v are coordinates, upper-case H/W are sizes. */
export function syncTexRecords(output: string): Record<string, string>[] {
  const records: Record<string, string>[] = [];
  let record: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!, value = match[2]!.trim();
    if ((key === "Output" || key === "Input") && key in record) { records.push(record); record = {}; }
    record[key] = value;
  }
  records.push(record);
  return records;
}

export function parseForwardSync(output: string): SyncTexPdfPosition {
  for (const record of syncTexRecords(output)) {
    const page = Number(record.Page), x = Number(record.x ?? record.h), y = Number(record.y ?? record.v);
    if (Number.isInteger(page) && page > 0 && Number.isFinite(x) && Number.isFinite(y)) return { page, x, y };
  }
  throw noMatch();
}

function inside(root: string, path: string): boolean {
  const local = relative(root, path);
  return local !== ".." && !local.startsWith(".." + sep) && !isAbsolute(local);
}

async function run(input: ToolOptions, args: string[]): Promise<string> {
  const { compilerEnvironment, findSyncTexData, syncTexDirectories } = await import("@latex-editor/compiler-latexmk");
  const data = await findSyncTexData(input.pdfPath, syncTexDirectories(input.root, input.mainFile, input.compilerArguments));
  if (data.state !== "ready") throw new Error(`SYNCTEX_DATA_${data.state.toUpperCase()}: Recompile this PDF to regenerate its source location data.`);
  if (!inside(await realpath(input.root), await realpath(data.path!))) throw noMatch();
  const names = process.platform === "win32" ? ["synctex.exe", "synctex"] : ["synctex"];
  let tool = "synctex";
  search: for (const directory of [input.binDirectory, input.latexmk ? dirname(input.latexmk) : undefined]) {
    if (!directory) continue;
    for (const name of names) { const candidate = join(directory, name); try { await access(candidate); tool = candidate; break search; } catch { /* Try the next tool. */ } }
  }
  return new Promise((accept, reject) => execFile(tool, [...args, "-d", data.directory!], { cwd: input.root, env: { ...compilerEnvironment(), LC_NUMERIC: "C" }, windowsHide: true, timeout: 15_000 }, (error, stdout, stderr) => {
    if (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") reject(new Error("SyncTeX executable was not found. Check the LaTeX toolchain settings."));
      else reject(new Error(/^.*SyncTeX\s+ERROR[^\r\n]*/im.exec(stderr + "\n" + stdout)?.[0]?.trim() ?? "SyncTeX could not locate this position. Recompile the document and try again."));
    } else accept(stdout);
  }));
}

export async function forwardSync(input: ToolOptions & { sourcePath: string; line: number; column: number }): Promise<SyncTexPdfPosition> {
  if (!Number.isFinite(input.line) || !Number.isFinite(input.column)) throw noMatch();
  return parseForwardSync(await run(input, ["view", "-i", `${Math.max(1, Math.floor(input.line))}:${Math.max(1, Math.floor(input.column))}:${input.sourcePath}`, "-o", input.pdfPath]));
}

export async function reverseSync(input: ToolOptions & { page: number; x: number; y: number }): Promise<SyncTexSourcePosition> {
  if (!Number.isInteger(input.page) || input.page < 1 || !Number.isFinite(input.x) || !Number.isFinite(input.y)) throw noMatch();
  const output = await run(input, ["edit", "-o", `${input.page}:${input.x}:${input.y}:${input.pdfPath}`]);
  const root = await realpath(input.root);
  for (const record of syncTexRecords(output)) {
    const line = Number(record.Line), column = Number(record.Column ?? 1);
    if (!record.Input || !Number.isInteger(line) || line < 1) continue;
    const path = await realpath(resolve(input.root, record.Input)).catch(() => undefined);
    if (!path || !inside(root, path)) continue;
    return { file: relative(root, path).replaceAll("\\", "/"), line, column: Number.isFinite(column) ? Math.max(1, Math.floor(column)) : 1 };
  }
  throw noMatch();
}
