import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

interface DiscoveryOptions {
  userDataPath: string;
  configured?: string;
  env?: NodeJS.ProcessEnv;
  userHome?: string;
  platform?: NodeJS.Platform;
  arch?: string;
}

export function isFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}

/** Read all PATH spellings: Windows launchers may supply both Path and PATH. */
function pathDirectories(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  return [...new Set(Object.entries(env)
    .filter(([key]) => platform === "win32" ? key.toLowerCase() === "path" : key === "PATH")
    .flatMap(([, value]) => (value ?? "").split(platform === "win32" ? ";" : ":"))
    .map((value) => value.trim().replace(/^"|"$/g, ""))
    .filter(Boolean))];
}

export function findExecutableOnPath(name: string, env = process.env, platform = process.platform): string | undefined {
  return pathDirectories(env, platform).map((directory) => join(directory, name)).find(isFile);
}

/** Resolve npm shims to the native binary so Windows never needs cmd.exe or shell:true. */
function npmBinary(packageRoot: string, platform: NodeJS.Platform, arch: string): string | undefined {
  if (!["x64", "arm64"].includes(arch) || !["win32", "darwin", "linux"].includes(platform)) return undefined;
  const target = `${arch === "arm64" ? "aarch64" : "x86_64"}-${platform === "win32" ? "pc-windows-msvc" : platform === "darwin" ? "apple-darwin" : "unknown-linux-musl"}`;
  const platformPackage = `codex-${platform}-${arch}`;
  const binary = platform === "win32" ? "codex.exe" : "codex";
  const roots = [join(dirname(packageRoot), platformPackage), join(packageRoot, "node_modules", "@openai", platformPackage), packageRoot];
  return roots.flatMap((root) => ["bin", "codex"].map((folder) => join(root, "vendor", target, folder, binary))).find(isFile);
}

export function getManagedCodexExecutable(installRoot: string, platform = process.platform, arch: string = process.arch): string | undefined {
  return npmBinary(join(installRoot, "node_modules", "@openai", "codex"), platform, arch);
}

function resolveCandidate(candidate: string, platform: NodeJS.Platform, arch: string): string | undefined {
  if (!isFile(candidate)) return undefined;
  if (platform !== "win32" || /\.exe$/i.test(candidate)) return candidate;
  // npm global shims and project-local node_modules/.bin shims have different roots.
  for (const packageRoot of [join(dirname(candidate), "node_modules", "@openai", "codex"), join(dirname(candidate), "..", "@openai", "codex")]) {
    const binary = npmBinary(packageRoot, platform, arch);
    if (binary) return binary;
  }
  return undefined;
}

/** Explorer/Start.bat does not inherit the Codex extension's private PATH. */
export function findCodexExecutable(options: DiscoveryOptions): string | undefined {
  const { userDataPath, configured = "", env = process.env, userHome = homedir(), platform = process.platform, arch = process.arch } = options;
  const explicit = configured.trim().replace(/^"|"$/g, "");
  if (explicit) {
    const binary = resolveCandidate(resolve(explicit), platform, arch);
    if (binary) return binary;
  }
  const managed = getManagedCodexExecutable(join(userDataPath, "tools", "codex-cli"), platform, arch);
  if (managed) return managed;
  const names = platform === "win32" ? ["codex.exe", "codex.cmd", "codex.ps1", "codex"] : ["codex"];
  for (const directory of pathDirectories(env, platform)) {
    for (const name of names) {
      const binary = resolveCandidate(join(directory, name), platform, arch);
      if (binary) return binary;
    }
  }
  if (platform === "win32") {
    const npmRoot = join(env.APPDATA ?? join(userHome, "AppData", "Roaming"), "npm");
    const npm = getManagedCodexExecutable(npmRoot, platform, arch);
    if (npm) return npm;
  }
  const nativeName = platform === "win32" ? "codex.exe" : "codex";
  const local = [".local", ".cargo"].map((folder) => join(userHome, folder, "bin", nativeName)).find(isFile);
  if (local) return local;

  // Only inspect known extension roots and the OpenAI extension, never scan the user's projects.
  const bundledFolder = `${platform === "win32" ? "windows" : platform}-${arch === "arm64" ? "aarch64" : "x86_64"}`;
  for (const editor of [".vscode", ".vscode-insiders"]) {
    const extensionRoot = join(userHome, editor, "extensions");
    try {
      const extensions = readdirSync(extensionRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^openai\.chatgpt-\d/i.test(entry.name))
        .sort((a, b) => b.name.localeCompare(a.name, "en", { numeric: true }));
      for (const extension of extensions) {
        const binary = join(extensionRoot, extension.name, "bin", bundledFolder, nativeName);
        if (isFile(binary)) return binary;
      }
    } catch { /* This editor is not installed, or its extension directory is inaccessible. */ }
  }
  return undefined;
}
