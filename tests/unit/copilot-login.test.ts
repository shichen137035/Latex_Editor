import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCopilotLoginScript } from "../../apps/desktop/src/main/ai/copilot-login.js";

describe.skipIf(process.platform !== "win32")("Copilot Windows login script", () => {
  it.each([0, 7])("executes the CLI and records exit %s with spaces, Unicode and apostrophes in paths", (exitCode) => {
    const root = mkdtempSync(join(tmpdir(), "texweave login 中文 ' "));
    try {
      const cli = join(root, "fake cli.ps1");
      const home = join(root, "copilot home");
      const invocation = join(root, "invocation.json");
      const resultPath = join(root, "result.json");
      const scriptPath = join(root, "login.ps1");
      writeFileSync(cli, "\ufeff" + `@{ arguments = @($args); home = $env:COPILOT_HOME } | ConvertTo-Json -Compress | Set-Content -LiteralPath '${invocation.replaceAll("'", "''")}' -Encoding UTF8\r\nexit ${exitCode}\r\n`);
      writeFileSync(scriptPath, createCopilotLoginScript(cli, home, resultPath));
      const child = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], { input: "\n", encoding: "utf8", windowsHide: true, timeout: 10_000 });
      expect(child.error).toBeUndefined();
      const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8").replace(/^\ufeff/, ""));
      expect(readJson(invocation)).toEqual({ arguments: ["login", "--web-flow"], home });
      expect(readJson(resultPath).exitCode).toBe(exitCode);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
