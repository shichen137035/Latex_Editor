import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findCodexExecutable } from "../../apps/desktop/src/main/ai/codex-discovery.js";

describe("Codex discovery outside the IDE's private PATH", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "texweave-codex-discovery-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });
  function file(...parts: string[]): string {
    const path = join(root, ...parts);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "test executable fixture");
    return path;
  }
  function discover(env: NodeJS.ProcessEnv = {}, configured = "") {
    return findCodexExecutable({ userHome: root, userDataPath: join(root, "profile"), platform: "win32", arch: "x64", env, configured });
  }

  it("discovers the newest usable VS Code bundle with an empty PATH and a stale saved path", () => {
    file(".vscode", "extensions", "openai.chatgpt-9.0.0-win32-x64", "bin", "windows-x86_64", "codex.exe");
    const latest = file(".vscode", "extensions", "openai.chatgpt-10.0.0-win32-x64", "bin", "windows-x86_64", "codex.exe");
    mkdirSync(join(root, ".vscode", "extensions", "openai.chatgpt-11.0.0-win32-x64"));
    expect(discover({}, join(root, "removed", "codex.exe"))).toBe(latest);
  });

  it("preserves Path when a launcher also supplies PATH, and honors an explicit executable", () => {
    const pathExe = file("system bin", "codex.exe");
    const explicit = file("custom", "codex.exe");
    const env = { PATH: join(root, "perl"), Path: `"${dirname(pathExe)}"` };
    expect(discover(env)).toBe(pathExe);
    expect(discover(env, explicit)).toBe(explicit);
  });

  it.each(["bin", "codex"])("resolves a global npm cmd shim to its native %s layout", (folder) => {
    const shim = file("npm", "codex.cmd");
    const binary = file("npm", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", folder, "codex.exe");
    expect(discover({ PATH: dirname(shim) })).toBe(binary);
    expect(discover({}, shim)).toBe(binary);
  });

  it("rediscovers the managed install when the saved preference is cleared", () => {
    const binary = file("profile", "tools", "codex-cli", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
    expect(discover()).toBe(binary);
  });

  it("reports absence without inventing an executable path", () => {
    expect(discover()).toBeUndefined();
  });
});
