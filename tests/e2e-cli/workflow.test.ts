import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompileResult, Project } from "@latex-editor/contracts";

interface CliResult { code: number | null; stdout: string; stderr: string }

function runCli(root: string, args: string[], stdin?: string): Promise<CliResult> {
  const executable = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const cli = resolve(process.cwd(), "apps", "cli", "src", "index.ts");
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [executable, cli, ...args], {
      cwd: process.cwd(),
      shell: false,
      windowsHide: true,
      env: { ...process.env, LATEX_EDITOR_DATA_DIR: resolve(root, "data") }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("exit", (code) => done({ code, stdout, stderr }));
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

describe("CLI backend workflow", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "latex-editor-cli-"));
    await mkdir(resolve(root, "projects"));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("CL-001 CL-003 creates, edits, and compiles a project with single-document JSON output", async (context) => {
    const create = await runCli(root, ["project", "create", "--name", "paper", "--parent", resolve(root, "projects"), "--json"]);
    expect(create.code, create.stderr).toBe(0);
    const project = JSON.parse(create.stdout) as Project;
    const write = await runCli(root, ["file", "write", project.id, "main.tex", "--stdin", "--json"], [
      "\\documentclass{article}", "\\begin{document}", "CLI workflow.", "\\end{document}", ""
    ].join("\n"));
    expect(write.code, write.stderr).toBe(0);

    const doctor = await runCli(root, ["doctor", "--json"]);
    const doctorResult = JSON.parse(doctor.stdout) as { latexmk: { available: boolean } };
    if (!doctorResult.latexmk.available) context.skip();

    const compile = await runCli(root, ["compile", project.id, "--json"]);
    expect(compile.code, compile.stderr).toBe(0);
    expect(compile.stdout.trim().split(/\r?\n/)).toHaveLength(1);
    const result = JSON.parse(compile.stdout) as CompileResult;
    expect(result.status).toBe("succeeded");
    expect(result.pdfPath).toMatch(/main\.pdf$/);
  }, 150_000);
});
