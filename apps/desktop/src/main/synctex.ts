import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { SyncTexPdfPosition, SyncTexSourcePosition } from "@latex-editor/contracts" with { "resolution-mode": "import" };

function run(executable: string, args: string[], cwd: string): Promise<string> {
  return new Promise((accept, reject) => execFile(executable, args, { cwd, windowsHide: true, timeout: 15_000 }, (error, stdout, stderr) => {
    if (error) reject(new Error((stderr || stdout || error.message).trim()));
    else accept(stdout);
  }));
}

async function executable(configuredBin?: string, latexmk?: string): Promise<string> {
  const names = process.platform === "win32" ? ["synctex.exe", "synctex"] : ["synctex"];
  const directories = [configuredBin, latexmk ? dirname(latexmk) : undefined].filter((value): value is string => Boolean(value));
  for (const directory of directories) for (const name of names) {
    const candidate = join(directory, name);
    try { await access(candidate); return candidate; } catch { /* Continue with the next local toolchain candidate. */ }
  }
  return "synctex";
}

function field(output: string, name: string): string | undefined {
  return new RegExp(`^${name}:\\s*(.+)$`, "mi").exec(output)?.[1]?.trim();
}

export async function forwardSync(input: { root: string; sourcePath: string; pdfPath: string; line: number; column: number; binDirectory?: string; latexmk?: string }): Promise<SyncTexPdfPosition> {
  const tool = await executable(input.binDirectory, input.latexmk);
  const output = await run(tool, ["view", "-i", `${Math.max(1, input.line)}:${Math.max(1, input.column)}:${input.sourcePath}`, "-o", input.pdfPath], input.root);
  const page = Number(field(output, "Page"));
  const x = Number(field(output, "x") ?? field(output, "h"));
  const y = Number(field(output, "y") ?? field(output, "v"));
  if (!Number.isFinite(page) || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error("SyncTeX did not return a PDF position");
  return { page, x, y };
}

export async function reverseSync(input: { root: string; pdfPath: string; page: number; x: number; y: number; binDirectory?: string; latexmk?: string }): Promise<SyncTexSourcePosition> {
  const tool = await executable(input.binDirectory, input.latexmk);
  const output = await run(tool, ["edit", "-o", `${Math.max(1, input.page)}:${input.x}:${input.y}:${input.pdfPath}`], input.root);
  const rawFile = field(output, "Input");
  const line = Number(field(output, "Line"));
  const column = Number(field(output, "Column") ?? 1);
  if (!rawFile || !Number.isFinite(line)) throw new Error("SyncTeX did not return a source position");
  const absolute = resolve(input.root, rawFile);
  const local = relative(input.root, absolute);
  if (local.startsWith("..") || resolve(input.root, local) !== absolute) throw new Error("SyncTeX returned a source outside the project");
  return { file: local.replaceAll("\\", "/"), line: Math.max(1, line), column: Number.isFinite(column) ? Math.max(1, column) : 1 };
}
