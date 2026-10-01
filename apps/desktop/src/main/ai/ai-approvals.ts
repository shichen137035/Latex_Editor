import { isAbsolute, resolve, sep } from "node:path";
import type { AIPermissionMode } from "@latex-editor/contracts" with { "resolution-mode": "import" };

export type AIToolApproval = { description: string; command?: string; paths: string[]; external: boolean; readOnly?: boolean; managed?: boolean };

/** The provider sandbox enforces paths. This policy decides when a human must approve. */
export function requiresAIApproval(mode: AIPermissionMode, action: AIToolApproval): boolean {
  if (action.managed) return true;
  if (mode === "full") return false;
  if (action.readOnly) return false;
  if (action.external) return true;
  // A working-copy file edit is reviewed via diffs in Ask mode. Destructive
  // shell/system operations still need explicit approval in either limited mode.
  return !!action.command && /\b(?:Remove-Item|rm|rmdir|del|format|reg|shutdown|Stop-Process|taskkill)\b|\bgit\s+(?:reset|clean|push)\b/i.test(action.command);
}

export function codexPermissionPolicy(mode: AIPermissionMode, cwd: string) {
  return mode === "full"
    ? { approvalPolicy: "never", sandbox: "danger-full-access", sandboxPolicy: { type: "dangerFullAccess" } }
    : { approvalPolicy: "on-request", sandbox: "workspace-write", sandboxPolicy: { type: "workspaceWrite", writableRoots: [cwd], networkAccess: true } };
}

/** A network/read permission request must not inherit external-write restrictions. */
export function isReadOnlyPermissionRequest(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const permissions = value as Record<string, unknown>;
  const fileSystem = permissions.fileSystem && typeof permissions.fileSystem === "object" ? permissions.fileSystem as Record<string, unknown> : {};
  const entries = Array.isArray(fileSystem.entries) ? fileSystem.entries : [];
  if ((Array.isArray(fileSystem.write) && fileSystem.write.length) || entries.some(entry => !entry || !["read", "none"].includes(entry.access))) return false;
  return Boolean(permissions.network) || (Array.isArray(fileSystem.read) && fileSystem.read.length > 0) || entries.some(entry => entry.access === "read");
}

/** Resolve project boundaries for tool requests; ordinary reads remain available. */
export function isWorkspacePath(path: string, workspace: string): boolean {
  const root = resolve(workspace);
  const target = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const normalizedRoot = process.platform === "win32" ? root.toLowerCase() : root;
  const normalizedTarget = process.platform === "win32" ? target.toLowerCase() : target;
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`);
}

/** Keep AI shell tools from launching independent TeX build utilities. */
export function isLatexCompilerCommand(...commands: string[]): boolean {
  return commands.some((command) => /\b(?:latexmk|pdflatex|xelatex|lualatex|tectonic|arara|bibtex|biber|makeindex|xindy)(?:\.exe)?\b/i.test(command));
}

export function isReadOnlyWorkspaceCommand(command: string): boolean {
  // On Windows Codex normally invokes powershell.exe -Command '<script>'.
  const shellScript = /(?:^|\s)-Command\s+(['"])([\s\S]*)\1\s*$/i.exec(command)?.[2];
  const source = shellScript ?? command;
  if (!source || /[;&><`$(){}\r\n]/.test(source)) return false;
  if (/(?:^|\s)\.\.(?:[\\/]|\s|$)|[a-z]:[\\/]|\\\\/i.test(source)) return false;
  return source.split("|").every((part) => /^\s*(?:Get-ChildItem|Get-Content|Get-Item|Get-Location|Test-Path|Select-String|Select-Object|Sort-Object|Measure-Object|rg|ls|dir|pwd|type)(?:\.exe)?(?=\s|$)/i.test(part));
}
